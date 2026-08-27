# Mobile, PWA, Routing, and Accessibility Audit

## Objective

Correct the confirmed mobile navigation, routing, authentication bootstrap, ministry-scoped loading, accessibility, localization, and PWA defects without changing domain behavior or using persistent demo-account writes.

## Context

The React/Vite client is a state-driven single page application. It has a desktop sidebar, a four-item mobile bottom bar, generated Workbox service worker configuration, and no automated test infrastructure. The audit requires evidence at 360x800, 390x844, and 412x915 in light and dark themes.

## Current Behavior

- Section and detail navigation is held in React state, so URLs, refresh, deep links, and browser history do not represent the visible screen.
- Authentication bootstrap calls the authenticated ministry endpoint even when no valid stored token exists.
- Smart Chords loads songs and artists without the selected ministry and does not guard against stale responses.
- Mobile navigation omits Smart Chords and hides the sidebar actions needed for profile, ministry switching, creation, joining, and logout.
- Schedule tabs, floating labels, icon actions, cards, date/time display, and character-by-character Smart Chord previews have confirmed accessibility or localization defects.
- Workbox runtime caching includes API responses, and the manifest has only a shared SVG icon and no `lang`.
- No unit, integration, or end-to-end tests currently exist.

## Desired Behavior

- Stable routes for home, repertoire, songs, Smart Chords, schedules, schedule details, and ministry sections, with refresh/deep-link/back/forward support.
- Authenticated loading starts only after auth readiness and a valid token; ministry-dependent loading is cancellable or ignores obsolete results.
- All five main modules and all required account/ministry actions remain reachable on mobile.
- Accessible names, keyboard navigation, visible focus, 44x44 touch targets, semantic interactive elements, non-color-only state, reduced motion, and readable dark-theme secondary text.
- pt-BR display dates (`dd/MM/yyyy`) and 24-hour times while preserving ISO values internally.
- Versioned static-shell-only service worker with no API, Firestore, token, authenticated response, or user-data page runtime caching; explicit offline and update behavior.
- Automated tests use mocks or disposable local fixtures for writes. Demo-account journeys are read-only.

## Scope

### In Scope

- Web routing and navigation state.
- Auth bootstrap and ministry-aware request lifecycle.
- Mobile header/account/ministry menu and five-destination bottom navigation.
- Confirmed accessibility, form, modal, schedule, card, localization, responsive, and visual hierarchy corrections.
- PWA manifest, icons, service-worker registration/update/offline behavior, and cache policy.
- Vitest/Testing Library and Playwright infrastructure with isolated network mocks.
- Documentation updates for defects corrected or still pending.

### Out of Scope

- Domain terminology, authorization-policy redesign, Firestore schema changes, backend persistence migrations, and unrelated feature work.
- Persisted writes with the demo account.
- Broad state-management or backend architecture rewrites.
- Silencing errors or claiming unexecuted validations as successful.

## Architecture Impact

Use React Router as a thin URL/state boundary around the existing application. Retain existing view components and API client, adding only reusable route, locale, auth-bootstrap, and request-lifecycle helpers where necessary. Use Vitest with jsdom for focused unit/integration tests and Playwright route interception for isolated browser journeys. Configure Vite PWA to precache revisioned shell/static assets only and expose update/offline state to the UI.

## Route Map

- `/` - dashboard
- `/escalas` - schedules
- `/escalas/:scheduleId` - schedule detail
- `/repertorio` - repertoire
- `/repertorio/:songId` - song detail
- `/repertorio/pastas/:folderId` - folder detail
- `/cifras` - Smart Chords
- `/ministerio` - ministry overview
- `/ministerio/:section` - ministry subsection

Unknown entity IDs should produce a recoverable not-found state or return to the collection without losing the current authenticated shell.

## Implementation Plan

- [x] Add route model and synchronize module/detail navigation with browser history.
- [x] Gate authenticated startup on auth readiness and a valid token.
- [x] Scope Smart Chords and shared data loading to the selected ministry; cancel or ignore stale requests.
- [x] Add complete mobile primary navigation and account/ministry menu.
- [x] Correct confirmed accessibility, tab, floating-label, locale, modal, semantic-card, role-wrap, contrast, reduced-motion, and empty-state defects.
- [x] Replace unsafe runtime API caching with a versioned static-shell-only PWA policy, offline fallback, update prompt, pt-BR manifest metadata, and required icons.
- [x] Add Vitest/Testing Library coverage for auth, ministry changes, routes/history, locale, accessible interactions, and service-worker lifecycle.
- [x] Add mocked Playwright journeys for the three required viewports and both themes, with horizontal-overflow assertions and critical screenshots.
- [x] Run all available validation, review screenshots and `git diff`, update system-status documentation, and archive this plan only if completion criteria are met.

## Files Expected to Change

Primarily `web/package.json`, `web/package-lock.json`, `web/vite.config.ts`, `web/index.html`, selected files in `web/src/`, new web test/config files, generated icon assets in `web/public/`, this ExecPlan, and `docs/system-status.md`. Backend files will change only if a required contract defect cannot be fixed safely at the client boundary.

## Tests

