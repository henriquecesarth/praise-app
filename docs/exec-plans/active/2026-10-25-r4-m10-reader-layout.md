# R4-M10 — Android Smart Chords reader layout

Status: IN_PROGRESS

Scope: Flutter reader presentation only. Preserve canonical progressions, persistence, authentication, personal ownership and import lifecycle. No Web/Backend source changes, manual deployments or APK generation.

- [x] Replace overflowing sticky toolbar with adaptive rows; preserve every action and SafeArea.
- [x] Measure chord/lyric fragments using the active font and text scale; group syllabic fragments by word, reserve width for both tiers, wrap proportional text at word boundaries and scroll oversized groups/monospace lines deliberately.
- [x] Widget geometry regressions at 320/360/393 logical pixels and 1.3 text scaling, plus -1/+2 transposition and R4-M9 progression regression.
- [ ] Review diff; scoped WIP commit/push; existing remote Flutter analyzer and focused test suite.
- [ ] Record evidence; Android physical retest remains separate. No local Flutter execution on macOS 12.

Contracts/collections: none changed. `SmartChordParser.parse`/`renderLine` inspected; reader layout will use the existing parsed associations without changing normalized/stored content. `MusicalProgressionLine` remains unchanged.

Implementation: reader uses a `LayoutBuilder` toolbar with a compact key/transposition row and a second row for Original/font controls below the wide-layout threshold, with body SafeArea. Existing pending-link label can wrap inside its row. A presentation-only `ChordLyricLine` measures active-font/text-scale extents, reserves a visual chord gap, keeps intra-word chord/lyric fragments together, and uses word wrapping or deliberate horizontal scrolling. Parser/persistence and `MusicalProgressionLine` are unchanged.

Local checks: `git diff --check` PASS. Flutter tests/analyzer are NOT run locally because the required SDK cannot run on macOS 12. Six real-reader toolbar geometry cases cover 320/360/393 at 1.0/1.3 text scale and safe insets; eight additional line-layout/progression widget cases cover both fonts, -1/+2, word associations, glyph separation, oversize-word scrolling and canonical labels. Existing assertions are retained. Remote execution pending.
