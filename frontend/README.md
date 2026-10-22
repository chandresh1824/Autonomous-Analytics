# Autonomous Analytics — Frontend

A React + TypeScript frontend for a GenAI analytics chat application. Consumes the
FastAPI backend in `../backend`.

## Stack

- React 18 + TypeScript + Vite
- React Router v6
- TanStack Query v5 (server state, caching, mutations)
- axios (HTTP client)
- Recharts (charts)
- Plain CSS design system (no component library)

## Getting started

```bash
npm install
npm run dev -- --port 5173
```

By default the app talks to `http://localhost:8000`. To point at a different
backend instance, set `VITE_API_BASE_URL`, e.g. via a `.env.development.local`
file:

```
VITE_API_BASE_URL=http://localhost:8123
```

## Build

```bash
npm run build
```

Runs `tsc -b` (type checking) followed by `vite build`.

## Authentication (Microsoft Entra ID)

The app is gated: opening any URL while signed out redirects straight to
Microsoft, and no route renders and no API call is made until sign-in
succeeds. There is no "sign in" button to bypass and no anonymous mode - if
the Entra settings are missing the app shows a configuration notice instead of
letting anyone in.

- `src/auth/msalConfig.ts` — configuration read from the environment
- `src/auth/msalInstance.ts` — the single MSAL instance; initialized and the
  redirect processed in `main.tsx` before the first render
- `src/auth/AuthGate.tsx` — the gate, wrapped around everything in `providers.tsx`
- `src/auth/useAuthUser.ts` — signed-in user's name/email/initials, and sign-out
- `src/services/authHeaders.ts` — bearer token for the axios client and the SSE stream

Flow: authorization code with PKCE (MSAL's browser default, no client secret).
Tokens are cached in `sessionStorage`, so they do not outlive the tab; a new
tab re-authenticates silently against the existing Entra session.

### Setting it up

1. Register an application in Entra ID and add your app origin (e.g.
   `http://localhost:5173`) as a redirect URI under **Single-page application**
   — not "Web", which expects a client secret.
2. Copy `.env.example` to `.env` and fill in the tenant and client ids. The
   redirect URI must match the app's origin exactly.
3. Restart the dev server: Vite only reads `.env` at startup.

### Protecting the backend

Signing in here authenticates the **UI only**. The backend does not yet
validate bearer tokens, so its endpoints remain reachable without a token. To
close that gap: expose a scope from a backend app registration, set
`VITE_AZURE_ENTRA_API_SCOPE`, and validate the token server-side. The frontend
then attaches `Authorization: Bearer …` to every call automatically — that
part is already wired.

## Theming

All visual design tokens live in **`src/styles/theme.css`** — brand ramp, canvas
gradient, surfaces, status colours, typography, radii, shadows, layout metrics and
the chart palette. It is the only file to edit when re-skinning the app:

- `src/styles/theme.css` — raw brand tokens (`--brand-500`, `--app-gradient`, …)
- `src/styles/variables.css` — maps those onto semantic roles (`--color-accent`,
  `--color-surface`, …), which every component stylesheet uses
- `src/config/branding.ts` — logos, product name, footer text, rail navigation,
  the Home screen's suggested questions and highlight cards

No component hard-codes a colour, radius or font, so changing `--brand-500` (and
the rest of the ramp) re-themes every screen, including charts.

## Layout

Every route renders inside `AppShell`: the gradient canvas, a floating navigation
rail (Home / Dashboard / Settings plus the user menu) and the footer. Below 720px
the rail automatically becomes a floating bottom bar; below 900px the chat history
becomes an overlay drawer.

## Project structure

```
src/
├── app/            App shell, routes, providers (React Query + Router)
├── pages/          HomePage, ChatPage, DashboardPage, SettingsPage
├── config/         branding.ts — logos, nav, landing-page content
├── components/
│   ├── layout/     AppShell, SideRail, AppFooter, PageHeader, BrandLogo
│   ├── common/     Icon (single SVG registry), IconButton, SectionCard, StatusPill,
│   │               NumberedList, Chip, FeatureCard, Button, Card, Spinner, EmptyState,
│   │               Tabs, Modal, Badge, Toggle, TagInput, Toast
│   ├── chat/       MessageList, MessageBubble, AskBox, AgentProgress, KpiCards, ConversationSidebar
│   ├── charts/     ChartRenderer (Recharts dispatch by visualization type)
│   ├── tables/     DataTable
│   └── settings/   Connection/SemanticModel/KPI panels, forms and lists
├── features/       React Query hooks per domain (chat, connections, semantic-model, kpi)
├── services/       apiClient (axios instance)
├── types/          api.ts — full backend API contract
├── hooks/, utils/, styles/
└── main.tsx
```

## Notes

- Chat is a plain REST call (no streaming). While a message is in flight, the UI
  simulates the agent's progress steps (cycling through the known step labels)
  and replaces them with the real `progress` array once the response lands.
- Settings → Semantic Model → "Generate from datasource" drafts a model via the
  LLM but does not save it; review it, then "Save as draft" imports it.
- KPI create/edit/delete/enable/disable are drafts until "Publish changes" is
  clicked.
