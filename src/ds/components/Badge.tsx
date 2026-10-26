import type { ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons.generated';
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
/** Always include meaningful text; tone never carries status alone. */
export function Badge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: IconName; children: ReactNode }) { return <span className={`ds-badge ds-tone-${tone}`}>{icon && <Icon name={icon} size="sm" />}{children}</span>; }
