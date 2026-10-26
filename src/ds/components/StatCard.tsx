import type { ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons.generated';
import { Card } from './Card';
/** Value is associated with its visible label. */
export function StatCard({ icon, label, value, caption }: { icon: IconName; label: string; value: ReactNode; caption?: string }) { return <Card><Icon name={icon} /><dl><dt>{label}</dt><dd className="ds-stat-value">{value}</dd></dl>{caption && <p className="ds-muted">{caption}</p>}</Card>; }
