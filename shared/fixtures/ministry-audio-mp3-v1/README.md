# ministry-audio-mp3-v1

Pequenas fixtures de MP3 CBR 256 kbps **reais** (ffmpeg/libmp3lame) compartilhadas por backend e web. Nenhum teste unitário precisa de ffmpeg; arquivo ausente ou divergente **falha** (nada é ignorado).

| Arquivo | Fonte | Consumidores |
|---|---|---|
| `probes.json` | `web/scripts/generate-mp3-calibration-probes.mjs` (gera também `web/src/audio/mp3-calibration-probes.ts`) | web (`mp3-calibration-probes.test.ts` exige igualdade byte a byte), backend (`mp3-stream-validator.test.ts`) |
| `real-encoder-cases.json` | `backend/scripts/m22c5c/generate-real-encoder-fixtures.ts` | backend (`mp3-stream-validator.test.ts`, `ffmpeg-real-encoder-check.ts`, `web-parity.ts`) |

São sinais sintéticos determinísticos (ruído de baixo nível e cliques) gerados por nós: sem material de terceiros. Total ≈ 110 KiB. Regenerar exige ffmpeg e revisão do diff; o gerador aborta sem escrever se o validador discordar de qualquer caso.
