import type { HTMLAttributes } from 'react';
/** Semantic section; provide aria-label or a visible heading when needed. */
export function Card({ className = '', ...props }: HTMLAttributes<HTMLElement>) { return <section {...props} className={`ds-card ${className}`} />; }
