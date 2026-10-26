import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons.generated';
import { IconButton } from './IconButton';
import { Badge } from './Badge';
import { Tooltip } from './Tooltip';
import { useModalFocus } from './useModalFocus';
import { useMobile } from '../useMobile';
export interface SidebarItem { href: string; label: string; icon: IconName; active?: boolean; disabled?: boolean; reason?: string; count?: number }
export interface SidebarProps { items: readonly SidebarItem[]; footer?: ReactNode; mobileOpen?: boolean; onMobileClose?: () => void; collapsed?: boolean; onToggle?: () => void; onCollapsedChange?: (collapsed: boolean) => void }
/** Desktop rail persists independently of routes; phone navigation is a modal drawer. */
export function Sidebar({ items, footer, mobileOpen = false, onMobileClose, collapsed: controlledCollapsed, onToggle, onCollapsedChange }: SidebarProps) {
  const [localCollapsed, setLocalCollapsed] = useState(() => { try { return localStorage.getItem('idp-studio.sidebar') === 'collapsed'; } catch { return false; } });
  const collapsed = controlledCollapsed ?? localCollapsed;
  const toggle = () => { if (onToggle) onToggle(); else setLocalCollapsed(!collapsed); };
  const mobile = useMobile();
  const ref = useRef<HTMLElement>(null);
  const close = useCallback(() => onMobileClose?.(), [onMobileClose]);
  useModalFocus(mobile && mobileOpen, ref, close);
  useEffect(() => { try { localStorage.setItem('idp-studio.sidebar', collapsed ? 'collapsed' : 'expanded'); } catch { /* Persistence is optional when storage is blocked. */ } onCollapsedChange?.(collapsed); }, [collapsed, onCollapsedChange]);
  const rail = collapsed && !mobile;
  return (
    <>
      {mobile && mobileOpen && <div className="ds-sidebar-backdrop" onClick={close} aria-hidden="true" />}
      <aside ref={ref}
        className={`ds-sidebar ${rail ? 'ds-collapsed' : ''} ${mobileOpen ? 'ds-drawer-open' : ''}`}
        role={mobile && mobileOpen ? 'dialog' : undefined}
        aria-modal={mobile && mobileOpen ? true : undefined}
        aria-label="Main navigation" tabIndex={-1} hidden={mobile && !mobileOpen}>
        <IconButton icon={rail ? 'chevron-right' : 'chevron-left'}
          label={mobile ? 'Close navigation' : rail ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={mobile ? mobileOpen : !collapsed}
          onClick={() => mobile ? close() : toggle()} />
        <nav aria-label="Main">{items.map(item => {
          const reason = item.reason ?? 'Coming soon';
          const content = (
            <a className={`ds-nav ${item.active ? 'ds-active' : ''}`}
              href={item.disabled ? undefined : item.href}
              role={item.disabled ? 'link' : undefined}
              tabIndex={item.disabled ? 0 : undefined}
              aria-label={rail ? item.label : undefined}
              aria-current={item.active ? 'page' : undefined}
              aria-disabled={item.disabled || undefined}
              onClick={event => {
                if (item.disabled) event.preventDefault();
                else if (mobile) close();
              }}>
              <Icon name={item.icon} />
              {!rail && <span>{item.label}</span>}
              {item.count !== undefined && !rail && <Badge>{item.count}</Badge>}
              {item.disabled && !rail && <small>{reason}</small>}
            </a>
          );
          return <Tooltip key={item.href}
            text={item.disabled ? `${item.label}: ${reason}` : item.label}>{content}</Tooltip>;
        })}</nav>
        {footer && <footer>{footer}</footer>}
      </aside>
    </>
  );
}
