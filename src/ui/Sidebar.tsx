import { go, type Route } from './useHash';
import { Icon } from './Icon';
import type { IconName } from './icons.generated';

export function Sidebar({ route, collapsed, onToggle }: { route: Route; collapsed: boolean; onToggle: () => void }) {
  const item = (hash: string, label: string, active: boolean, icon: IconName) => (
    <a className={`nav ${active ? 'active' : ''}`} href={hash} aria-label={label} title={label}>
      <Icon name={icon} />
      {!collapsed && <span>{label}</span>}
    </a>
  );
  return (
    <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Main">
      <button className="icon-btn" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        <Icon name="menu" />
      </button>
      {item('#/', 'Home', route.name === 'home', 'home')}
      {item('#/settings', 'Settings', route.name === 'settings', 'settings')}
    </nav>
  );
}
export { go };
