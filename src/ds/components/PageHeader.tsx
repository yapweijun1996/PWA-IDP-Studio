import type { ReactNode } from 'react';
/** Breadcrumb accepts links; title is the page's h1. */
export function PageHeader({ breadcrumb, title, description, actions }: { breadcrumb?: ReactNode; title: string; description?: string; actions?: ReactNode }) { return <header className="ds-page-header">{breadcrumb && <nav aria-label="Breadcrumb">{breadcrumb}</nav>}<div className="ds-row"><div><h1>{title}</h1>{description && <p className="ds-muted">{description}</p>}</div>{actions}</div></header>; }
