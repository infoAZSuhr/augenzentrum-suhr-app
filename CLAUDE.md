# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Wichtig:** Lies zusätzlich [docs/KI-PLAYBOOK.md](docs/KI-PLAYBOOK.md) — Methodik, Deploy-/Release-Workflow und hart erarbeitete Fallstricke (Liris-Webview, Firestore, Electron). Pflichtlektüre vor Änderungen.

## Overview

Internal practice-management web app for **Augenzentrum Suhr** (Swiss ophthalmology clinic). German UI throughout — keep all user-facing strings in German. Runs as a Vite/React SPA hosted on Firebase Hosting and, optionally, as a packaged Electron desktop app.

Firebase project: `azsdb-999d6` (config is hard-coded in [src/lib/firebase.ts](src/lib/firebase.ts) — it's a client-side web key, not a secret).

## Commands

```bash
npm run dev                    # Vite dev server on :5173
npm run build                  # tsc + vite build → dist/
npm run electron:dev           # Vite + Electron concurrently
npm run electron:build         # Build SPA + package portable .exe via electron-builder

# Deploy (requires firebase CLI login)
firebase deploy --only hosting --project azsdb-999d6

# Data-pipeline scripts (Node, no auth — public sources).
# Each writes large JSON to public/ (gitignored) + a small meta.json (committed).
# Append :force to bypass "size unchanged" short-circuit; :deploy to also build + deploy.
npm run update-sl              # BAG Spezialitätenliste (monthly, ~27th)
npm run update-refdata         # Refdata Artikelstamm
npm run update-lieferengpaesse # BWL Lieferengpässe
npm run update-zurrose         # Zur Rose Nota-Liste (uses scripts/Nota-Liste.xlsx)
npm run update-all[:deploy]    # SL + refdata + zurrose
```

There are no tests, no lint config, no formatter. Type-checking happens as part of `npm run build`. GitHub Actions cron the four update scripts daily (04:30 UTC) and auto-deploy — see [.github/workflows/](.github/workflows).

## Architecture

### Frontend stack
React 18 + TypeScript (strict) + Vite + TailwindCSS + React Router (HashRouter — required for Firebase Hosting + Electron file://) + TanStack Query + Zustand. UI primitives live in [src/components/ui](src/components/ui); shell + nav in [src/components/layout](src/components/layout).

### Backend
Firebase only — Auth (email/password, `browserSessionPersistence`), Firestore, Storage. No custom backend, no Cloud Functions. All business logic runs in the browser. Firestore rules ([firestore.rules](firestore.rules)) are permissive (any authenticated user reads/writes most collections); finer-grained access control is enforced **client-side** in [src/lib/AuthContext.tsx](src/lib/AuthContext.tsx).

### Auth & permissions — the central pattern
Every protected route is wrapped in `<PermissionGate allowed={canAccessX}>` in [src/App.tsx](src/App.tsx). The booleans come from `useAuth()` and are computed by `permGranted()` in [AuthContext.tsx](src/lib/AuthContext.tsx:229). Logic to know:
- Roles: `admin`, `arzt`, `mpa`, `geschaeftsleitung`, `gast`. A user may also have `additionalRoles[]`.
- A user is **approved** only when `status === 'approved' && !locked`. Pending/rejected/locked users get dedicated screens (see `AppRoutes` in [App.tsx](src/App.tsx:165)).
- Module access defaults: admin = all; users with an explicit `permissions` object use it verbatim; otherwise arzt/mpa default to full access except `recall` (GL only). Username→email lookup happens via a Firestore query at login (users sign in with username, not email).
- Failed logins → `auth/too-many-requests` automatically writes `locked: true, lockedReason: 'tooManyAttempts'` to the user doc.
- Two independent inactivity timers exist (10 min in `AppShell`, 15 min in `App.tsx` `InactivityLogout`). They're not coordinated — be aware before changing either.

### Module structure
Top-level pages are in [src/pages](src/pages). Larger features are lazy-loaded modules in [src/modules](src/modules) (`ivom`, `lager`, `planung`, `onboarding`, `browser`), each with its own `index.tsx` that defines nested routes. When adding a new module, follow this pattern: lazy import in `App.tsx`, wrap with `PermissionGate`, define sub-routes in the module's own `index.tsx`.

### Firestore data layer
All Firestore reads/writes are wrapped in `src/lib/firestore*.ts` files (one per domain: `firestorePatients`, `firestoreLager`, `firestorePlanung`, `firestoreRecall`, `firestoreTasks`, `firestoreOnboarding`, `firestoreDocuments`, `firestoreAkv`, `firestoreNotices`). Components should call these helpers rather than using `firebase/firestore` directly.

### Planung-Requests workflow (non-obvious)
The Einsatzplanung approval flow uses a `planungRequests` Firestore collection with statuses `pending | provisional | approved | rejected | adjustment | dismissed | withdrawn`. Critical detail: when a user submits a request, the plan entries are written **immediately** with a "warten auf Freigabe" comment — admin approval just updates the comment, doesn't write the entry. Reject/withdraw must then delete the entry. The full state machine lives in `approveRequest` / `rejectRequest` / `withdrawRequest` in [AppShell.tsx](src/components/layout/AppShell.tsx). All schedule mutations use Firestore dot-notation atomic updates against `planung/{year}` docs (fields `schedule.{person}.{date}` and `comments.{person}.{date}`).

### External data files
Four large JSON files (`sl-data.json`, `refdata-data.json`, `lieferengpaesse-data.json`, `zurrose-nota-data.json`) live in `public/` and are **gitignored** — they are downloaded at deploy time by the update scripts and end up bundled with the hosted app. The small `*-meta.json` files next to them **are** committed so the scripts can detect "no change, skip". Don't try to read these JSONs in dev unless you've run the relevant `update-*` script.

### Electron
Two-process app in [electron/](electron) — `main.cjs` opens `http://localhost:5173` in dev or `dist/index.html` in prod; `preload.cjs` exposes a single IPC channel `open-ics` (writes an .ics to temp + opens it with the OS calendar app). The webview tag is enabled (used by the embedded browser module). External links are forced to the default browser.

### Path alias
`@/*` → `src/*` (see [tsconfig.json](tsconfig.json)).
