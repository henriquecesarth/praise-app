# LAME (MP3 encoder, WebAssembly) — third-party notice

Status: **experimental feature, disabled by default** (`VITE_EXPERIMENTAL_MP3_COMPRESSION`). Since M22-S3 a build made without that flag contains NO encoder Worker, NO LAME WebAssembly file and NO embedded copy (enforced by `web/scripts/check-mp3-distribution.mjs`); a build with the flag distributes all of them. This document records the
evidence collected in M22-S2. It is **not a legal opinion** and does not declare definitive LGPL compliance; items that were
not verified are marked **Unknown / Not yet verified**. A legal review is a pending blocker before any release that enables it.

## Components

| Component | Version | License (as observed) | Evidence |
|---|---|---|---|
| `wasm-media-encoders` (JavaScript/WASM wrapper) | 0.7.0 (exact pin in `web/package.json`) | MIT, "Copyright 2020-2024 arseneyr" | `web/node_modules/wasm-media-encoders/LICENSE` (1,070 bytes); upstream README "licensed under the terms of the MIT license" |
| LAME MP3 encoder (compiled into `mp3.wasm`) | 3.100 (fork commit `98db548e8e851defbba3184125ce10725355c332`, parent `852c308336` "tag 3.100 release") | GNU Library (Lesser) General Public License **v2**; `libmp3lame` is LGPL; the MPGLIB decoder is GPL but the build uses `--disable-decoder` | `COPYING` and `README` of the fork at that commit: "distributed under the GNU LIBRARY GENERAL PUBLIC LICENSE (LGPL), version 2"; LAME's own `license.txt` ("under the restrictions of the LGPL") |

The fork `https://github.com/arseneyr/lame` differs from the 3.100 release by one commit (`98db548`, +2 lines in
`libmp3lame/util.c`: guards a debug `vfprintf` with `#ifndef NO_STDIO`). Verified through the GitHub API.

## The binary shipped by this application

- File: `wasm-media-encoders/wasm/mp3.wasm`, 132,999 bytes, SHA-256 `85e81719250b9a667b1258143f689dda70e3e57a7e7c29ab0b4cef65c8f6eb9a`.
- Served as an **independent file** (Vite emits `assets/mp3-<hash>.wasm`, verified in a `vite build --mode test`; the emitted file has the same SHA-256). The Worker fetches it and refuses any other binary (size + SHA-256 pin, `web/src/audio/mp3-encoding/mp3-lame-backend.ts`).
- **Limitation (honest note, only for builds WITH the flag):** the npm package's JavaScript entry also contains a base64 copy of the same encoder (and of an unrelated Ogg encoder). That copy is still present in the lazily loaded JavaScript chunk, but the compression Worker does not execute it (it instantiates the separate file). Removing the embedded copy would need a repackaged/forked wrapper and was not done. Whether this matters for LGPL purposes is **Unknown / Not yet verified** (legal review).

## Obligations checklist (evidence, not a conclusion)

| Item | State |
|---|---|
| Copyright/license notices of wrapper and library | This document, plus the MIT `LICENSE` inside the installed package. LAME's copyright holders list: **Unknown / Not yet verified** (taken from the `AUTHORS`/`COPYING` of the fork; not reproduced here). |
| LGPL text | Full text in `COPYING` of the fork at the commit above: `https://github.com/arseneyr/lame/blob/98db548e8e851defbba3184125ce10725355c332/COPYING`. A copy inside the product UI/distribution: **Unknown / Not yet verified (not done)**. |
| Acknowledgement / link to LAME | LAME's `license.txt` asks for acknowledgement with a link to its site (`https://lame.sourceforge.io`). In-product acknowledgement: **not implemented** (feature hidden). |
| Corresponding source | LAME source: fork commit above (`.gitmodules` of the wrapper: submodule `src/wasm/lame/lame-src` -> `https://github.com/arseneyr/lame.git`). Wrapper source: `https://github.com/arseneyr/wasm-media-encoders` tag/version 0.7.0 (exact tag/commit: **Unknown / Not yet verified**). Offering the source ourselves (written offer or hosted copy): **Unknown / Not yet verified (not done)**. |
| Build instructions | From the wrapper's `Makefile` (read from the upstream repository, not rebuilt here): Emscripten, `-Oz -flto`, `-DNDEBUG -DNO_STDIO`, LAME configured with `--disable-decoder --disable-frontend`, standalone WASM. A reproducible rebuild producing the pinned hash: **Unknown / Not yet verified (not attempted)**. |
| Replacement of the library by the user | Supported at build time: set `VITE_LAME_WASM_URL` (URL of a rebuilt/updated `mp3.wasm`) **and** `VITE_LAME_WASM_SHA256` (its SHA-256); the Worker then loads that file instead (`createLameWasmBackend({ wasmUrl, expected })`, covered by tests). Replacing without rebuilding the application (runtime replacement by the end user): **not supported**. The WASM must expose the same `wasm-media-encoders` interface. |
| Use only as a separate library, no modifications by us | LAME is used unmodified through the unmodified wrapper; no changes of ours to either. |

## Pending before any release

1. Legal review of the points marked above (LGPL-2.0 applicability to a WASM file served to browsers, the embedded copy, notices and source offer).
2. Decide how the notice and acknowledgement are shown to users and where the corresponding source is hosted.
3. Confirm the exact wrapper tag/commit and, if the product will ship its own binary, reproduce the build.
4. Re-pin size and SHA-256 and update this document whenever `wasm-media-encoders` or the binary changes (a test fails if the installed package differs from the pin).
