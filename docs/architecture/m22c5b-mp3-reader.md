# M22-C.5B — Leitor MP3 Web offline (experimental)

Status: **experimental, desligado em produção**. Nenhum manifesto MP3 remoto é consumido e a publicação MP3 continua bloqueada no backend (`422 AUDIO_CODEC_NOT_ENABLED`). Nada de R2, Firebase, mobile, Demucs ou WAV v1 foi alterado.

## Como entra no produto

- `web/src/audio/mp3-stem-decoder.ts`: módulo isolado (`Mp3StemDecoder`).
- `prepareMinistryMixerTracks(..., options?: { mp3Decoder })`: só um chamador que **injeta** o decodificador reproduz manifestos `mp3_cbr256`. Nenhum ponto de chamada de produção o injeta (`MinistryAudioLibraryView` não mudou), então MP3 continua recusado com "Dados de reprodução inválidos."
- O MP3 decodificado e normalizado vira WAV PCM16 e entra no mixer **inalterado** (`six-stem-mixer.ts` não foi tocado). O `sha256` do manifesto descreve o MP3 e é verificado antes de decodificar; por isso a faixa é entregue ao mixer sem `sha256` de WAV.

## Política de decodificação

1. Valida o descritor (taxa 44,1/48 kHz, frames ≤ 300 s, tamanho, invariante `atraso + frames + corte = mpegAudioFrames × 1152`).
2. Verifica tamanho, ausência de ID3 e SHA-256 dos bytes.
3. Percorre todos os cabeçalhos MPEG: MPEG-1 Layer III, 256 kbps, taxa declarada, estéreo, sem bytes finais; o primeiro frame precisa ser Info/Xing com tag LAME. Exige `frames MPEG = mpegAudioFrames` e `atraso_tag + corte_tag = encoderDelayFrames + paddingFrames`. A soma é independente do atraso próprio do decodificador (que apenas move frames entre atraso e corte), então nenhum atraso é fixado no código.
4. **Calibra o decodificador uma vez por taxa** com uma sonda MP3 embutida (cliques de escala plena em quadros conhecidos, L positivo e R negativo, incluindo o primeiro e o último quadro) e registra a forma de saída observada.
5. Decodifica com `OfflineAudioContext(2, 1, sampleRate)` na taxa do stem. Saída em outra taxa, com ≠ 2 canais, ou com comprimento fora do esperado é rejeitada, sem reamostrar.
6. Classifica o comprimento decodificado `L` (ver tabela) e exige a **mesma** forma da calibração.
7. Remove o atraso inicial **no máximo uma vez**, somente quando a forma observada é `raw`.
8. Devolve exatamente `frames` por canal e varre valores não finitos.

| Forma | `L` | Corte inicial aplicado |
|---|---|---|
| `canonical` | `frames` | 0 (o decodificador já removeu atraso e corte) |
| `start-trimmed` | `frames + paddingFrames` | 0 (só o atraso inicial já foi removido) |
| `raw` | `encoderDelayFrames + frames + paddingFrames` | `encoderDelayFrames` |

Comprimento correto não basta: a calibração só passa se cada clique da sonda cair no quadro exato nos dois canais, e a forma do stem tem de coincidir com a da sonda. Quando atraso ou corte é 0 mais de uma forma é compatível; aceita-se a da calibração.

## Verificação do atraso declarado (achado da revisão independente)

Comprimento e soma atraso+corte não detectariam um par deslocado em k quadros (soma preservada), que um decodificador `raw` reproduziria k quadros fora. Por isso, na calibração calcula-se `decoderDelay = encoderDelayFrames(sonda) − atraso_tag(sonda)` e, para cada stem, exige-se `encoderDelayFrames − atraso_tag = decoderDelay`. Nada é fixado no leitor; o valor vem da sonda. Limite que permanece: o `decoderDelay` da sonda é declarado pelo gerador da sonda (529, o valor que o contrato folda no atraso). Ele é provado por cliques apenas em decodificadores `raw`/`start-trimmed`; no Chrome (`canonical`) o corte é feito pelo próprio decodificador e foi confirmado empiricamente (1105 no início). A validação autoritativa (tag LAME × declarado × demais faixas) segue sendo requisito do validador de frames MPEG no backend, fase posterior.

## PoC nova (independente da histórica)

