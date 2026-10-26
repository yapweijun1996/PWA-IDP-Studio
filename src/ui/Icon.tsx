import { ICONS, type IconName } from './icons.generated';

export function Icon({ name, size = 'md', label }: { name: IconName; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  return (
    <svg
      className={`icon icon-${size}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label !== undefined ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
