import { ReactNode } from 'react';
// Footer currently disabled - restore this import along with <AppFooter /> below.
// import { AppFooter } from './AppFooter';
import { SideRail } from './SideRail';

/**
 * Page frame shared by every route: the gradient canvas, the floating
 * navigation rail and the footer. Routes render inside `.app-main`, which is
 * the only scrolling region.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <SideRail />
      <div className="app-main">{children}</div>
      {/* <AppFooter /> */}
    </div>
  );
}
