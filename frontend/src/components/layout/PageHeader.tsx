import { ReactNode } from 'react';
import { BrandLogo } from './BrandLogo';

interface PageHeaderProps {
  /** Omit for pages whose body carries its own heading. */
  title?: ReactNode;
  /** Buttons/links aligned to the right of the bar. */
  actions?: ReactNode;
  showLogo?: boolean;
}

/**
 * Compact application bar for the full-page routes (Dashboard, Settings):
 * brand, page title, actions - nothing else. Any lead-in copy belongs in the
 * page body, where it lines up with the content it introduces.
 *
 * The bar is pinned with a constant height. That is deliberate: an earlier
 * version shrank as the page scrolled, and because a sticky element still
 * occupies space in the flow, each collapse yanked the content below it up by
 * ~90px and oscillated around the trigger point.
 */
export function PageHeader({ title, actions, showLogo = true }: PageHeaderProps) {
  return (
    <header className="page-header">
      {showLogo && <BrandLogo height={22} className="page-header-logo" />}
      {showLogo && title && <span className="page-header-divider" aria-hidden="true" />}
      {title && <h1 className="page-title">{title}</h1>}
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
