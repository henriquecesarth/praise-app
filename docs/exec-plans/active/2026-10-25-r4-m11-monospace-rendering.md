# R4-M11 — Monospace and Courier New rendering

Status: IN PROGRESS.

Scope: Flutter monospaced chord/lyric presentation and focused tests only. No parser, persistence, backend, web, progression, toolbar or preference changes. No APK, production deployment or database writes.

Evidence: R4-M10 fixes each fragment width using a standalone TextPainter, then places SelectableText inside it. SelectableText uses inherited DefaultTextStyle and wraps through EditableText by default; the painter does not merge that inherited style. Grouping fragments and scrolling their parent does not remove their individual width constraints. Flutter RenderEditable additionally subtracts its caret margin from the available paragraph width (`_adjustConstraints`), even in read-only SelectableText. Both-font regression fixtures reproduce vertical splitting with the old measurement/SelectableText combination. This is a confirmed layout/measurement defect; the precise Android fallback font on the user's device is Unknown / Not yet verified.

Decision: isolate an early monospace branch. Use non-wrapping Text with SelectionArea and intrinsic widths from the displayed text itself, preserving inherited style, scaler, locale and fallback. Wrap complete word groups; horizontally scroll oversized words. Reserve chord-label spacing as presentation padding. Keep the proportional algorithm intact.

- [x] Inspect clean WIP, reader, parser contracts, tests and workflows.
- [x] Implement isolated rendering and geometry/selection/reader regressions for both fonts.
- [ ] Review diff and commit/push only WIP.
- [ ] Existing GitHub Actions analyzer and focused tests pass; record evidence and archive plan.

Local Flutter execution is unavailable: host macOS 12.7.6 is below the installed SDK runtime requirement, as recorded in R4-M10. Validation will use the existing Ubuntu workflow (analyze and focused tests; no APK).