- Unit/integration: auth readiness/token gating, stale ministry request protection, route mapping/history, date/time formatting, accessible names and keyboard activation, PWA registration/update/offline callbacks.
- E2E: mocked login, dashboard, all mobile navigation/profile actions, repertoire/detail/form, Smart Chords, schedules/detail/chat/edit tabs, ministry/members/config, long modals, keyboard simulation, both themes, and all required viewports.
- Every viewport/theme run asserts `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
- Any write path is intercepted and fulfilled from in-memory test fixtures.

## Validation

- `npm test` in `web/`.
- `npm run build` in `web/` and `backend/`.
- Playwright suite and screenshot review in all required projects.
- Backend lint only as a known-state check unless its absent infrastructure becomes in scope.
- Inspect built service worker for API/runtime caching patterns and manifest metadata.
- Review `git diff --check`, `git diff`, and `git status --short` without discarding existing worktree changes.

## Risks

- Retrofitting routes around stateful views can trigger duplicate fetching or stale detail state.
- PWA behavior differs between development and production builds; validation must use the built preview.
- Full journey mocks can become too coupled to incidental API call ordering; fixtures should model contracts rather than implementation timing.
- PNG icon generation can distort the established mark or violate maskable safe zones; generated assets require visual inspection.
- Existing backend Smart Chords authorization/contract inconsistencies may remain outside a safe client-only correction and must be documented if unresolved.

## Decisions

- 2026-08-27: selected React Router over a custom History API router because browser history and parameterized deep links are core acceptance criteria and a maintained router reduces bespoke edge cases.
- 2026-08-27: rejected a broader data/state rewrite because it would exceed the confirmed defects and increase regression risk.
- 2026-08-27: selected Vitest/Testing Library plus Playwright because they align with the existing Vite/React application and cover DOM behavior plus real browser layout/PWA behavior.
- 2026-08-27: Chromium is the required baseline browser for the specified viewport matrix; additional engines are not claimed unless executed.
- 2026-08-27: no API runtime caching is permitted, even for nominally public endpoints, because current contracts and authentication boundaries are inconsistent.
- 2026-08-27: user-data routes remain navigable offline only as a generic shell/fallback; previously viewed user data is not persisted by the service worker.

## Progress Notes

- 2026-08-27: preserved the existing documentation harness worktree and completed the read-only baseline.
- 2026-08-27: backend build passed; backend lint is unavailable because ESLint is not installed/configured; web baseline build emitted successful Vite output but needs a definitive rerun because the command runner did not report an exit code.
- 2026-08-27: confirmed root causes for auth bootstrap, local-state-only routing, missing mobile Smart Chords access, missing mobile account/ministry actions, ministry-less Smart Chords requests, unsafe API runtime caching, and the listed accessibility/localization defects.
- 2026-08-27: reviewed current official React Router, Vite PWA, and Vitest guidance before selecting the implementation direction.
- 2026-08-27: implemented URL-backed modules/details/subsections, auth gating, stale-request cancellation, complete mobile navigation/account actions, accessibility/localization fixes, and a static-shell-only PWA policy.
- 2026-08-27: added 13 focused Vitest assertions across eight files and mocked Playwright journeys. No non-auth write reached an external service.
- 2026-08-27: the full Chromium matrix passed at 360×800, 390×844, and 412×915 in light/dark. The offline test ran once; five duplicate project instances were intentionally skipped.
- 2026-08-27: visual review found intrinsic grid expansion that clipped dashboard actions despite a hidden document overflow; the test was strengthened to inspect interactive-element bounds and the grid was corrected with `minmax(0, 1fr)`.
- 2026-08-27: built service-worker inspection confirmed only revisioned static shell/assets and `/offline.html`; no runtime API/auth/user-data cache is present.
- 2026-08-27: final `npm test` in web passed 8 files/13 tests; final web and backend builds passed.
- 2026-08-27: final Playwright run passed 13 tests with five intentional duplicate offline skips and generated 48 critical-state screenshots in the local HTML report, including the song form and restored viewport after simulated keyboard reduction.
- 2026-08-27: backend `npm run lint` remains **NOT OPERATIONAL** because `eslint` is not installed/configured; web has no lint script.
- 2026-08-27: final service-worker artifact contains only static precache entries and a navigation-only `NetworkOnly` route with precached offline fallback; zero API/auth/token/Firestore entries or cached navigation responses. Manifest language is `pt-BR` with 192/512/maskable PNGs.
- 2026-08-27: final review caught and removed `offline.html` as a global navigation fallback because that would also replace online navigations after worker activation; the E2E now proves both controlled online navigation and failure-only offline fallback.
- 2026-08-27: `git diff --check` passed. Review confirmed no backend functional file change and no generated report/build artifact is intended for version control.

## Final Result

Completed. The requested client defects are corrected and validated with isolated tests. The backend was not functionally changed. Remaining Smart Chords endpoint/auth/list persistence inconsistencies, real Firebase/browser-device integration, backend test coverage, lint infrastructure, CI/CD, Docker, migrations, and `.env.example` remain explicitly outside this correction or **Unknown / Not yet verified** as recorded in `docs/system-status.md`.
