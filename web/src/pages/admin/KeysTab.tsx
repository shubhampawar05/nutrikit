import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmt, fmtDate } from '../../api/client.ts';
import { adminApi, type AdminKey } from '../../api/admin.ts';
import { useToast } from '../../components/Toast.tsx';
import { Empty, message, Search, useSearch } from './common.tsx';

export function KeysTab() {
  const { text, setText, q, pending } = useSearch();
  const queryClient = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['admin', 'keys', q], queryFn: () => adminApi.keys(q), placeholderData: keepPreviousData });
  const revoke = useMutation({
    mutationFn: (key: AdminKey) => adminApi.revokeKey(key.id),
    onSuccess: (_r, key) => {
      toast(`Key “${key.name}” revoked`);
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (err) => toast(message(err)),
  });
  const onRevoke = (key: AdminKey) => {
    const owner = key.email ?? 'an operator key';
    if (window.confirm(`Revoke “${key.name}” (${owner})? It stops working immediately, with any access tokens made from it. This cannot be undone.`)) revoke.mutate(key);
  };
  return (
    <section className="card admin-card">
      <div className="admin-toolbar">
        <h2>API keys</h2>
        <Search value={text} onChange={setText} busy={pending || list.isFetching} placeholder="Search email or key name" />
      </div>
      {list.error ? <p className="form-error">{message(list.error)}</p> : null}
      {list.data && !list.data.keys.length ? <Empty>No keys{q ? ' match this search' : ' yet'}.</Empty> : <div className="table-scroll">
        <table className="data" aria-busy={list.isFetching}>
          <thead>
            <tr><th scope="col">Key</th><th scope="col">Owner</th><th scope="col">Created</th><th scope="col">Last used</th><th scope="col">Tokens (month)</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {list.data?.keys.map((k) => (
              <tr key={k.id}>
                <td><span className={k.mode === 'test' ? 'badge warn' : 'badge ok'}>{k.mode === 'test' ? 'Test' : 'Live'}</span> {k.name}<span className="muted small admin-sub">{k.id}</span></td>
                <td>{k.email ?? <span className="muted">operator key</span>}{k.accountName ? <span className="muted small admin-sub">{k.accountName}</span> : null}</td>
                <td className="nowrap">{fmtDate(k.createdAt)}</td>
                <td className="nowrap">{k.lastUsedAt ? fmtDate(k.lastUsedAt) : <span className="muted">never</span>}</td>
                <td className="num">{fmt(k.usedThisMonth)}</td>
                <td>
                  {k.revokedAt
                    ? <span className="badge">revoked {fmtDate(k.revokedAt)}</span>
                    : <button className="btn btn-danger btn-sm" type="button" disabled={revoke.isPending} aria-label={`Revoke ${k.name}`} onClick={() => onRevoke(k)}>Revoke</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </section>
  );
}
