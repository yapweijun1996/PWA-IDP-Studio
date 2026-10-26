import type { ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
/** Error is assertive; informational changes remain polite. */
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'error'; children: ReactNode }) { return <div className={`ds-notice ds-tone-${tone === 'error' ? 'danger' : tone}`} role={tone === 'error' ? 'alert' : 'status'}><Icon name={tone === 'info' ? 'info' : 'alert'} /><span>{children}</span></div>; }
