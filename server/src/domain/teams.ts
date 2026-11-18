// Team members, roles and invitations.
//
// Roles: owner (everything), admin (members other than owners, all keys), developer (sees everything, manages test
// keys only). A team always keeps at least one owner. Invitations are emailed links; only a SHA-256 of the link's
// token is stored, and a link works once, for 7 days, for a signed-in user with the invited email.
import crypto from 'node:crypto';
import type { Sql } from 'postgres';
import { PLANS, effectivePlan, fail, hashId, isEmail, type Account, type Role, type User } from './accounts.ts';
import { mailer } from './mail.ts';

const INVITE_DAYS = 7;
// Invitations have their own limits, not the per-network email limit: an owner onboarding a team sends many at once.
const INVITES_PER_TEAM_PER_HOUR = () => Number(process.env.NUTRIKIT_INVITE_LIMIT) || 30;
const INVITES_PER_ADDRESS_PER_HOUR = 3;
const INVITE_ROLES: readonly Role[] = ['admin', 'developer'];

/** What each role may do. */
export const can = {
  manageLiveKeys: (role: Role) => role !== 'developer',
  manageMembers: (role: Role) => role !== 'developer',
  manageTeam: (role: Role) => role === 'owner',
};

const forbidden = (message = 'your role in this team does not allow this') => fail(403, 'forbidden', message);
const lastOwner = () => fail(409, 'last_owner', 'a team needs at least one owner; make another member an owner first');

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: Date;
}

export interface Invitation {
  /** The first 12 hex characters of the link's hash: enough to revoke it, useless as a link. */
  id: string;
  email: string;
  role: Role;
  invitedBy: string | null;
  expiresAt: Date;
  createdAt: Date;
}

export async function listMembers(sql: Sql, accountId: string): Promise<Member[]> {
  return (await sql<Member[]>`
    SELECT u.id AS "userId", u.name, u.email, m.role, m.created_at AS "joinedAt"
    FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.account_id = ${accountId}
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at`).map((r) => ({ ...r }));
}

/** Pending invitations (not accepted, not expired), newest first. */
export async function listInvitations(sql: Sql, accountId: string): Promise<Invitation[]> {
  return (await sql<Invitation[]>`
    SELECT left(i.id_hash, 12) AS id, i.email, i.role, u.name AS "invitedBy", i.expires_at AS "expiresAt", i.created_at AS "createdAt"
    FROM invitations i LEFT JOIN users u ON u.id = i.invited_by
    WHERE i.account_id = ${accountId} AND i.accepted_at IS NULL AND i.expires_at > now()
    ORDER BY i.created_at DESC`).map((r) => ({ ...r }));
}

