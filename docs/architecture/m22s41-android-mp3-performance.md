# M22-S4.1 — Desempenho da reprodução MP3 no Android (experimental)

Estado: **experimental, desligada por padrão**. `MP3_RELEASE_GATE = BLOCKED`, `PRODUCTION_DEPLOY_GATE = BLOCKED`. Medido em um único aparelho (Lenovo TB-J616F, Android 12, `c2.mtk.mp3.decoder`), com seis stems LAME 3.100 de 298 s a 44,1 kHz. Publicação MP3, backend, limite de 300 s e produção não mudaram.

## Profiling (60 s de um stem, PCM comparado por CRC)

| Configuração | x tempo real | PCM igual à referência |
|---|---|---|
| Pump do S4 (1 quadro/buffer, timeouts 10 ms) | ~8,5 | referência |
| Drenagem sem bloqueio / `maxRate` / assíncrono, 1 quadro/buffer | ~10–11 | sim |
| 16 quadros/buffer | ~38–77 | sim |
| 64 quadros/buffer | ~77–104 | sim |

- **Causa**: o custo está no ciclo por buffer (2 chamadas de dequeue e ida e volta ao codec por quadro MPEG), não no timeout. As esperas medidas somavam ~1,6 s de 7 s; trocar apenas o pump pouco ajudou.
- **Disco** (stem inteiro, decoder novo): 5,7 s no total = ~5,1 s codec/extractor, ~0,4 s escrita, ~0,2 s cabeçalho/flush/fsync.
- **Instâncias**: ambos os decoders MP3 declaram 32; seis foram abertas simultaneamente (ociosas), e o protótipo decodificou com seis ativas.
- **Paralelismo** (6 stems de 298 s, só decodificação / com disco): 2 → 14,1 / 18,3 s; **3 → 10,3 / 11,3 s**; 4 → 10,5 / 12,6 s.

Reproduzir: `Mp3DecoderProfileTest` (instrumentado; requer `<externalFilesDir>/s4long`).

## Mudanças em produção

- `AndroidMp3PcmDecoder`: 64 quadros MPEG por buffer (API ≥ 28; abaixo disso, 1), sem bloquear um lado enquanto o outro tem trabalho. `framesPerBuffer = 1` preserva o pump de referência.
- Bridge: até 3 stems em paralelo (`Mp3Support.parallelStems`; 1 = referência). Só retorna ou lança depois de **todas** as threads de decodificação terminarem; o PCM temporário e o lease dependem disso. Se a tentativa paralela falhar com `MP3_DECODE_FAILED` (por exemplo, sem recursos para vários codecs), há uma única nova tentativa sequencial. Um `prepare` cancelado na fila não fecha a sessão atual.
- Calibração: 4 fixtures (LAME e Lavc × 44,1 e 48 kHz), os dois canais, cancelável; devolve o nome do decoder, e cada stem precisa ser decodificado por ele. Cancelamento e falha ambiental não ficam em cache; divergência de alinhamento/comprimento/formato fica.
- Caminho sem gapless: o decoder deve entregar **exatamente** `mpegAudioFrames × 1152`. A faixa aceita antes permitia cortar o delay duas vezes se a plataforma aparasse sem informar.
- Mudança de formato PCM no meio do stream é recusada.
- `close` cancela também um `prepare` ainda enfileirado e a calibração.
- Dart: depois de preparar um conjunto MP3, `MinistryAudioCache.revalidate` confirma online o acesso e o digest do manifesto antes de expor `ready`; falha fecha a sessão e libera o lease. WAV não muda.

## Resultado da decodificação integral (298 s, cache nativo)

