import { branding } from '@/config/branding';

export function AppFooter() {
  const { owner, year, note } = branding.footer;
  return (
    <footer className="app-footer">
      <span>
        {owner} &copy; {year} &middot; {note}
      </span>
    </footer>
  );
}
