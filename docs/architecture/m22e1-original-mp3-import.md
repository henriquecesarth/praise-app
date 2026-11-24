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
| Duração | 180 s (`DEFAULT_MAX_AUDIO_SECONDS`), checada nos frames **e** no PCM decodificado |
| Entrada MP3 comprimida | 24 MiB (folga para capa em ID3) |
| WAV de saída / entrada WAV | 36 MiB (`MAX_AUDIO_WAV_BYTES`) |
| Frames | `MAX_SEPARATION_TOTAL_FRAMES` (44 100 × 180) |
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

## Validação

- Unitários/componente: `original-mp3-import.test.ts`, `MinistryAudioLocalSeparation.mp3.test.tsx` (+ regressão em `MinistryAudioLocalSeparation.test.tsx`).
- Chromium real + modelo real (opt-in): `npx playwright test -c playwright.m22e1.config.ts` (`web/e2e/m22e1-mp3-import.spec.ts`; modelo em
  `~/.cache/louvaio-models/htdemucs_6s_fp16weights.onnx` ou `LOUVAIO_M22A_MODEL_PATH`).
- Fixtures sintéticas (tons senoidais gerados para o repositório) em `web/e2e/fixtures/original-mp3/`; nenhuma música comercial.
