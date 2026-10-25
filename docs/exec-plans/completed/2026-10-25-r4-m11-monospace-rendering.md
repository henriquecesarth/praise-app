# R4-M11 — Monospace and Courier New rendering

Status: COMPLETE — code and CI PASS; ready for physical Android retest.

Scope: Flutter monospaced chord/lyric presentation and focused tests only. No parser, persistence, backend, web, progression, toolbar or preference changes. No APK, production deployment or database writes.

Evidence: R4-M10 fixes each fragment width using a standalone TextPainter, then places SelectableText inside it. SelectableText uses inherited DefaultTextStyle and wraps through EditableText by default; the painter does not merge that inherited style. Grouping fragments and scrolling their parent does not remove their individual width constraints. Flutter RenderEditable additionally subtracts its caret margin from the available paragraph width (`_adjustConstraints`), even in read-only SelectableText. Both-font regression fixtures reproduce vertical splitting with the old measurement/SelectableText combination. This is a confirmed layout/measurement defect; the precise Android fallback font on the user's device is Unknown / Not yet verified.

Decision: isolate an early monospace branch. Use non-wrapping Text with SelectionArea and intrinsic widths from the displayed text itself, preserving inherited style, scaler, locale and fallback. Wrap complete word groups; horizontally scroll oversized words. Reserve chord-label spacing as presentation padding. Keep the proportional algorithm intact.

- [x] Inspect clean WIP, reader, parser contracts, tests and workflows.
- [x] Implement isolated rendering and geometry/selection/reader regressions for both fonts.
- [x] Review diff and commit/push only WIP.
- [x] Existing GitHub Actions analyzer and focused tests pass; record evidence and archive plan.

Local Flutter execution is unavailable: host macOS 12.7.6 is below the installed SDK runtime requirement, as recorded in R4-M10. Validation will use the existing Ubuntu workflow (analyze and focused tests; no APK).

Validation history:
- Run 40229239727: analyzer requested a const constructor in the legacy reproduction fixture; fixed before tests ran.
- Run 40229398475: analyzer PASS; 595 PASS / 1 FAIL. Both-font legacy reproductions, all 24 geometry/selection cases, and all 12 reader cases passed. One older monospace assertion assumed the entire line must scroll; it now checks the exact overflow extent of the first word and wrapping of the next word. Proportional assertions remain intact. Oversized-word tests additionally exercise a real horizontal drag before checking end-of-content visibility.
- Code/test commit under final validation: `cd57879f35fe2e723004e96e9cb5eaa6a42e735e`; run 40229633871.

Remote synchronization: two concurrent R4-M10 APK workflow commits had no net tree change; preserved them by rebasing the unpublished hotfix and pushing normally. APK workflow remains manual-only and was not triggered by this task.

## Final verification

- CI: https://github.com/henriquecesarth/praise-app/actions/runs/40229633871 — SUCCESS on Ubuntu, Flutter 3.47.7 / Dart 3.13.5.
- Validated code/test commit: `cd57879f35fe2e723004e96e9cb5eaa6a42e735e`.
- `flutter analyze`: No issues found (11.2 seconds).
- Focused suite: **596/596 PASS**, including all existing proportional-font assertions and 38 new cases (2 legacy defect reproductions; 24 font/width/scale/transposition glyph-geometry, selection and scrolling cases; 12 real-reader font/width/scale cases exercising -1/+2, font-size control and Intro/Interlúdio progression geometry).
- Geometry verifies single-line glyph boxes and tier heights, fragment containment, chord gaps/anchors, complete-word grouping, safe wrapping, scroll extent/drag/end visibility, and actual selected paragraph ranges.
- `git diff --check` PASS. Source diff adds only a monospace branch in ChordLyricLine. Reader-screen dispatch already correctly sends both fonts to it; no screen source modification needed. Proportional layout and progression renderer are unchanged.
- No parser/storage/normalizer/backend/web changes, font preference changes, APK build, Argon, production deployment or live database writes.
- Remaining limitation: Flutter widget tests use test fonts; appearance with actual Android fonts/fallback and touch selection on the user's device is **Unknown / Not yet verified** until physical retest. No known code/CI blocker remains.
