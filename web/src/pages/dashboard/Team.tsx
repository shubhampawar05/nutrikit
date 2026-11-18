// Teams on the dashboard: the team switcher (with "New team") and the members card (invite, roles, remove, leave).
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, can, errorText, fmtDate, type Me, type Role } from '../../api/client.ts';
import { useTeamChanged } from '../../hooks.ts';
import { useToast } from '../../components/Toast.tsx';
import { ErrorRetry } from '../../components/ErrorRetry.tsx';
import { Select } from '../../components/Select.tsx';

export const ROLE_NAMES: Record<Role, string> = { owner: 'Owner', admin: 'Admin', developer: 'Developer' };
const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including the plan and other owners',
  admin: 'Members and all keys',
  developer: 'Sees keys and usage, manages test keys',
};

export function TeamSwitcher({ me }: { me: Me }) {
  const toast = useToast();
  const changed = useTeamChanged();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const switchTo = useMutation({
    mutationFn: (id: string) => api.switchTeam(id),
    onSuccess: (view) => { changed(view); toast(`Switched to ${view.team.name}`); },
    onError: (err) => toast(errorText(err)),
  });
  const create = useMutation({
    mutationFn: (n: string) => api.createTeam(n),
    onSuccess: (view) => {
      changed(view);
      setCreating(false);
      setName('');
      toast(`Team “${view.team.name}” created`);
    },
    onError: (err) => setError(err instanceof ApiError && err.fields?.name ? err.fields.name : errorText(err)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!create.isPending) create.mutate(name);
  };

  return (
    <div className="team-switcher">
      <label className="sr-only" htmlFor="team-select">Team</label>
      <Select
        id="team-select"
        value={me.team.id}
        disabled={switchTo.isPending}
        onChange={(id) => switchTo.mutate(id)}
        options={me.teams.map((t) => ({ value: t.id, label: `${t.name} (${ROLE_NAMES[t.role]})` }))}
      />
      {creating ? (
        <form className="row" onSubmit={submit}>
          <input
            className="input" autoFocus maxLength={100} placeholder="Team name, e.g. Acme Health" aria-label="New team name"
            value={name} onChange={(e) => setName(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'team-error' : undefined}
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={!name.trim() || create.isPending}>Create</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setCreating(false); setError(''); }}>Cancel</button>
          {error ? <span id="team-error" className="form-error small" role="alert">{error}</span> : null}
        </form>
      ) : (
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setCreating(true)}>New team</button>
      )}
    </div>
  );
}

