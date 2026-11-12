// A password (or secret) input with a show/hide button. Takes every <input> prop, including react-hook-form's
// register() output, so it drops in wherever a type="password" input was.
import { useState, type ComponentProps } from 'react';
import { Icon } from './Icon.tsx';

type Props = Omit<ComponentProps<'input'>, 'type'> & { /** What the button names, e.g. "password" or "key". */ noun?: string };

export function PasswordInput({ noun = 'password', className, ...input }: Props) {
  const [shown, setShown] = useState(false);
  return (
    <span className="pw-wrap">
      <input {...input} className={className} type={shown ? 'text' : 'password'} spellCheck={false} autoCapitalize="off" />
      <button
        type="button"
        className="pw-toggle"
        aria-label={shown ? `Hide ${noun}` : `Show ${noun}`}
        aria-controls={input.id}
        aria-pressed={shown}
        title={shown ? `Hide ${noun}` : `Show ${noun}`}
        onClick={() => setShown((s) => !s)}
      >
        <Icon name={shown ? 'eye-off' : 'eye'} />
      </button>
    </span>
  );
}