/** Members plus pending invitations, optionally ignoring invitations to one email (being replaced). */
async function seatsTaken(sql: Sql, accountId: string, exceptEmail: string | null = null): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT (SELECT COUNT(*) FROM memberships WHERE account_id = ${accountId})
         + (SELECT COUNT(*) FROM invitations WHERE account_id = ${accountId} AND accepted_at IS NULL AND expires_at > now()
              AND (${exceptEmail}::citext IS NULL OR email <> ${exceptEmail}::citext)) AS n`;
  return Number(n);
}

/**
 * Invites `email` to the team with `role` and emails the link. Replaces an earlier unused invitation to the same
 * email. `origin` is the site's public origin.
 */
export async function invite(sql: Sql, args: { account: Account; inviter: User; inviterRole: Role; email: unknown; role: unknown; origin: string }): Promise<Invitation> {
  const { account, inviter, inviterRole, origin } = args;
  if (!can.manageMembers(inviterRole)) throw forbidden();
  const email = typeof args.email === 'string' ? args.email.trim() : '';
  const fields: Record<string, string> = {};
  if (!isEmail(email)) fields.email = 'Enter a valid email address.';
  if (!INVITE_ROLES.includes(args.role as Role)) fields.role = 'Choose admin or developer.';
  if (Object.keys(fields).length) throw Object.assign(fail(400, 'invalid_request', 'check the highlighted fields'), { fields });
  const role = args.role as Role;

  const [member] = await sql`SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.account_id = ${account.id} AND u.email = ${email}`;
  if (member) throw Object.assign(fail(409, 'already_member', 'this person is already in the team'), { fields: { email: 'Already a member of this team.' } });
  const limit = account.planDetails.maxMembers;
  if (await seatsTaken(sql, account.id, email) >= limit) {
    throw fail(403, 'member_limit', `your ${account.planDetails.name} plan allows ${limit} people, pending invitations included; remove someone or revoke an invitation first`);
  }
  await throttleInvites(sql, account.id, email);

  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + INVITE_DAYS * 864e5);
  await sql.begin(async (tx) => {
    await tx`DELETE FROM invitations WHERE account_id = ${account.id} AND email = ${email} AND accepted_at IS NULL`;
    await tx`INSERT INTO invitations (id_hash, account_id, email, role, invited_by, expires_at)
      VALUES (${hashId(token)}, ${account.id}, ${email}, ${role}, ${inviter.id}, ${expires})`;
    // No ip: invitations don't count toward the per-network limit on verification and reset emails.
    await tx`INSERT INTO email_sends (email, ip, purpose) VALUES (${email}, NULL, 'invite')`;
    await tx`INSERT INTO invite_sends (account_id) VALUES (${account.id})`;
  });
  await mailer().send({
    to: email,
    subject: `${inviter.name} invited you to ${account.name} on Nutrikit`,
    text: `${inviter.name} (${inviter.email}) invited you to join the team "${account.name}" on Nutrikit as ${role === 'admin' ? 'an admin' : 'a developer'}.\n\n`
      + `Open this link to accept:\n${origin}/invite?token=${token}\n\n`
      + `The link works for ${INVITE_DAYS} days, for ${email} only. If you weren't expecting it, you can ignore this email.\n\n— Nutrikit`,
  });
  return { id: hashId(token).slice(0, 12), email, role, invitedBy: inviter.name, expiresAt: expires, createdAt: new Date() };
}

/** Per team (NUTRIKIT_INVITE_LIMIT an hour) and per invited address (3 an hour). Throws 429 with Retry-After. */
async function throttleInvites(sql: Sql, accountId: string, email: string) {
  await sql`DELETE FROM invite_sends WHERE at < now() - interval '1 hour'`;
  const [{ team, address }] = await sql<{ team: number; address: number }[]>`
    SELECT (SELECT COUNT(*)::int FROM invite_sends WHERE account_id = ${accountId} AND at > now() - interval '1 hour') AS team,
           (SELECT COUNT(*)::int FROM email_sends WHERE email = ${email} AND purpose = 'invite' AND at > now() - interval '1 hour') AS address`;
  if (team >= INVITES_PER_TEAM_PER_HOUR()) throw Object.assign(fail(429, 'too_many_invitations', 'this team sent many invitations in the last hour; try again later'), { retryAfter: 3600 });
  if (address >= INVITES_PER_ADDRESS_PER_HOUR) throw Object.assign(fail(429, 'too_many_emails', 'this address was invited several times recently; try again later'), { retryAfter: 3600 });
}

export async function revokeInvitation(sql: Sql, accountId: string, role: Role, id: string): Promise<boolean> {
  if (!can.manageMembers(role)) throw forbidden();
  if (!/^[a-f0-9]{12}$/.test(id)) return false;
  const r = await sql`DELETE FROM invitations WHERE account_id = ${accountId} AND left(id_hash, 12) = ${id} AND accepted_at IS NULL`;
  return r.count > 0;
}

const invalidInvite = () => fail(404, 'invalid_invitation', 'this invitation has expired, was revoked or was already used');

export interface InvitationPreview {
  team: string;
  invitedBy: string | null;
  email: string;
  role: Role;
  expiresAt: Date;
}

/** What an invitation link offers, for the invite page (no sign-in needed). */
export async function previewInvitation(sql: Sql, token: unknown): Promise<InvitationPreview> {
  if (typeof token !== 'string' || !token) throw invalidInvite();
  const [row] = await sql<InvitationPreview[]>`
    SELECT a.name AS team, u.name AS "invitedBy", i.email, i.role, i.expires_at AS "expiresAt"
    FROM invitations i JOIN accounts a ON a.id = i.account_id LEFT JOIN users u ON u.id = i.invited_by
    WHERE i.id_hash = ${hashId(token)} AND i.accepted_at IS NULL AND i.expires_at > now()`;
  if (!row) throw invalidInvite();
  return { ...row };
}

