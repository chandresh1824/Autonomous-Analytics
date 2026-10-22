import type { IconName } from '@/components/common/Icon';

/**
 * Brand-level content that sits alongside the visual theme in
 * `src/styles/theme.css`: logos, product copy, navigation and the landing
 * page content. Changing the client or the wording of a screen is an edit
 * here — no component holds hard-coded brand strings.
 */

export const branding = {
  /** Assets are served from `public/`, so these are absolute URLs. */
  logo: {
    /** Square mark (the diamond), for small sizes and the browser tab icon. */
    mark: '/srm-title-logo.png',
    wordmark: '/logo.png',
    alt: 'SRMTech',
  },
  productName: 'Autonomous Analytics',
  footer: {
    owner: 'DHL',
    year: 2026,
    note: 'All rights reserved',
  },
  user: {
    name: 'User',
  },
} as const;

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Treat any deeper path as this item being active (e.g. /settings/kpis). */
  matchPrefix?: boolean;
}

/** Primary destinations shown on the floating navigation rail. */
export const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: 'home' },
  { to: '/conversation', label: 'Recent Conversations', icon: 'chat', matchPrefix: true },
  { to: '/settings', label: 'Semantic Model', icon: 'database', matchPrefix: true },
];

/** Starter questions offered under the hero ask box on the Home screen. */
export const SUGGESTED_QUESTIONS: string[] = [
  'Volume resolved by nov 2025 ?',
  'Resolved Volume by service line for November 2025',
  'Monthly trend of Resolved Volume in 2025',
  'Top 5 hub centers by Resolved Volume this year',
  'Resolved Volume by priority and partner for the last quarter',
];

export interface HighlightCard {
  icon: IconName;
  title: string;
  description: string;
}

/** The three value-proposition cards at the bottom of the Home screen. */
export const HOME_HIGHLIGHTS: HighlightCard[] = [
  {
    icon: 'brain',
    title: 'Governed Answers',
    description:
      'Ask questions in natural language and instantly receive governed KPI insights and trends.',
  },
  {
    icon: 'chart',
    title: 'Smart Analytics',
    description:
      'Explore performance metrics using interactive charts, tables, and month-over-month comparisons.',
  },
  {
    icon: 'bolt',
    title: 'Faster Decisions',
    description:
      'Identify issues, improvements, and opportunities faster with AI-driven recommendations.',
  },
];
