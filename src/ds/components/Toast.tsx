import type { ReactNode } from 'react';
/** Keep mounted when possible so live updates are announced. */
export function Toast({ children, label = 'Notifications' }: { children: ReactNode; label?: string }) { return <section className="ds-toast" role="region" aria-label={label}><div role="status" aria-live="polite" aria-atomic="true">{children}</div></section>; }