export function MembersCard({ me }: { me: Me }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const changed = useTeamChanged();
  const role = me.team.role;
  const members = useQuery({ queryKey: ['members', me.team.id], queryFn: api.members });
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('developer');
  const [inviteError, setInviteError] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [teamName, setTeamName] = useState(me.team.name);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['members'] });

  const invite = useMutation({
    mutationFn: () => api.invite(email.trim(), inviteRole),
    onSuccess: (inv) => { setEmail(''); toast(`Invitation sent to ${inv.email}`); },
    onError: (err) => {
      const fields = err instanceof ApiError ? err.fields : undefined;
      setInviteError(fields?.email ?? fields?.role ?? errorText(err));
    },
    onSettled: refresh,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeInvitation(id),
    onSuccess: () => toast('Invitation revoked'),
    onError: (err) => toast(errorText(err)),
    onSettled: refresh,
  });
  const setRole = useMutation({
    mutationFn: (v: { userId: string; role: Role }) => api.changeRole(v.userId, v.role),
    onSuccess: () => toast('Role changed'),
    onError: (err) => toast(errorText(err)),
    onSettled: async (_d, _e, v) => {
      await refresh();
      // Changing your own role changes what the dashboard offers.
      if (v.userId === me.user.id) await queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(userId),
    onSuccess: (r) => {
      if (r.left) {
        toast(`You left ${me.team.name}`);
        changed(null);
      } else toast('Member removed');
    },
    onError: (err) => toast(errorText(err)),
    onSettled: refresh,
  });
  const rename = useMutation({
    mutationFn: () => api.renameTeam(teamName),
    onSuccess: (view) => { changed(view); setRenaming(false); toast('Team renamed'); },
    onError: (err) => toast(errorText(err)),
  });

  const onInvite = (e: FormEvent) => {
    e.preventDefault();
    setInviteError('');
    if (!invite.isPending) invite.mutate();
  };
  const onRemove = (userId: string, name: string) => {
    const self = userId === me.user.id;
    const question = self
      ? `Leave ${me.team.name}? You lose access to its keys and usage. Its keys keep working.`
      : `Remove ${name} from ${me.team.name}? Keys they created keep working.`;
    if (window.confirm(question)) remove.mutate(userId);
  };

  const data = members.data;
  const seats = data ? data.members.length + data.invitations.length : null;
  const full = data != null && seats! >= data.maxMembers;
  const owners = data?.members.filter((m) => m.role === 'owner').length ?? 0;
  // Which roles the signed-in member may give: owners any; admins admin or developer, and never to an owner.
  const roleChoices = (target: Role): Role[] => (role === 'owner' ? ['owner', 'admin', 'developer'] : target === 'owner' ? [] : ['admin', 'developer']);

  return (
    <section className="card" style={{ marginBottom: 20 }} aria-labelledby="members-title">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {renaming ? (
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (!rename.isPending) rename.mutate(); }}>
            <input className="input" autoFocus maxLength={100} aria-label="Team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
            <button className="btn btn-primary btn-sm" type="submit" disabled={!teamName.trim() || rename.isPending}>Save</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setRenaming(false); setTeamName(me.team.name); }}>Cancel</button>
          </form>
        ) : (
          <h2 id="members-title" style={{ margin: '0 0 12px' }}>
            Team: {me.team.name}{' '}
            {can.manageTeam(role) ? <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setTeamName(me.team.name); setRenaming(true); }}>Rename</button> : null}
          </h2>
        )}
        {seats != null ? <span className="small muted">{seats} of {data!.maxMembers} seats on the {me.plan.name} plan</span> : null}
      </div>
      <p className="small muted" style={{ margin: '0 0 12px' }}>
        Keys, usage and the plan belong to the team, so they keep working when someone leaves. You are {role === 'developer' ? 'a' : 'an'} {ROLE_NAMES[role].toLowerCase()}: {ROLE_HELP[role].toLowerCase()}.
      </p>

      {can.manageMembers(role) ? (
        <form className="row invite-form" onSubmit={onInvite} noValidate>
          <input
            className="input" type="email" placeholder="teammate@company.com" aria-label="Email to invite" maxLength={254}
            value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={inviteError ? true : undefined} aria-describedby={inviteError ? 'invite-error' : full ? 'seat-limit' : undefined}
          />
          <Select<Role>
            aria-label="Role for the invitation"
            value={inviteRole}
            onChange={setInviteRole}
            options={[{ value: 'developer', label: 'Developer' }, { value: 'admin', label: 'Admin' }]}
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={!email.trim() || invite.isPending || full}>{invite.isPending ? 'Sending…' : 'Invite'}</button>
        </form>
      ) : null}
      {inviteError ? <p id="invite-error" className="form-error small" role="alert" style={{ margin: '8px 0 0' }}>{inviteError}</p> : null}
      {full && can.manageMembers(role) ? <p id="seat-limit" className="small" style={{ margin: '8px 0 0' }}>The team is full. Remove someone or revoke an invitation to invite another person.</p> : null}

      {members.isPending ? (
        <div className="skeleton-rows" aria-busy="true"><span className="sr-only">Loading members…</span><i /><i /></div>
      ) : members.isError ? (
        <ErrorRetry error={members.error} onRetry={() => members.refetch()} />
      ) : (
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="data members-table">
            <thead>
              <tr><th scope="col">Member</th><th scope="col">Role</th><th scope="col">Joined</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {data!.members.map((m) => {
                const self = m.userId === me.user.id;
                // The last owner can't leave, be removed or be demoted (the server refuses too), so none is offered.
                const lastOwner = m.role === 'owner' && owners === 1;
                const choices = can.manageMembers(role) && !lastOwner ? roleChoices(m.role) : [];
                const canRemove = !lastOwner && (self || (can.manageMembers(role) && (m.role !== 'owner' || role === 'owner')));
                return (
                  <tr key={m.userId}>
                    <td>{m.name}{self ? <span className="muted small"> (you)</span> : null}<span className="muted small admin-sub">{m.email}</span></td>
                    <td data-label="Role">
                      {choices.length ? (
                        <Select<Role>
                          aria-label={`Role for ${m.name}`} value={m.role} disabled={setRole.isPending}
                          onChange={(role) => setRole.mutate({ userId: m.userId, role })}
                          options={choices.map((r) => ({ value: r, label: ROLE_NAMES[r] }))}
                        />
                      ) : <span className="badge">{ROLE_NAMES[m.role]}</span>}
                    </td>
                    <td data-label="Joined">{fmtDate(m.joinedAt)}</td>
                    <td className="key-cell-actions">
                      {canRemove ? (
                        <button className="btn btn-danger btn-sm" type="button" disabled={remove.isPending} aria-label={self ? 'Leave team' : `Remove ${m.name}`} onClick={() => onRemove(m.userId, m.name)}>
                          {self ? 'Leave team' : 'Remove'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {data!.invitations.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}<span className="muted small admin-sub">Invited{i.invitedBy ? ` by ${i.invitedBy}` : ''} · expires {fmtDate(i.expiresAt)}</span></td>
                  <td data-label="Role"><span className="badge">{ROLE_NAMES[i.role]}</span> <span className="badge warn">pending</span></td>
                  <td data-label="Joined"><span className="muted">—</span></td>
                  <td className="key-cell-actions">
                    {can.manageMembers(role) ? (
                      <button className="btn btn-ghost btn-sm" type="button" disabled={revoke.isPending} aria-label={`Revoke invitation for ${i.email}`} onClick={() => revoke.mutate(i.id)}>Revoke</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
