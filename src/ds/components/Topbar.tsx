import type { ReactNode } from 'react';
import { IconButton } from './IconButton';
/** Sticky shell slots; AppShell owns scroll visibility. */
export function Topbar({ brand = 'IDP Studio', search, right, onMenuToggle, menuExpanded, showMenu = true, menuControls }: { brand?: ReactNode; search?: ReactNode; right?: ReactNode; onMenuToggle: () => void; menuExpanded?: boolean; showMenu?: boolean; menuControls?: string }) { return <header className="ds-topbar">{showMenu && <IconButton icon="menu" label="Toggle navigation" aria-expanded={menuExpanded} aria-controls={menuControls} onClick={onMenuToggle} />}<strong>{brand}</strong><div className="ds-topbar-search">{search}</div><div className="ds-row">{right}</div></header>; }
