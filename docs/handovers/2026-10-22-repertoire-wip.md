# Handoff: Repertoire Versions & Web Smart Chords Integration Checkpoint

**Date:** 2026-10-22
**Branch:** wip/repertoire-versions-smartchords-20261022
**Base Commit:** 567c103f10a1e2ae3adfc615b0029bd7cff3ae41
**Status:** Work In Progress (NO production release authorized)

---

## 1. Context & Implementation Status

### Repertoire Versions (R1–R4)
- **Status:** Independently approved (`APPROVED_LOCAL`), unreleased.
- **Scope:** Full backend schema normalization, collision-resistant version IDs, strict validation against flat vs version field conflicts, link clearing synchronization, and explicit `null` key preservation without defaulting to `'C'`.
- **Backend Test Suite:** 29/29 tests passing in `backend/src/features/repertoire/repertoire.versions.test.ts`.

### Web Repertoire ↔ Smart Chords Integration
- **Status:** `CHANGES_REQUIRED` (independent review).
- **Scope:** Initial integration implemented in `SongDetail.tsx`, `SmartChordsWorkspace.tsx`, and `App.tsx` connecting personal Smart Chords (`smart_chord_repertoire_links`) with repertoire songs.
- **Review Findings:** Independent review identified 4 pending findings that must be remediated:
  1. **Stale chord display across ministry switch:** Active chord state must be safely cleared/reset when switching active ministries to prevent displaying chords from prior ministry contexts.
  2. **Modal selection retention across songs:** Opening the link modal for different songs must reset any prior selection/draft state so that songs do not inherit unintended chord selections.
  3. **Persistent `initialChordId` navigation state:** `initialChordId` in `App.tsx` / `SmartChordsWorkspace` should be consumed once or cleared upon navigation to prevent unexpected selection overrides when entering Cifrador later.
  4. **HIGH Privacy Finding — Unauthorized legacy fallback:** Displaying legacy `song.smartChord` when personal links are absent risks exposing another user's uncurated or private chord sheet without explicit authorization. Must evaluate authorization boundaries and avoid unauthorized fallback exposure.

---

## 2. Next Actions

1. **Remediate the 4 pending Web findings:**
   - Address the HIGH privacy issue regarding unauthorized fallback to `song.smartChord`.
   - Clear active chord selection when the active ministry changes.
   - Reset modal chord selection when opening for a different song.
   - Clean up `initialChordId` state after handoff to `SmartChordsWorkspace`.
2. **Re-run verification:** Execute Vitest unit/integration tests and verify clean state.
3. **Roadmap after remediation:**
   - Mobile repertoire versions adaptation.
   - Universal chord font preference standardization.

---

## 3. Operational Constraints

- **Production Deployment:** NONE. No release, production deployment, or promotion is authorized.
- **Main Branch:** `main` must remain clean and unmodified until all review criteria pass.