| Medida | S4 | S4.1 |
|---|---|---|
| `prepare` nativo | 185 s | **6,8–15,1 s** (ver abaixo) |
| PCM temporário | 315 MB | 315 MB (inalterado) |
| PSS de pico do processo | — | ~86 MB (ocioso ~78 MB) |
| Calibração (medida à parte) | ~0,2 s (2 fixtures) | ~0,33–0,8 s (4 fixtures) |
| Primeiro avanço de posição após `play` (AudioTrack real) | — | 140 ms |
| Underruns (40 s contínuos + 4 seeks + pausa) | — | 0 ou 1, sempre no 1º segundo (3/3 medições localizadas); 0 depois |
| Seek até a posição avançar | — | 123–218 ms |

PCM idêntico ao pump de referência nos stems comparados (vocals e other); após 8 seeks (início, meio, fim, repetidos) o bloco entregue pelo mixer é bit a bit o PCM linear.

Variação do `prepare` no mesmo aparelho, no mesmo dia: 14,3 e 15,1 s (com amostragem de `getPss`), 11,7 e 12,0 s (sem amostragem) e, mais tarde, 6,8–7,4 s em três rodadas. A causa da variação é **Unknown / Not yet verified**.

**Meta de abertura (≤ 10 s aceitável, ≤ 5 s preferencial): NÃO demonstrada** pela decodificação integral — cumpre 10 s em parte das rodadas, nunca 5 s. **Redução do PCM temporário: NÃO atingida.** Download, revalidação online e SHA-256 no Dart não foram medidos e somam à abertura.

## Protótipo incremental (somente `androidTest`)

`Mp3IncrementalPrototypeTest`: seis decoders → seis ring buffers de 3 s (3,2 MB no total) → `MixerCore` de produção → um `AudioTrack` (volume 0). Backpressure: o produtor bloqueia com o ring cheio. Falta de dados bloqueia o mix inteiro; nenhum zero é inserido. Cada bloco é comparado com o mix da decodificação integral.

Seek: índice próprio dos cabeçalhos MPEG, extractor aberto no offset do quadro, gapless da plataforma zerado, preroll de 10 quadros e descarte até a amostra alvo.

| Preroll (quadros) | Janelas bit a bit (9 alvos) |
|---|---|
| 0 | 0/9 |
| 1 | 1/9 |
| 2, 4, 10 | 9/9 |

Nas quatro fixtures de impulso (dois perfis × duas taxas, ~1 s), toda posição inicial com preroll de 10 reproduziu o decode linear. `MediaExtractor.seekTo` não é usado: os timestamps são estimativas (até ~5 ms fora no stem de 298 s).

| Medida (298 s) | Resultado |
|---|---|
| Primeiro áudio no início | ~1,1 s |
| Primeiro áudio após seek | 0,45–1,14 s |
| Underruns depois do 1º segundo, sem stall injetado | 0 (1 underrun na partida do primeiro trecho) |
| Stall de 4 s injetado em um stem | mix inteiro parou (~2,6 s), 1 underrun, retomou bit a bit |
| PCM temporário | 0 |
| PSS de pico (inclui o mix de referência do teste) | ~150 MB |

**Não coberto pelo protótipo** (bloqueia a integração):

1. Integração com `MinistryAudioEngine`: leitura bloqueante precisa ser abortada por `stop`/`dispose`/seek; estado de rebuffering até a UI.
2. A garantia atual "nada toca antes de o comprimento total ser verificado" não existe em modo incremental: uma divergência só aparece depois de parte do áudio ter tocado. Decidir se a calibração mais a validação estrutural do índice de quadros bastam.
3. Ciclo de vida com seis codecs ativos: foco, fones, arbiter, background, lease só após os seis liberados, falha de codec no meio.
4. Perfil Lavc em stems longos, 48 kHz longo, outros aparelhos, músicas de 600 s, reprodução contínua da faixa inteira e escuta humana.
5. Stems mutados: o `MixerCore` não os lê, então o protótipo descarta explicitamente até a posição do mix.

## Recomendação para M22-L1

Integrar a arquitetura incremental com ring buffers. A decodificação integral a 600 s custaria cerca de 23 s e ~630 MB temporários (extrapolação, não medida). Manter a integral como referência e fallback experimental.