/**
 * Accepts an invitation for the signed-in `user`: their email must be the invited one. Adds the membership (a member
 * already keeps their role), marks the email verified, and returns the team's id.
 */
export async function acceptInvitation(sql: Sql, token: unknown, user: User): Promise<string> {
  if (typeof token !== 'string' || !token) throw invalidInvite();
  return sql.begin(async (tx) => {
    const [inv] = await tx<{ accountId: string; email: string; role: Role; plan: string }[]>`
      SELECT i.account_id AS "accountId", i.email, i.role, ${effectivePlan(tx, 'a')} AS plan
      FROM invitations i JOIN accounts a ON a.id = i.account_id
      WHERE i.id_hash = ${hashId(token)} AND i.accepted_at IS NULL AND i.expires_at > now()
      FOR UPDATE OF i, a`;
    if (!inv) throw invalidInvite();
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
      throw fail(403, 'wrong_email', `this invitation is for ${inv.email}; sign in with that email to accept it`);
    }
    // The invitation already holds a seat, so only a plan downgrade since sending can make the team full.
    const [{ n }] = await tx<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM memberships WHERE account_id = ${inv.accountId}`;
    const max = (PLANS[inv.plan] ?? PLANS.free!).maxMembers;
    const [already] = await tx`SELECT 1 FROM memberships WHERE account_id = ${inv.accountId} AND user_id = ${user.id}`;
    if (!already && n >= max) throw fail(403, 'member_limit', 'this team is full; ask its owner to make room and invite you again');
    await tx`INSERT INTO memberships (account_id, user_id, role) VALUES (${inv.accountId}, ${user.id}, ${inv.role}) ON CONFLICT DO NOTHING`;
    await tx`UPDATE invitations SET accepted_at = now() WHERE id_hash = ${hashId(token)}`;
    await tx`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = ${user.id}`;
    return inv.accountId;
  });
}

/** Locks the team's memberships and returns them, for changes that must keep an owner. */
async function lockedMembers(tx: Sql, accountId: string) {
  return tx<{ userId: string; role: Role }[]>`
    SELECT user_id AS "userId", role FROM memberships WHERE account_id = ${accountId} ORDER BY user_id FOR UPDATE`;
}

/** Changes a member's role. Only owners make, demote or change owners; admins manage admins and developers. */
export async function changeRole(sql: Sql, accountId: string, actorRole: Role, targetUserId: string, role: unknown): Promise<void> {
  if (!can.manageMembers(actorRole)) throw forbidden();
  if (!['owner', 'admin', 'developer'].includes(role as string)) {
    throw Object.assign(fail(400, 'invalid_request', 'check the highlighted fields'), { fields: { role: 'Choose owner, admin or developer.' } });
  }
  await sql.begin(async (tx) => {
    const members = await lockedMembers(tx as unknown as Sql, accountId);
    const target = members.find((m) => m.userId === targetUserId);
    if (!target) throw fail(404, 'not_found', 'member not found');
    if ((target.role === 'owner' || role === 'owner') && actorRole !== 'owner') throw forbidden('only an owner can make or change owners');
    if (target.role === 'owner' && role !== 'owner' && members.filter((m) => m.role === 'owner').length === 1) throw lastOwner();
    await tx`UPDATE memberships SET role = ${role as Role} WHERE account_id = ${accountId} AND user_id = ${targetUserId}`;
  });
}

/** Removes a member, or lets a member leave (any role may leave). The last owner can do neither. */
export async function removeMember(sql: Sql, accountId: string, actor: { userId: string; role: Role }, targetUserId: string): Promise<void> {
  const leaving = actor.userId === targetUserId;
  if (!leaving && !can.manageMembers(actor.role)) throw forbidden();
  await sql.begin(async (tx) => {
    const members = await lockedMembers(tx as unknown as Sql, accountId);
    const target = members.find((m) => m.userId === targetUserId);
    if (!target) throw fail(404, 'not_found', 'member not found');
    if (!leaving && target.role === 'owner' && actor.role !== 'owner') throw forbidden('only an owner can remove an owner');
    if (target.role === 'owner' && members.filter((m) => m.role === 'owner').length === 1) throw lastOwner();
    await tx`DELETE FROM memberships WHERE account_id = ${accountId} AND user_id = ${targetUserId}`;
  });
}
