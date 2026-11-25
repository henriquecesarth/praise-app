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

## Memória e responsividade (M22-M1)

Qualidade sonora, modelo, overlap (25%), pesos e precisão **não** foram alterados.

- **Separador** (`retainPcmChannels: false`, usado pela tela): em vez de manter 6 stems × Float32 estéreo + 2 somas Float64 + pesos para a faixa inteira até o fim, mantém só uma janela de overlap do tamanho de um segmento e escreve cada WAV PCM16 no lugar, assim que os quadros deixam de receber contribuições. Mesma aritmética e mesma ordem de somas: WAVs, SHA-256, rms, pico e erro de reconstrução idênticos ao caminho antigo (testes bit a bit em `separation-streaming.test.ts`). O padrão (`true`) preserva o contrato anterior para os demais consumidores.
- **Worker → cliente:** com `retainPcmChannels: false` o PCM não é transferido (`leftBuffer`/`rightBuffer` = `null`, validados fail-closed nos dois sentidos) e o laço de checagem de finitude da thread principal (~160 M iterações a 300 s) deixa de existir; a finitude continua verificada no worker. O WAV de entrada transferido é solto assim que decodificado.
- **SHA-256:** `computeSha256Hex` não copia mais o buffer (era uma cópia por hash: worker, cliente, rascunho e mixer).
- **Mixer:** `decodeWavIntoChannels` decodifica em fatias que cedem a thread principal, direto nos canais do `AudioBuffer` (sem o par Float32 temporário). Mesmas amostras, rms e pico.
- Custo por quadro (estimado pelo código): worker ~100 → ~36 B; thread principal retida após a separação 72 → 24 B (WAVs). O `AudioBuffer` do mixer (48 B/quadro, ~635 MB a 300 s) **não** mudou.

Medições reais (Chrome com interface, WASM 4 threads, `crossOriginIsolated`, máquina de 7,9 GB com outros aplicativos abertos; memória = soma de bytes privados dos processos do Chrome da execução; uma execução por ponto, tempos ruidosos):

| Entrada | Pico privado antes → depois | Maior processo antes → depois | Heap JS final | Rascunho | Tarefas longas |
| --- | --- | --- | --- | --- | --- |
| 30 s (A/B alternado, 2 rodadas) | 1460/1420 → 1354/1358 MB | n/d | 138–160 → 38 MB | 156 → 188 ms | 0 → 0–1 (89 ms) |
| 180 s | 2184 → 1742 MB (−20%) | 2004 → 1418 MB (−29%) | 820 → 214 MB | 2623 → 894 ms | 0 → 0 |
| 300 s | 2751 → 2047 MB (−25,6%) | 2581 → 1680 MB (−35%) | 1516 → 356 MB | 7291 → 1396 ms | 6 (máx 819 ms) → 1 (50 ms) |
| 300 s, cancelado aos 150 s | 2336 → 1861 MB (−20%) | n/d | n/d | n/d | n/d |

- WAVs idênticos byte a byte (SHA-256 dos seis stems) antes/depois em 30 s, 180 s e 300 s; repetibilidade do baseline confirmada (duas execuções de 30 s com SHA iguais); erro de reconstrução igual.
- Memória residual 20–40 s após a conclusão ou o cancelamento: equivalente ao baseline (~210–280 MB privados; sem vazamento observado).
- Working set total (não privado) **não** caiu de forma confiável sob pressão de RAM do host (180 s: 1899 → 2069 MB; 300 s: 1971 → 2147 MB): o SO apara páginas de forma diferente, por isso a métrica adotada é a de bytes privados.
- Tempo: A/B alternado em 30 s (inferência 101/86 s antes, 94/92 s depois) não mostra degradação; as execuções longas variaram por contenção do host e **não** servem para comparar tempo.
- Mixer com seis WAVs sintéticos de 300 s (só decodificação): tarefas longas do carregamento 659–1061 ms (5 tarefas, soma 3819 ms) → ~250–260 ms (soma ~1270 ms); pico privado 1564 → 1309 MB.
- A pausa de 4,9 s vista no Q2 vinha do próprio harness (a conversão base64 dos stems rodava na thread principal com o observador de frames ainda ligado; a execução de 300 s sem esse despejo teve 585 ms). Causas reais removidas: laço de finitude do cliente e cópias de SHA; permanece ~250 ms por stem no mixer.
- Não medido: WebGPU (adaptador indisponível neste host) e dispositivos com menos RAM.