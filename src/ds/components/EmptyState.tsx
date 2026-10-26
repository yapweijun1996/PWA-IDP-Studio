import type { ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons.generated';
/** Title and explanation are visible; action may be a link or button. */
export function EmptyState({ title, description, icon = 'document', action }: { title: string; description?: string; icon?: IconName; action?: ReactNode }) { return <div className="ds-empty"><Icon name={icon} size="lg" /><h2>{title}</h2>{description && <p>{description}</p>}{action}</div>; }