A PoC histórica `poc/m22c5-mp3/` **não foi transferida** para este computador; seus números continuam apenas como registrados em `m22c5a-audio-contract-v2.md` e nas fixtures compartilhadas (30 s, 44,1 kHz, mediabunny/LAME, atraso 1105, corte 695). Nada dela foi reproduzido ou inferido.

A PoC nova está em `web/scripts/m22c5b-poc/` (ffmpeg 9.0.1 + libmp3lame do sistema, sem dependência no projeto): sinal estéreo sintético (ruído de baixo nível + cliques em quadros distintos por canal, início, meio e fim), CBR 256 kbps, sem ID3, com Info/LAME.

Medido no Chrome 150.0.7871.125 (macOS 12.7.6, headless, `OfflineAudioContext`):

| Arquivo | Forma observada | `L` − `frames` | Deslocamento (corr. início/fim, L e R) | Cliques | Seek |
|---|---|---|---|---|---|
| 44,1 kHz, 5 s (220 500) | canonical | 0 | 0 / 0 / 0 / 0 | 0 amostras | exato |
| 48 kHz, 5 s (240 000) | canonical | 0 | 0 / 0 / 0 / 0 | 0 amostras | exato |
| 44,1 kHz, 300 s (13 230 000) | canonical | 0 | 0 / 0 / 0 / 0 | 0 amostras | exato |
| 48 kHz, 300 s (14 400 000) | canonical | 0 | 0 / 0 / 0 / 0 | 0 amostras | exato |

- Com Info/LAME o Chrome entrega exatamente os frames canônicos (apara 1105 no início e o resto no fim; para a tag LAME de atraso 576 isso é 576 + 529).
- Sem frame Info, o mesmo MP3 sai `raw` (222 336 amostras) com deslocamento de **1105** amostras: o decodificador não apara sem a tag. Esse arquivo não é aceito pelo contrato (Info obrigatório); serve de evidência de que a forma depende da tag.
- Decodificar em contexto de taxa diferente reamostra (comprimento escala), por isso a taxa do contexto tem de ser a do stem.
- Desempenho (decodificação + normalização, um stem): 5 s ≈ 34–61 ms; 300 s ≈ 1,4–1,6 s; heap JS ≈ +165 a +182 MB por stem de 300 s (float32 estéreo decodificado + cópia normalizada). Seis stems de 300 s decodificados em sequência liberam o MP3 e o buffer decodificado antes do próximo; o WAV PCM16 intermediário tem ≈ 53 MB (44,1 kHz) a 58 MB (48 kHz) por stem.
- Casos negativos no Chrome: SHA errado, taxa errada, soma tag × declarado errada e invariante quebrada são recusados antes de `decodeAudioData`; bytes de lixo com SHA válido falham na validação de frames MPEG.

## Limitações por navegador

- **Verificado**: apenas Chrome 150 (macOS). 
- **Não verificado**: Safari/iOS, Firefox e Chrome/Android. O módulo é fail-closed: se outro navegador entregar comprimento ou posição de clique diferentes, a calibração ou a classificação rejeita a faixa em vez de reproduzir desalinhada. Como a prova de alinhamento exigida só existe para o Chrome 150, o leitor permanece experimental.
- `OfflineAudioContext.decodeAudioData` na forma de callback (WebKit antigo) é suportada, mas não foi exercitada.

## Testes

- `web/src/audio/mp3-stem-decoder.test.ts`: três formas de saída em 44,1 e 48 kHz, atraso removido uma só vez, canais, primeiro/último quadro, calibração reprovando deslocamento de 1 quadro e canais trocados, forma divergente, taxa/canais/comprimento/NaN, descritor e bytes antes do decode, falha de decode e novo teste, abort, integração com o mixer inalterado (carga, SHA, seek) e recusa sem decodificador injetado.
- Os testes unitários usam um decodificador emulado (jsdom não tem `decodeAudioData`); a evidência com decodificador real é a PoC no Chrome 150 acima, que não roda na suíte.
- Cancelamento: `AbortSignal` é conferido entre etapas; `decodeAudioData` não é cancelável e o caminho do mixer ainda não repassa o sinal.
- Carregamento sequencial por stem é comportamento do mixer (cada `wavBytes()` é aguardado em ordem); não medi o pico de memória com seis stems em sequência.
- A sonda é regenerável com `web/scripts/generate-mp3-calibration-probes.mjs` (ffmpeg local; não é dependência do projeto).
