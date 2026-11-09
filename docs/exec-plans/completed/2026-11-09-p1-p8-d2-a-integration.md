# P1–P8 integration onto D2-A

Baseline: `8aa9c1a7e5a2cb144af5828e80a2f09e52b43fce`.
Branch: `integration/smart-chords-p1-p8`; existing isolated worktree retained.

## Scope and invariants

Integrate advanced notation, annotations, progressions and transposition into the existing editor, dedicated reader and real PDF export. Preserve exact source persistence, D2-A controls/modes, personal ownership and M20/M21. No commits, publication, deployment or D2-B authorized.

Selective sources: five `origin/parallel/*-20261107` refs identified in CURRENT_PROJECT_STATE. P7/P8 tip `1bac4f5`, P4–P6 `3e8e2cf`, P3 `604c3ef`. Existing extracted utilities/tests retained; unrelated parallel backend changes excluded.

## Ownership

- `/root`: browser tests/config, orchestration, final gates and this record.
- `/root/feature_completion`: initial consumer changes; ownership transferred to `/root/finish_consumers`.
- `/root/finish_consumers`: sole current writer of `web/src` integration and focused regressions.
- `/root/functional_review`: independent read-only compatibility review.
- `/root/security_final`: read-only workspace/security audit.

## Final result (2026-11-09)

- Full Web suite: PASS, 36 files / 709 tests, exit 0. After the final extra-cell and SongDetail visual/accessibility patches, affected tests were revalidated: 207 tests in 7 files plus 7 ChordFontSync tests, all PASS.
- Final `npm run build -- --mode test`: PASS, exit 0; includes TypeScript. Separate `npx tsc --noEmit`: PASS.
- Final Playwright `--config playwright.p1-p8.config.ts`: PASS, 4/4 desktop/mobile, including real html2pdf download, exact LF source save/reopen and metadata save preserving CRLF/tabs/trailing bytes. API is stateful and isolated; no provider writes.
- Reader/PDF bounding-box assertions verify nonoverlapping extended chords and actual annotation position above the target. Final browser includes trailing/chord-only anchor. Desktop/mobile PDF preview screenshots inspected.
- Actual downloaded PDFs: two pages, A4 MediaBox approximately 595.28 × 841.89 points. Synthetic multipage source includes progressions, Unicode symbols, annotations, tablature and aligned chords.
- Review caught and drove fixes for double transposition, Unicode classification/bass loss, annotation/chord offset corruption, line separators, adjacent annotations, ending markers and compile scope.
- Independent functional reviewer approved the final source, including trailing anchors in Reader/PDF/SongDetail, via executable probes. Final security auditor approved tracked/untracked scope, secret scan and explicit new-file whitespace checks; 35 adversarial assertions passed.
- Logs retained locally in ignored `.logs/p1-p8/`; PDF/screenshots in ignored `web/test-results/p1-p8/`. No commit, push, PR action or deployment performed.

## Delivery gates

| Required result | Status |
| --- | --- |
| INTEGRATION_STATUS | PASS |
| P1_P8_FUNCTIONAL | PASS |
| D2_A_REGRESSION | PASS |
| SAVE_REOPEN | PASS — isolated stateful API |
| TRANSPOSITION | PASS |
| ANNOTATIONS | PASS |
| PDF | PASS — real export, desktop/mobile, two A4 pages |
| WEB_FULL_TESTS | PASS — 709/709 |
| WEB_BUILD | PASS — mode test |
| SECURITY_SCAN | PASS |
| BLOCKERS | NONE identified in reviewed scope |
| READY_FOR_D2_B | YES — ready for owner decision; D2-B not started |

Changed existing files: SmartChordsWorkspace.tsx, SmartChordReader.tsx, SongDetail.tsx, smart_chord.ts and smart_chord.test.ts. New files: notation/advanced/annotation modules and four notation test suites, reference fixture, isolated browser spec/config, P7/P8 workflow, and this report. New files remain untracked pending an authorized commit; tests load them from the worktree. No persistence format or backend change.

Remaining limits: test-mode local browser and synthetic isolated API validate the Web integration, not a production Firestore roundtrip or physical-device acceptance. PDF layout/font coverage is the tested corpus, not every installed font. Existing bundle-size and React Router warnings remain. No live credentials accessed or publication authorized. Final source changes in SongDetail were validated by typecheck, build and its targeted component suite after the full-suite checkpoint.

Production persistence: Unknown / Not yet verified. Browser persistence tests use an isolated stateful intercepted API; no provider writes.

## Authorized checkpoint and data-preservation hotfix (2026-11-09)

The initial checkpoint was blocked by a reproduced destructive edit: `| C{{nota}}7 | Am |` became `| D | Am |`. The hotfix masks closed annotations at equal UTF-16 length, shares original-source parsing across Reader/PDF/SongDetail, validates the selected source slice, and replaces only that slice. The corrected result is `| D{{nota}}7 | Am |`; editing index 1 preserves the first chord and annotation exactly. Malformed annotation lines and invalid indices fail closed.

Final frozen-source validation: focused parser/editor suite 202 assertions PASS; complete Web suite 36 files / 709 tests PASS (exit 0); test-mode build PASS (exit 0); Playwright desktop/mobile 6/6 PASS (exit 0), including both inline chord indices, exact CRLF save/reopen, transposition and actual PDF download. Logs: ignored `.logs/p1-p8/hotfix-{focused,full,build,e2e}.log`. Existing 709 tests were expanded with preservation assertions.

Independent review `/root/checkpoint_review`: PASS, 48 adversarial assertions; public-scope secret scan PASS; no provider writes. Scope remains the 17 integration files. Local checkpoint commit and subsequent D2-B worktree are now explicitly authorized by the owner; no push, merge or deploy authorized. Production persistence remains Unknown / Not yet verified.
