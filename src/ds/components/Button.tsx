import type { ButtonHTMLAttributes } from 'react';
/** Native button semantics; loading prevents duplicate activation. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; loading?: boolean }
export function Button({ variant = 'secondary', size = 'md', loading, disabled, className = '', children, ...props }: ButtonProps) { return <button {...props} type={props.type ?? 'button'} className={`ds-button ds-button-${variant} ds-size-${size} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined}>{loading && <span role="status">Loading… </span>}{children}</button>; }
