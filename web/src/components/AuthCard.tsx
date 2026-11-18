// The single centred card the account pages use (invitations, password reset, email confirmation).
import type { ReactNode } from 'react';

export function AuthCard({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <main className="auth-shell single">
      <div className="auth-main">
        <div className="auth-card">
          <h1>{title}</h1>
          {lead ? <p className="muted">{lead}</p> : null}
          {children}
        </div>
      </div>
    </main>
  );
}
