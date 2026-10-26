import type { SelectHTMLAttributes } from 'react';
/** Native keyboard selection; provide visible label or aria-label. */
export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`ds-input ${className}`} />; }
