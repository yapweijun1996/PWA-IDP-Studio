import type { InputHTMLAttributes, ReactNode } from 'react';
/** Native checkbox with a visible, clickable label. */
export function Checkbox({ label, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) { return <label className="ds-row"><input {...props} type="checkbox" />{label}</label>; }
