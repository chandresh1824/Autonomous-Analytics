/**
 * Single registry for every line icon in the app.
 *
 * Icons are declared once here and referenced by name (`<Icon name="home" />`)
 * so no component re-declares an inline `<svg>`. All glyphs are drawn on a
 * 24x24 grid with `currentColor` strokes, which lets them inherit colour and
 * size from whatever button or link they sit in.
 */

export type IconName =
  | 'home'
  | 'dashboard'
  | 'settings'
  | 'user'
  | 'send'
  | 'mic'
  | 'attach'
  | 'history'
  | 'plus'
  | 'panel-collapse'
  | 'panel-expand'
  | 'arrow-left'
  | 'info'
  | 'close'
  | 'chevron-down'
  | 'brain'
  | 'chart'
  | 'bolt'
  | 'pin'
  | 'check'
  | 'alert'
  | 'chat'
  | 'chat-new'
  | 'code'
  | 'sparkle'
  | 'table'
  | 'tag'
  | 'sigma'
  | 'link'
  | 'text'
  | 'target'
  | 'database'
  | 'search'
  | 'edit'
  | 'trash'
  | 'clock';

interface IconProps {
  name: IconName;
  size?: number;
  /** Stroke width on the 24x24 grid. */
  strokeWidth?: number;
  className?: string;
  /** Provide only when the icon is the sole label of its control. */
  title?: string;
}

const PATHS: Record<IconName, JSX.Element> = {
  sparkle: (
    <>
      <path d="M11 3.5 12.9 9l5.6 2-5.6 2L11 18.5 9.1 13l-5.6-2 5.6-2Z" />
      <path d="M18.5 15.5v5M16 18h5" />
    </>
  ),
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.8V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.8" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="8.5" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.6" />
      <rect x="13.5" y="11" width="7" height="9.5" rx="1.6" />
      <rect x="3.5" y="15" width="7" height="5.5" rx="1.6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 13.1a7.7 7.7 0 0 0 0-2.2l2-1.5-2-3.4-2.4.7a7.6 7.6 0 0 0-1.9-1.1L14.6 3H9.4l-.5 2.6a7.6 7.6 0 0 0-1.9 1.1L4.6 6l-2 3.4 2 1.5a7.7 7.7 0 0 0 0 2.2l-2 1.5 2 3.4 2.4-.7a7.6 7.6 0 0 0 1.9 1.1l.5 2.6h5.2l.5-2.6a7.6 7.6 0 0 0 1.9-1.1l2.4.7 2-3.4-2-1.5Z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6" />
    </>
  ),
  send: <path d="M4.5 11.6 20 4.5l-6.4 15.2-2-6.4-7.1-1.7Z" />,
  mic: (
    <>
      <rect x="9.2" y="3" width="5.6" height="11" rx="2.8" />
      <path d="M5.8 11.4a6.2 6.2 0 0 0 12.4 0" />
      <path d="M12 17.6V21" />
    </>
  ),
  attach: (
    <path d="M17.5 10.3 11 16.8a3.3 3.3 0 0 1-4.7-4.7l7.2-7.2a2.2 2.2 0 0 1 3.1 3.1l-7.1 7.2a1.1 1.1 0 0 1-1.6-1.6l6.4-6.4" />
  ),
  history: (
    <>
      <path d="M3.8 12a8.2 8.2 0 1 0 2.6-6" />
      <path d="M3.4 4.6v4h4" />
      <path d="M12 8v4.4l3 1.8" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  'panel-collapse': (
    <>
      <rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2.4" />
      <path d="M9.6 4.4v15.2" />
      <path d="m16.6 9.6-2.4 2.4 2.4 2.4" />
    </>
  ),
  'panel-expand': (
    <>
      <rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2.4" />
      <path d="M9.6 4.4v15.2" />
      <path d="m13.8 9.6 2.4 2.4-2.4 2.4" />
    </>
  ),
  'arrow-left': (
    <>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 11v5.2" />
      <path d="M12 7.8h.01" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  'chevron-down': <path d="m6 9.5 6 6 6-6" />,
  brain: (
    <>
      <path d="M12 5.2v13.6" />
      <path d="M9.4 5.2a2.6 2.6 0 0 0-2.6 2.6 2.6 2.6 0 0 0-1.6 4.7A2.7 2.7 0 0 0 7 17.4a2.6 2.6 0 0 0 5 .6" />
      <path d="M14.6 5.2a2.6 2.6 0 0 1 2.6 2.6 2.6 2.6 0 0 1 1.6 4.7 2.7 2.7 0 0 1-1.8 4.9 2.6 2.6 0 0 1-5 .6" />
    </>
  ),
  chart: (
    <>
      <path d="M5 20V11" />
      <path d="M12 20V4.5" />
      <path d="M19 20v-6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  bolt: <path d="M13.2 3 5.6 13.4h5L10 21l7.6-10.4h-5L13.2 3Z" />,
  pin: (
    <path d="M14.5 3.5 20.5 9.5 16.5 12.2 15 18.5 10 15.4 5 20.5 3.5 19 8.6 14 5.1 10.5 11.8 7.5 14.5 3.5Z" />
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.6v5" />
      <path d="M12 16.2h.01" />
    </>
  ),
  chat: (
    <path d="M20 12.2c0 3.8-3.6 6.9-8 6.9a9.4 9.4 0 0 1-2.6-.4L4.5 20l1.2-3.4a6.5 6.5 0 0 1-1.7-4.4c0-3.8 3.6-6.9 8-6.9s8 3.1 8 6.9Z" />
  ),
  'chat-new': (
    <>
      <path d="M20 12.2c0 3.8-3.6 6.9-8 6.9a9.4 9.4 0 0 1-2.6-.4L4.5 20l1.2-3.4a6.5 6.5 0 0 1-1.7-4.4c0-3.8 3.6-6.9 8-6.9s8 3.1 8 6.9Z" />
      <path d="M12 9.2v6M9 12.2h6" />
    </>
  ),
  code: (
    <>
      <path d="m9 8.5-4 3.5 4 3.5" />
      <path d="m15 8.5 4 3.5-4 3.5" />
    </>
  ),  table: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 12.2V5A1.5 1.5 0 0 1 5 3.5h7.2l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0Z" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  sigma: <path d="M17.5 5.5h-11l6 6.5-6 6.5h11" />,
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
    </>
  ),
  text: (
    <>
      <path d="M4.5 6.5h15" />
      <path d="M4.5 12h10" />
      <path d="M4.5 17.5h12.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
      <path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13" />
      <path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4.2L19 9.2a2.1 2.1 0 0 0 0-3L17.8 5a2.1 2.1 0 0 0-3 0L4 15.8Z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6.5 7l.9 11.6A1.6 1.6 0 0 0 9 20h6a1.6 1.6 0 0 0 1.6-1.4L17.5 7" />
      <path d="M10.2 11v5M13.8 11v5" />
    </>
  ),
};

export function Icon({ name, size = 18, strokeWidth = 1.7, className, title }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}
