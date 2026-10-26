import { useCallback, useState, type ReactNode } from 'react';
import { Sidebar, type SidebarItem } from './Sidebar';
import { Topbar } from './Topbar';
import { useMobile } from '../useMobile';
/** Layout-only shell. Navigation and data remain caller-owned. */
export function AppShell({ children, items, search, right, footer, brand }: { children: ReactNode; items: readonly SidebarItem[]; search?: ReactNode; right?: ReactNode; footer?: ReactNode; brand?: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobile = useMobile();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('idp-studio.sidebar') === 'collapsed'; } catch { return false; } });
  const close = useCallback(() => setMobileOpen(false), []);
  const toggle = () => { if (mobile) setMobileOpen(!mobileOpen); else setCollapsed(!collapsed); };
  return <div className="ds-shell"><Topbar brand={brand} search={search} right={right} onMenuToggle={toggle} menuExpanded={mobile ? mobileOpen : !collapsed} /><div className="ds-shell-body"><Sidebar items={items} footer={footer} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} mobileOpen={mobileOpen} onMobileClose={close} /><main className="ds-workspace">{children}</main></div></div>;
}
