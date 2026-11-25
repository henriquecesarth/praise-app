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
