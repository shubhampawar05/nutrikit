// A failed load: the error as a sentence and a Retry button (dashboard cards).
import { errorText } from '../api/client.ts';

export function ErrorRetry({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="dash-error">
      <p className="form-error" style={{ margin: 0 }}>{errorText(error)}</p>
      <button className="btn btn-ghost btn-sm" type="button" onClick={onRetry}>Retry</button>
    </div>
  );
}
