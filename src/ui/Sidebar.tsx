import { go, type Route } from './useHash';

export function Sidebar({ route, collapsed, onToggle }: { route: Route; collapsed: boolean; onToggle: () => void }) {
  const item = (hash: string, label: string, active: boolean, icon: string) => (
    <a className={`nav ${active ? 'active' : ''}`} href={hash} aria-label={label} title={label}>
      <span aria-hidden>{icon}</span>
      {!collapsed && <span>{label}</span>}
    </a>
  );
  return (
    <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Main">
      <button className="icon-btn" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        ☰
      </button>
      {item('#/', 'Home', route.name === 'home', '⌂')}
      {item('#/settings', 'Settings', route.name === 'settings', '⚙')}
    </nav>
  );
}
export { go };
