# M22-E1 — Importação nativa de MP3 para a separação local

Escopo: música original escolhida na tela "Separar música neste dispositivo" (`MinistryAudioLocalSeparation`). **Não** altera publicação,
formatos de stems, armazenamento R2, backend, motor Android nem a biblioteca ministerial. `MP3_RELEASE_GATE = BLOCKED` continua válido para
publicar/armazenar stems MP3; esta importação é uma funcionalidade distinta (entrada, não saída).

## Fluxo (somente no navegador)

`MP3 → PCM 44,1 kHz estéreo (decodeAudioData em OfflineAudioContext) → WAV PCM16 em memória → worker Demucs ONNX → 6 stems WAV → mixer → publicação (confirmação explícita)`.

- WAV segue o caminho anterior: os bytes vão ao worker sem alteração e o worker continua sendo a autoridade de validação.
- Formato decidido pelo **conteúdo** (RIFF/WAVE, ID3 ou sync MPEG), nunca por extensão ou MIME.
- Sem upload, sem FFmpeg, sem API externa, sem dependência nova. O arquivo original só é lido.

## Módulos

- `web/src/audio/original-mp3-import.ts` — `inspectOriginalMp3` (estrutura/duração por frames, antes de decodificar) e `importOriginalMp3`.
- `web/src/audio/separation-input.ts` — roteia WAV/MP3 para a tela. Reaproveita `createBrowserMp3DecodeBackend` e `encodeStereoPcm16Wav`;
  não usa as restrições dos stems MP3 publicados (`mp3-stem-decoder.ts`: 256 kbps, sem ID3, calibração de atraso).

## Limites

| Limite | Valor |
| --- | --- |
| Duração | 300 s (`DEFAULT_MAX_AUDIO_SECONDS`, M22-E2; antes 180 s), checada nos frames **e** no PCM decodificado |
| Entrada MP3 comprimida | 24 MiB (folga para capa em ID3) |
| WAV de saída / entrada WAV | 56 MiB (`MAX_AUDIO_WAV_BYTES`; 300 s PCM16 estéreo = 50,5 MiB) |
| Frames | `MAX_SEPARATION_TOTAL_FRAMES` (44 100 × 300 = 13 230 000) |
| ID3v2 | até 16 MiB; tamanho syncsafe validado |
| Ressincronização | até 16 eventos / 256 KiB pulados; trailer ID3v1/lixo final curto tolerado |

Aceita MPEG-1/2/2.5 Layer III, CBR e VBR, mono e estéreo, qualquer taxa comum (reamostrada para 44,1 kHz pelo navegador). Rejeita vazio,
não-MP3, truncado/corrompido, taxa/versão mudando no meio, > 180 s, canais ≠ 1/2, taxa decodificada ≠ 44,1 kHz, comprimento decodificado
divergente da estimativa por frames (> 1 s), amostras não finitas e saída acima dos limites (checada antes de alocar o WAV).

## Memória e cancelamento

- O `ArrayBuffer` do arquivo é entregue ao decodificador sem cópia (é destacado por `decodeAudioData`); mono usa o mesmo `Float32Array` nos dois canais.
- O WAV final é o único buffer retido e é transferido ao worker (`transferInputBuffer`); o `AudioBuffer` decodificado fica sem referência.
- `decodeAudioData` não é interrompível: o cancelamento rejeita na hora (`CANCELLED`) e o resultado tardio é descartado, nunca chegando ao Demucs.
  Execuções concorrentes continuam isoladas pelo contador `run` da tela.

## Desempenho local e ambiente de desenvolvimento (M22-E1.1)

Medido em i5-3550 (4 núcleos/4 threads), 7,9 GB de RAM, Intel HD Graphics (D3D11, sem adaptador WebGPU), Chrome 158 com interface gráfica,
mesmo modelo `htdemucs_6s` fp16 e entrada sintética (tons), um benchmark por vez:

| Variante (4 s, 1 chunk) | Modelo | Inferência | Total | RTF |
| --- | --- | --- | --- | --- |
| WASM 1 thread | 50,4 s | 38,7 s | 89,5 s | 9,67 |
| WASM 2 threads | 47,8 s | 26,1 s | 74,3 s | 6,53 |
| WASM 4 threads (COI) | 45,8 s | 24,9 s | 71,0 s | 6,22 |
| WebGPU | indisponível: `requestAdapter()` retorna `null` | — | — | — |

WASM 4 threads com 61 s de áudio: decodificação MP3 0,2 s, modelo 41 s, inferência 264,6 s (11 chunks), codificação 2,6 s, total 308,8 s,
RTF 4,33, pico de ~2,3 GB no Chrome, interface sem travar (maior intervalo de frame 84 ms), seis stems íntegros. 180 s **não** foi medido.

- Multi-thread exige `crossOriginIsolated`. Sem COOP/COEP o app roda em 1 thread (comportamento padrão, inalterado).
- `LOUVAIO_DEV_COI=1` (somente `vite serve`, opt-in) envia `COOP: same-origin` e `COEP: credentialless`. Nunca é aplicado por padrão nem no
  build. COOP `same-origin` quebra popups OAuth/Firebase (o E3 usa token do emulator) e COEP afeta recursos de terceiros; `credentialless`
  mantém funcionando subrecursos no-cors. Verificado: API local, Worker, ONNX com 4 threads e PUT assinado ao R2 de desenvolvimento
  (CORS ok). Produção, PWA e Firebase real não foram avaliados.
- Os harnesses E2E (`m22a`, `m22b`, `m22e1`) usam `cacheDir` próprio para não invalidar as dependências otimizadas do servidor de dev (HTTP 504).

## Validação

- Unitários/componente: `original-mp3-import.test.ts`, `MinistryAudioLocalSeparation.mp3.test.tsx` (+ regressão em `MinistryAudioLocalSeparation.test.tsx`).
- Chromium real + modelo real (opt-in): `npx playwright test -c playwright.m22e1.config.ts` (`web/e2e/m22e1-mp3-import.spec.ts`; modelo em
  `~/.cache/louvaio-models/htdemucs_6s_fp16weights.onnx` ou `LOUVAIO_M22A_MODEL_PATH`).
- Fixtures sintéticas (tons senoidais gerados para o repositório) em `web/e2e/fixtures/original-mp3/`; nenhuma música comercial.

## Ampliação para 300 s (M22-E2)

- Limites derivados de `DEFAULT_MAX_AUDIO_SECONDS = 300`. O contrato de publicação (`MAX_MINISTRY_AUDIO_SECONDS = 300`, backend `PCM_MAX_SECONDS = 300`) e o validador Android (1800 s) já comportavam 300 s. Nenhuma validação foi afrouxada: continuam as checagens por frames, bytes e tamanho do MP3 comprimido (24 MiB).
- Memória por frame no worker ao fim da separação: acumuladores 48 B + soma Float64 16 B + pesos 4 B + entrada 8 B + 6 WAVs 24 B, ou seja ~100 B/frame (~1,3 GB a 300 s). Na thread principal ficam left/right/WAV dos seis stems (72 B/frame, ~0,95 GB).
- Medição real (WASM, 4 threads, COI, entrada de 300 s montada a partir de música de teste não versionada): 51 chunks, inferência 909 s, total 972 s (RTF 3,03), pico do Chrome 2,7 GB, heap JS final 1,1 GB, seis stems íntegros (13 230 000 frames). A RAM livre do host chegou a ~0,5 GB (host de 7,9 GB com outros aplicativos), então não há folga em máquinas com menos RAM.