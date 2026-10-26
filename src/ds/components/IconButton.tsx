import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons.generated';
import { Button, type ButtonProps } from './Button';
/** Label is required for the icon-only control. */
export function IconButton({ label, icon, ...props }: Omit<ButtonProps, 'children'> & { label: string; icon: IconName }) { return <Button {...props} aria-label={label}><Icon name={icon} /></Button>; }
