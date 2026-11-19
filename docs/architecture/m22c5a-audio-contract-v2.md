# M22-C.5A — Contrato de áudio v2 (Biblioteca Ministerial)

Status: contrato local implementado; **MP3 não é publicável**. Nenhuma mudança em R2, Demucs, Firestore, mixer WAV ou objetos existentes.

## Compatibilidade

- `schemaVersion 1` (sem o campo no pedido de reserva) é lido e gravado exatamente como antes: mesmo schema estrito, mesmo `requestHash`, mesmas chaves `.wav`, `audio/wav` e hashes. Nenhuma gravação é migrada.
- `schemaVersion 2` é aditivo: o pedido declara `schemaVersion: 2`. Um corpo v1 com `schemaVersion: 1` (ou outro valor) é rejeitado.
- Em v2, as seis faixas têm o mesmo codec, `sampleRate` e `frames` (e, em MP3, o mesmo `alignment`).
- Um pedido v2 com faixas PCM é aceito, mas persistido como manifesto v1 (formato idêntico), para não quebrar PWAs já implantadas que só leem v1. Só um codec futuro validado por bytes gravará v2; antes disso, o leitor web v2 deve estar implantado.
- O manifesto persistido só contém faixas validadas por bytes (`requirePublishableStems`); logo o `AudioManifest` gravado é v1 ou v2 com `pcm_s16le`.

## Codecs e perfis (`audio-codec.ts`)

| Codec | Extensão | MIME | Taxas | Teto de bytes | Publicável |
|---|---|---|---|---|---|
| `pcm_s16le` | wav | audio/wav | 8–48 kHz | 44 + 48000·300·4 | sim |
| `mp3_cbr256` | mp3 | audio/mpeg | 44,1 / 48 kHz | derivado de 300 s + corte, ≈ 10,5 MB | **não** (`serverByteValidation: false`) |

Limites de duração, frames e bytes são por perfil e independentes. A extensão e o MIME ainda **não** alimentam as chaves/headers do storage (continuam `.wav`/`audio/wav`); isso é um gate da etapa de upload MP3.

## Semântica dos campos MP3 (`mp3_cbr256`)

- `frames`: comprimento da linha do tempo canônica = frames do PCM original em `sampleRate`, após o corte. Igual nas seis faixas.
- `alignment.encoderDelayFrames`: frames de priming no início do fluxo decodificado a remover.
- `alignment.paddingFrames`: frames após `frames` no fim do fluxo decodificado a descartar.
- `alignment.mpegAudioFrames`: frames MPEG de áudio, sem o frame Info/Xing.
- `alignment.infoFrame`: deve ser `true`.
- Invariante: `encoderDelayFrames + frames + paddingFrames = mpegAudioFrames × 1152`.
- Tamanho: `(mpegAudioFrames + 1) × bytesPorFrameCBR`, com 835–836 bytes a 44,1 kHz e 768 a 48 kHz.
- Limites genéricos de atraso/corte: ≤ 4608 frames. Nenhum atraso de encoder ou navegador é fixado no código.

### Declarativo × verificado pelo servidor

| Campo | Hoje | Antes de habilitar MP3 o servidor deve |
|---|---|---|
| `sha256`, `sizeBytes` | declarado | recalcular no mesmo passe de leitura (já ocorre para WAV) |
| `codec`, `sampleRate`, `channels`, `bitrateKbps` | declarado | conferir em cada cabeçalho de frame MPEG-1 Layer III |
| `alignment.mpegAudioFrames`, `infoFrame` | declarado | contar frames, exigir Info/Xing no primeiro frame |
| `frames`, `durationSeconds` | declarado, coerência aritmética | consistência entre as seis faixas (o servidor não vê o original) |
| `encoderDelayFrames`, `paddingFrames` | declarado, invariante aritmética | exigir tag LAME/Info válido, ler atraso/corte dele e conferir com o declarado e com as outras faixas; sem tag, rejeitar (a decodificação só serve de teste, não de fonte de verdade) |
| ausência de ID3, lixo final, `Content-Encoding` | não verificado | rejeitar |

## Gate fail-closed

Em `MinistryAudioService.reserve`, primeiro roda a autorização do ministério (somente leitura; sem permissão responde 403), depois `requirePublishableStems`, antes de qualquer escrita: um corpo v2 MP3 válido no contrato recebe `422 AUDIO_CODEC_NOT_ENABLED`. `stemSchema` (usado por `verifyWav`, R2 e simulador) continua só PCM, então um objeto MP3 também não passa pela verificação de bytes. Habilitar MP3 exige alterar `serverByteValidation` junto de um validador streaming de frames MPEG.

O leitor web (`prepareMinistryMixerTracks`) aceita manifestos v1 e v2 com `pcm_s16le` e recusa MP3 com a mensagem existente de dados inválidos.

## Testes

- Backend: `audio-codec.contract.test.ts` (perfis, schemas, gate, rejeição de metadados).
- Web: `ministry-audio-contract.test.ts`.
- Fixtures compartilhadas: `shared/fixtures/ministry-audio-contract-v2/stem-cases.json`, com números reais da PoC.
- PoC: `poc/m22c5-mp3/poc.test.mjs` gera as faixas, codifica, decodifica e inspeciona os bytes (ffmpeg e Chrome).

## Achados da PoC que alimentam o contrato

- O ffmpeg grava ID3v2 por padrão (44 bytes). O contrato proíbe ID3; usar `-id3v2_version 0` na referência.
- O padding final calculado pelo invariante (695 na PoC) coincide com os quadros extras que o Chrome deixa após aparar o início.
- Alinhamento em Safari/iOS e Android: **Unknown / Not yet verified**.
