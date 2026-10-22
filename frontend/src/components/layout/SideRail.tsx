import { useCallback, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from '@/components/common/Icon';
import { PRIMARY_NAV, branding } from '@/config/branding';
import { useAuthUser } from '@/auth/useAuthUser';
import { useDismissable } from '@/hooks/useDismissable';

/**
 * The floating navigation rail: primary destinations at the top and the
 * signed-in user at the bottom. On narrow screens the same markup is laid
 * out as a floating bottom bar (see `.app-rail` in app.css), so there is one
 * navigation component for every breakpoint.
 */
export function SideRail() {
  const location = useLocation();

  const isActive = (to: string, matchPrefix?: boolean) =>
    matchPrefix ? location.pathname.startsWith(to) : location.pathname === to;

  return (
    <nav className="app-rail" aria-label="Primary">
      <ul className="app-rail-group">
        {PRIMARY_NAV.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={`app-rail-item ${isActive(item.to, item.matchPrefix) ? 'app-rail-item-active' : ''}`}
              aria-label={item.label}
              title={item.label}
            >
              <Icon name={item.icon} size={20} />
              <span className="app-rail-tooltip">{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      <UserMenu />
    </nav>
  );
}

function UserMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const user = useAuthUser();

  const close = useCallback(() => setOpen(false), []);
  useDismissable(wrapRef, close, open);

  return (
    <div className="app-rail-user" ref={wrapRef}>
      <button
        type="button"
        className={`app-rail-item app-rail-avatar ${open ? 'app-rail-item-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Signed in as ${user.name}`}
        title={user.name}
      >
        <span className="app-rail-initials">{user.initials}</span>
      </button>
      {open && (
        <div className="app-rail-menu" role="menu">
          <p className="app-rail-menu-name">{user.name}</p>
          <p className="app-rail-menu-meta">{user.email || branding.productName}</p>
          <button
            type="button"
            className="app-rail-menu-link app-rail-menu-signout"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              user.signOut();
            }}
          >
            <Icon name="arrow-left" size={15} />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
