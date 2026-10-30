import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api/client.ts';

/** The signed-in developer, or undefined (a 401 is not an error here). */
export function useMe() {
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

export function useTitle(title: string) {
  useEffect(() => { document.title = title; }, [title]);
}
