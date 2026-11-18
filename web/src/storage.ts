// sessionStorage that never throws: when storage is blocked (privacy settings, some embedded browsers) reads
// return null and writes are dropped, so the page keeps working without it.

export const tabStore = {
  get: (key: string): string | null => {
    try { return sessionStorage.getItem(key); } catch { return null; }
  },
  /** Stores `value`, or removes the entry when it is null. */
  set: (key: string, value: string | null) => {
    try {
      if (value == null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    } catch { /* storage unavailable */ }
  },
  remove: (key: string) => tabStore.set(key, null),
};
