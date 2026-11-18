// The team's API keys: create (live or test), regenerate and revoke.
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, can, errorText, fmt, fmtDate, type KeyMode, type Me } from '../../api/client.ts';
import { useToast } from '../../components/Toast.tsx';
import { ErrorRetry } from '../../components/ErrorRetry.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Select } from '../../components/Select.tsx';
import type { Reveal } from './KeyReveal.tsx';

export function KeysCard({ me, onCreated }: { me: Me; onCreated: (r: Reveal) => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: ['keys', me.team.id], queryFn: api.keys });
  const liveAllowed = can.manageLiveKeys(me.team.role);
  const { register, handleSubmit, reset, watch, setValue } = useForm<{ name: string; mode: KeyMode }>({ defaultValues: { name: '', mode: liveAllowed ? 'live' : 'test' } });
  const mode = watch('mode');
  // Revokes in flight, by key id: a ref so a double click can't send twice, state so the row's button disables.
  const revoking = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const settle = (id: string) => {
    revoking.current.delete(id);
    setPendingIds(new Set(revoking.current));
  };

  const create = useMutation({
    mutationFn: (v: { name: string; mode: KeyMode }) => api.createKey(v.name, v.mode),
    onSuccess: (key) => {
      reset({ name: '', mode: key.mode });
      onCreated({ key: key.key, title: `New ${key.mode} key “${key.name}” created`, teamId: me.team.id });
      toast('New key created');
    },
    // The plan's key limit is enforced by the server (403 key_limit); its message says what to do.
    onError: (err) => toast(errorText(err)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['keys'] }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeKey(id),
    onSuccess: () => toast('Key revoked'),
    onError: (err) => toast(errorText(err)),
    onSettled: async (_data, _err, id) => {
      await queryClient.invalidateQueries({ queryKey: ['keys'] });
      settle(id);
    },
  });

  const regenerate = useMutation({
    mutationFn: (id: string) => api.regenerateKey(id),
    onSuccess: (key) => {
      onCreated({ key: key.key, title: `New key for “${key.name}”`, teamId: me.team.id });
      toast('Key regenerated. The old one no longer works');
    },
    onError: (err) => toast(errorText(err)),
    onSettled: async (_data, _err, id) => {
      await queryClient.invalidateQueries({ queryKey: ['keys'] });
      settle(id);
    },
  });

  const onRegenerate = (id: string, name: string) => {
    if (revoking.current.has(id)) return;
    if (!window.confirm(`Regenerate “${name}”? You'll get a new key to copy, and the current one (and its access tokens) stops working immediately.`)) return;
    revoking.current.add(id);
    setPendingIds(new Set(revoking.current));
    regenerate.mutate(id);
  };

  const onRevoke = (id: string, name: string) => {
    if (revoking.current.has(id)) return;
    if (!window.confirm(`Revoke “${name}”? Apps using it (and its access tokens) stop working immediately.`)) return;
    revoking.current.add(id);
    setPendingIds(new Set(revoking.current));
    revoke.mutate(id);
  };

  const list = keys.data?.keys;
  const activeOf = (m: KeyMode) => list?.filter((k) => !k.revokedAt && k.mode === m).length;
  const active = activeOf(mode);
  const atLimit = active != null && active >= me.plan.maxKeys;
  return (
    <section className="card" style={{ marginBottom: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: '0 0 12px' }}>API keys</h2>
        <form className="row" onSubmit={handleSubmit((v) => { if (!create.isPending) create.mutate(v); })}>
          <input className="input" placeholder="Key name, e.g. iOS app" maxLength={100} aria-label="New key name" style={{ width: 220 }} {...register('name')} />
          <Select<KeyMode>
            aria-label="Key type"
            value={mode}
            onChange={(v) => setValue('mode', v)}
            options={[
              { value: 'live', label: `Live${liveAllowed ? '' : ' (owners and admins)'}`, disabled: !liveAllowed },
              { value: 'test', label: 'Test' },
            ]}
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={create.isPending || atLimit} aria-describedby={atLimit ? 'key-limit' : undefined}>
            Create key
          </button>
        </form>
      </div>
      {atLimit ? (
        <p className="small" id="key-limit" style={{ margin: '8px 0 0' }}>
          Your {me.plan.name} plan allows {me.plan.maxKeys} active {mode} {me.plan.maxKeys === 1 ? 'key' : 'keys'}. Revoke one or upgrade your plan to create another.
        </p>
      ) : null}
      <p className="small muted" style={{ margin: '8px 0 12px' }}>
        {list && `${activeOf('live')} of ${me.plan.maxKeys} live and ${activeOf('test')} of ${me.plan.maxKeys} test keys. Live keys share the team's monthly allowance. Test keys (nk_test_…) get real catalog answers and sample AI answers, never touch the AI provider, and have their own ${fmt(me.testUsage.limit)}-token allowance.`}
      </p>
      {keys.isPending ? (
        <div className="skeleton-rows" aria-busy="true"><span className="sr-only">Loading keys…</span><i /><i /></div>
      ) : keys.isError ? (
        <ErrorRetry error={keys.error} onRetry={() => keys.refetch()} />
      ) : !list?.length ? (
        <p className="muted" style={{ margin: 0 }}>No keys yet. Name one above and choose Create key to start calling the API.</p>
      ) : (
        <div className="table-scroll keys-scroll">
          <table className="data keys-table">
            <thead>
              <tr>
                <th scope="col">Name</th><th scope="col">Created</th><th scope="col">Last used</th><th scope="col">Tokens this month</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((k) => (
                <tr key={k.id}>
                  <td className="key-name">
                    <span className={k.mode === 'test' ? 'badge warn' : 'badge ok'}>{k.mode === 'test' ? 'Test' : 'Live'}</span> {k.name} <span className="muted small">{k.id}</span>
                  </td>
                  <td data-label="Created">{fmtDate(k.createdAt)}{k.createdBy ? <span className="muted small admin-sub">by {k.createdBy}</span> : null}</td>
                  <td data-label="Last used">{k.lastUsedAt ? fmtDate(k.lastUsedAt) : <span className="muted">never</span>}</td>
                  <td data-label="Tokens this month">{fmt(k.usedThisMonth)}</td>
                  <td className="key-cell-actions">
                    {k.revokedAt
                      ? <span className="badge">revoked</span>
                      : k.mode === 'live' && !liveAllowed ? null : (
                        <div className="key-actions">
                          <button
                            className="btn btn-ghost btn-sm"
                            type="button"
                            aria-label={`Regenerate ${k.name}`}
                            title="Lost this key? Get a new one in its place"
                            disabled={pendingIds.has(k.id)}
                            onClick={() => onRegenerate(k.id, k.name)}
                          >
                            <Icon name="refresh" />Regenerate
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            type="button"
                            aria-label={`Revoke ${k.name}`}
                            disabled={pendingIds.has(k.id)}
                            onClick={() => onRevoke(k.id, k.name)}
                          >
                            Revoke
                          </button>
                        </div>
                      )}
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
