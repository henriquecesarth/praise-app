# Upright Piano KW sample projection

Build the local web audio bank from the extracted FreePats `UprightPianoKW-small-SFZ-20190703` directory with:

`python scripts/prepare-upright-kw.py <extracted-source-directory>`

The script projects only SFZ regions intersecting MIDI 48–88, preserves each original mono PCM WAV byte-for-byte, and emits `shared/audio/upright-kw.json`. SFZ loop end is inclusive and is converted to the exclusive end time `(loop_end + 1) / sample_rate`; all bounds are checked against decoded frame count. It also copies the upstream CC0 notice and readme beside the samples.

Source archive SHA-256: `FFB547FCEB91EEB93D78CF8D220D1D5F726DCAC891AFC15E517805AC48ABB39D`. The upstream download page did not publish a cryptographic checksum. Integrity was checked against 7z's internal CRC and this locally recorded SHA-256. Provenance is bounded to retrieval from the official FreePats HTTPS page and archive integrity; this is not an upstream signed authenticity claim.

The 14 projected source WAVs are mono 44.1 kHz, 16-bit PCM. Their total file size is 4,927,904 bytes; decoded PCM is 9,855,808 bytes (excluding decoder/runtime overhead). Individual source/sample SHA-256 values are printed by the script for reproducible verification.
