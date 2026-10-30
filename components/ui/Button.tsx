import type { ButtonHTMLAttributes } from 'react';
import { Spinner } from './Spinner';
import { buttonClass, type ButtonSize, type ButtonVariant } from './styles';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Prepends a spinner, disables the button and sets aria-busy. Keep a visible label ("Syncing…"). */
  loading?: boolean;
}

export function Button({ variant = 'primary', size = 36, className = '', type = 'button', loading = false, disabled, children, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className, { loading })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
