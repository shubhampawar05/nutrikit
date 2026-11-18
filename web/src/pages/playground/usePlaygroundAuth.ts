// The playground's credential: a session token minted for the signed-in developer, or a key pasted into the page.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, PLAYGROUND_KEY_STORE, errorText } from '../../api/client.ts';
import { tabStore } from '../../storage.ts';
import { useToast } from '../../components/Toast.tsx';

export type AuthView = 'checking' | 'session' | 'no-key' | 'anonymous' | 'manual';
/** The credential requests are sent with: the session token, or a pasted key (null when nothing is pasted). */
export interface Credential { mode: 'session' | 'manual'; value: string | null }

/** `me`: whether the account has loaded, and whether someone is signed in. */
export function usePlaygroundAuth(me: { isPending: boolean; signedIn: boolean }) {
  const toast = useToast();
  const auth = useRef<Credential>({ mode: 'session', value: null });
  const [authView, setAuthView] = useState<AuthView>('checking');
  const authViewRef = useRef<AuthView>('checking');
  useEffect(() => { authViewRef.current = authView; }, [authView]);
  const [switching, setSwitching] = useState(false);
  const [authLabel, setAuthLabel] = useState('');
  const [savedKey, setSavedKey] = useState('');
  const keyInput = useRef<HTMLInputElement>(null);

  const mintSessionToken = useCallback(async () => {
    const data = await api.playgroundToken();
    auth.current = { value: data.access_token, mode: 'session' };
    setAuthLabel(data.key.name);
    return data;
  }, []);

  /** The key form (anonymous / manual): a key saved earlier in this tab is used right away. The session token is
   * dropped, so nothing is ever sent with it while the form is shown. */
  const showKeyForm = useCallback((state: 'anonymous' | 'manual') => {
    const saved = tabStore.get(PLAYGROUND_KEY_STORE);
    auth.current = { mode: 'manual', value: saved || null };
    setSavedKey(saved || '');
    authViewRef.current = state;
    setAuthView(state);
  }, []);

  /** "Use my account": back from a pasted key to a fresh session token, without a reload. */
  const backToAccount = () => {
    setSwitching(true);
    mintSessionToken().then(
      () => setAuthView('session'),
      (err: unknown) => {
        if (err instanceof ApiError && err.code === 'no_active_key') setAuthView('no-key');
        else toast(errorText(err));
      },
    ).finally(() => setSwitching(false));
  };

  const authStarted = useRef(false);
  useEffect(() => {
    if (me.isPending || authStarted.current) return;
    authStarted.current = true;
    if (!me.signedIn) { showKeyForm('anonymous'); return; }
    mintSessionToken().then(
      () => setAuthView('session'),
      (err: unknown) => {
        if (err instanceof ApiError && err.code === 'no_active_key') setAuthView('no-key');
        else showKeyForm('anonymous');
      },
    );
  }, [me.isPending, me.signedIn, mintSessionToken, showKeyForm]);

  const onKeySubmit = (e: FormEvent) => {
    e.preventDefault();
    const v = (keyInput.current?.value ?? '').trim();
    auth.current = { mode: 'manual', value: v || null };
    tabStore.set(PLAYGROUND_KEY_STORE, v || null);
    toast(v ? 'Key saved for this tab' : 'Key cleared');
  };

  return { auth, authView, authViewRef, switching, authLabel, savedKey, keyInput, mintSessionToken, showKeyForm, backToAccount, onKeySubmit };
}
