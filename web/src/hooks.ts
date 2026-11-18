import { useEffect } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiError, NEW_KEY_STORE, PLAYGROUND_KEY_STORE, PORTAL_SIGNED_OUT, type AccountView, type Me } from './api/client.ts';
import { tabStore } from './storage.ts';

/** Queries that belong to the team in use, reloaded when it changes and dropped on logout. */
const TEAM_QUERIES = ['keys', 'usage', 'members'] as const;

/**
 * The signed-in developer, or null when signed out (a 401 is not an error here). Any other portal call that finds
 * the session gone also marks the visitor signed out, so pages send them to log in instead of showing errors.
 */
export function useMe() {
  const queryClient = useQueryClient();
  useEffect(() => {
    // The session ended (it expired, or was ended elsewhere): forget what this tab holds for that account, as logout does.
    const signedOut = () => { if (queryClient.getQueryData(['me'])) forgetAccount(queryClient); };
    window.addEventListener(PORTAL_SIGNED_OUT, signedOut);
    return () => window.removeEventListener(PORTAL_SIGNED_OUT, signedOut);
  }, [queryClient]);
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 30_000,
  });
}

/** After the team in use changes: take the new view (or reload it) and reload everything that belongs to a team. */
export function useTeamChanged() {
  const queryClient = useQueryClient();
  return (view: AccountView | null) => {
    if (view) queryClient.setQueryData<Me>(['me'], (old) => (old ? { ...old, ...view } : old));
    else void queryClient.invalidateQueries({ queryKey: ['me'] });
    for (const key of TEAM_QUERIES) void queryClient.invalidateQueries({ queryKey: [key] });
  };
}

/** Forgets everything this browser holds for the signed-in account (after logging out or deleting it). */
export function forgetAccount(queryClient: QueryClient) {
  tabStore.remove(PLAYGROUND_KEY_STORE);
  tabStore.remove(NEW_KEY_STORE);
  queryClient.setQueryData(['me'], null);
  for (const key of TEAM_QUERIES) queryClient.removeQueries({ queryKey: [key] });
}
