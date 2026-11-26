# Estado atual

Atualizado em 2026-11-26. Atualize ao fim de cada marco.

## Branch
`fix/louvaio-audit-remediation-20261113`. Remoto em `c65b283` (114 commits à frente da `main`).

## Concluído: M22-S4.2 (reprodução MP3 incremental no Android)
Concluído em `c65b283` (commits `08b45aa`, `2cd265d`, `49df80d` e `c65b283`). A reprodução incremental é **experimental e desligada por padrão**; o limite continua em 300 s. Detalhes, medidas e riscos: `docs/architecture/m22s42-android-mp3-incremental.md`.

- Suíte Flutter: PASS, em seis lotes (2020 testes) e `ministry_audio` repetido após a última correção (274).
- JVM: 181 PASS, 1 ignorado. `flutter analyze`: PASS. Testes instrumentados no Lenovo TB-J616F: PASS.
- Revisão independente (Codex): aprovada na quinta rodada.

## Bloqueios restantes
`MP3_RELEASE_GATE = BLOCKED` e `PRODUCTION_DEPLOY_GATE = BLOCKED`.

- Tempo total de abertura com backend real: NOT_EXECUTED.
- Fones físicos, logout, troca de ministério e revogação no aparelho: NOT_EXECUTED.
- Escuta humana: depende do responsável.
- Um único aparelho; stems longos só em LAME 44,1 kHz e Lavc 48 kHz.
- Perda ou duplicação de PCM dentro do codec só é detectada depois de parte do áudio tocar (risco residual).

## Concluído: três defeitos do caminho WAV (commit local, sem push)
Corrigidos em `MinistryAudioEngine.kt`: retomar após seek em pausa não toca mais o áudio antigo; pausar no dreno final não corta o fim; seek aceito durante a finalização é mantido.

- No Lenovo TB-J616F (Android 12), o AudioTrack pausado com tudo já escrito não voltou a avançar após `play()`. O motor passa a alimentar até 1 s de silêncio, sem bloquear, durante o dreno depois de uma pausa.
- JVM `ministryaudio`: 158 executados, 0 falhas, 1 ignorado. Os testes novos falharam antes da respectiva correção.
- Instrumentado `WavTransportDeviceTest` (flavor `vocal`, AudioTrack real): 3/3 PASS.
- Escuta humana (responsável, 2026-11-26, commit `be675ab`): PASS nos três cenários. Feita em app de escuta temporário com áudio sintético e o motor e AudioTrack reais; não cobre a tela de mixer do app.
- Suíte Flutter: NOT_EXECUTED (nenhum código Dart alterado).

## Pendências
- Caminho MP3 incremental não recebe o silêncio no dreno; se uma pausa no dreno final também corta o fim nele: **Unknown / Not yet verified**.
- E2/E3: a alteração local (não commitada) de `mobile/integration_test/m22_e1_ministry_audio_test.dart` importa um arquivo não rastreado de `integration_test/support/`. A versão commitada não tem esse import; regularizar ao commitar a alteração, antes de homologar um clone limpo.
- Ampliar duração para 10 minutos; carregamento automático do ONNX.
