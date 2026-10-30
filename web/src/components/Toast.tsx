// Short status messages ("Key revoked") shown at the bottom of the screen.
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

const ToastContext = createContext<(text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const show = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toasts.map((t) => <div key={t.id} className="toast" role="status">{t.text}</div>)}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
