# M22-S4 — Reprodução MP3 sincronizada no Android (experimental)

Estado: **experimental, desligada por padrão**. `MP3_RELEASE_GATE = BLOCKED`, `PRODUCTION_DEPLOY_GATE = BLOCKED`. O backend continua sem abrir o codec nas rotas normais; nada nesta fase acessa o R2 real.

## S4-A — contrato e armazenamento (Dart)

- Flag de build `LOUVAIO_EXPERIMENTAL_MP3_AUDIO` (`MinistryAudioFeatureFlags.experimentalMp3`, padrão `false`), além do flag já existente da biblioteca (que em produção é sempre desligado). Sem a flag, MP3 e `schemaVersion` 2 continuam sendo recusados com os mesmos códigos (`AUDIO_CODEC_UNSUPPORTED` / `AUDIO_SCHEMA_UNSUPPORTED`).
- Leitura estrita de manifestos MP3 v2 (`MinistryAudioStem.fromJson(allowMp3)`): `mp3_cbr256`, estéreo, 44,1/48 kHz, `bitrateKbps` 256, ≤ 300 s, `alignment` com `infoFrame: true`, `encoderDelayFrames + frames + paddingFrames == mpegAudioFrames × 1152`, tamanho dentro dos limites CBR `(mpegAudioFrames + 1) × [144·256000/taxa]`, SHA-256, campos desconhecidos recusados. O conjunto precisa ser homogêneo (codec, taxa, frames e alinhamento iguais); conjuntos mistos e MP3 com transferência legada são recusados.
- Manifesto WAV v1 inalterado (aceito sempre); v2 só com seis stems MP3 e opt-in.
- Cache privado: MP3 usa `stem_<id>.mp3` e o schema local `louvaio-ministry-audio-local-mp3-v1` (com `alignment`); o WAV mantém `stem_<id>.wav`, o schema `louvaio-ministry-audio-local-v1` e a mesma identidade (digest) — caches WAV existentes não são migrados nem invalidados. A identidade MP3 inclui codec e alinhamento. A verificação local recusa manifesto local adulterado (taxa, frames, alinhamento, tamanho fora do CBR) e arquivo de mesmo tamanho alterado (SHA-256).
- Mesma transação (staging → rename atômico), renovação de URL (o manifesto, incluindo alinhamento, não pode mudar), recuperação, cota/LRU por escopo e reserva de espaço do WAV; MP3 e WAV convivem na mesma cota.
- Até o S4-C, o controlador de reprodução recusa (fail-closed, `AUDIO_CODEC_UNSUPPORTED`) qualquer conjunto não-WAV antes de chegar ao código nativo.
- Testes: `ministry_audio_mp3_models_test.dart`, `ministry_audio_mp3_cache_test.dart` (+ regressão WAV completa de `test/features/ministry_audio`).

## S4-B — decoder calibrado (Kotlin)

**Candidatos avaliados**: (A) decodificação sequencial MediaExtractor+MediaCodec para WAV temporário privado, reaproveitando o motor WAV/AudioTrack único; (B) decodificação incremental para buffers limitados dentro do mixer. Sem dependência nativa nova. **Selecionado: A** (menor risco, motor intacto, memória limitada); B não foi implementado.

**Medição no aparelho** (Lenovo TB-J616F, Android 12, `c2.mtk.mp3.decoder`; fixtures de impulso `backend/scripts/m22s4/generate-android-alignment-fixtures.ts`, 3 rajadas Hann de 4 kHz no início/meio/fim, 44,1 e 48 kHz):

| Perfil | Metadados no `MediaFormat` | Frames entregues | Offset sem tratamento | Com o decoder do app |
|---|---|---|---|---|
| Lavc (ffmpeg) | `encoder-delay=576`, `encoder-padding=` padding manifesto + 529 | exatamente `frames` (gapless aplicado pela plataforma) | 0 | 0 / 0 / 0 |
| LAME 3.100 (WASM Web) | ausentes | `mpegAudioFrames × 1152` (nada aparado) | +576 (= delay da tag; o decoder não soma delay extra) | 0 / 0 / 0 |

Conclusões: o Android NÃO trata os dois perfis do mesmo modo; o delay de 529 do servidor não é "removido" pelo decoder (o offset medido é só o delay da tag, 576 = `encoderDelayFrames − 529`). Política: se a plataforma informa delay/padding, eles têm de coincidir com o manifesto e a saída tem de ter exatamente `frames`; senão o app descarta `encoderDelayFrames − 529` frames e retém exatamente `frames`, exigindo `entregues ≥ delay_tag + frames` e `≤ mpegAudioFrames × 1152`. Nunca se completa com silêncio nem se corta para igualar contagens; qualquer divergência recusa (`AUDIO_NATIVE_MP3_LENGTH_MISMATCH` / `…_ALIGNMENT_UNVERIFIED`). Cada aparelho é verificado em tempo de execução por `Mp3DecoderCalibration` (dois fixtures embutidos, um por perfil/caminho, tolerância ±1 frame; ~217 ms); falha → MP3 recusado.

**Medidas (aparelho, 6 stems de 298 s, 44,1 kHz, LAME 3.100)**: ~27–34 s por stem, **185 s no total** de preparação; temporário **52,6 MB por stem, 315 MB** para os seis (WAV PCM16); heap Java ~4,7 MB e heap nativo ~5 MB após decodificar (decodificação em streaming; o buffer de trabalho é fixo). Esses números são o custo de A; B reduziria o disco, não foi medido.

**Cancelamento/limpeza**: o decoder checa o cancelamento a cada buffer; falha/cancelamento apagam o `.part`. Liberação de MediaCodec/MediaExtractor em `finally`.

Testes: `Mp3StemDecoderTest` (JVM, decoder falso que reproduz os dois comportamentos medidos), `Mp3DecoderDeviceTest` (instrumentado, MediaCodec real).