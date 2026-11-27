# Estado atual

Atualizado em 2026-11-27. Atualize ao fim de cada marco.

## Branch
`fix/louvaio-audit-remediation-20261113`. Enviada ao remoto em 2026-11-26, incluindo as correções `be675ab` (WAV) e `d8417de` (MP3 incremental).

## Em andamento: T3 do V3 Musical (acordes interativos acessíveis), 2026-11-27
Implementada na Web e no Android sobre `5b92119`; commit e push junto com a VH em 2026-11-27, **sem deploy**. A conferência humana no tablet (retrato, toque com o dedo e cifra sem deslocamento) não foi confirmada explicitamente. Evidências, limites e resíduos da revisão: seção "Fechamento da T3" em `docs/exec-plans/active/2026-11-16-v3-musical-phase-1-proposal.md`.

## Em andamento: VH do V3 Musical (violão e harmonia, antes chamada de T6), 2026-11-27
Motores e UI prontos na web e no Flutter, amostra aprovada, `feature-reviewer` sem bloqueios e teste no tablet aprovado pelo responsável; commit e push em 2026-11-27, **sem deploy**. As três pendências foram corrigidas depois da revisão; essas correções foram revisadas sem bloqueios e os achados corrigidos, exceto a notação nova no backend. Fechamento (licença do chords-db visível na web e no Flutter, teste do `AdminAvailabilityView`) em commit local, **sem push**. Detalhes: `docs/exec-plans/active/2026-11-27-v3-violao-harmonia.md`.

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

## Concluído: três defeitos do caminho WAV (`be675ab`)
Corrigidos em `MinistryAudioEngine.kt`: retomar após seek em pausa não toca mais o áudio antigo; pausar no dreno final não corta o fim; seek aceito durante a finalização é mantido.

- No Lenovo TB-J616F (Android 12), o AudioTrack pausado com tudo já escrito não voltou a avançar após `play()`. O motor passa a alimentar até 1 s de silêncio, sem bloquear, durante o dreno depois de uma pausa.
- JVM `ministryaudio`: 158 executados, 0 falhas, 1 ignorado. Os testes novos falharam antes da respectiva correção.
- Instrumentado `WavTransportDeviceTest` (flavor `vocal`, AudioTrack real): 3/3 PASS.
- Escuta humana (responsável, 2026-11-26, commit `be675ab`): PASS nos três cenários. Feita em app de escuta temporário com áudio sintético e o motor e AudioTrack reais; não cobre a tela de mixer do app.
- Suíte Flutter: NOT_EXECUTED (nenhum código Dart alterado).

## Concluído: corte do fim no MP3 incremental ao pausar no dreno (`d8417de`)
- Reproduzido no Lenovo TB-J616F: head parado em 38080 de 44100 frames após `resume`. Corrigido em `MinistryAudioEngine.kt`: o silêncio de até 1 s no dreno vale também para o incremental.
- JVM `ministryaudio`: 160 executados, 0 falhas, 1 ignorado. O teste novo de streaming falhou antes da correção; o do limite de 1 s do WAV falha se o limite for removido.
- Instrumentado (flavor `vocal`): `Mp3IncrementalDeviceTest` e `WavTransportDeviceTest`, 0 falhas; os casos que exigem fixtures longas foram ignorados (não estavam no app de teste). O teste de pausa no dreno passou 3 vezes nas quatro fixtures curtas.
- Depois do commit `d8417de`: `Mp3IncrementalDeviceTest` completo, com as gravações longas `s4long` e `s42lavc48`: 15/15 PASS, nenhum ignorado. Busca até voltar a avançar: medianas 1480 ms (LAME) e 1129 ms (Lavc).
- Investigação dos 1480 ms (mesmo tablet e fixtures, aparelho parado, um só harness; fase interrompida após 5 de 18 execuções). Medianas LAME / Lavc: `c65b283` 538 / 568 ms (n=12); `cbe36c6` 627 / 626 ms (n=6); `d8417de` 595 / 588 ms (n=12). Os 1480 ms não se reproduziram e não há sinal de regressão, com amostra menor que a planejada (36 por variante).
- **Sem regressão de seek.**
- Causa **provável, não demonstrada**, dos 1480 ms: o YouTube com o foco de áudio, tocando em paralelo (pediu o foco às 17:10:59 e só pausou às 17:21:10, durante a medição). A abertura dos seis codecs é a maior parte de cada busca.
- **Prova adiada para a homologação de foco de áudio** (rodada com o YouTube tocando: NOT_EXECUTED). O teste de busca cria o motor sem controle de foco; no app, que pede o foco, o YouTube tende a pausar. Para provar, medir com o harness sem foco e o YouTube tocando.
- Escuta humana (responsável, 2026-11-26): PASS ("está tudo ok"). Feita no app temporário "Escuta MP3" (pacote `com.louvaio.app.m21vocal`, fora do repositório), gravação `s4long`, motor e `AudioTrack` reais; não cobre a tela de mixer do app, download nem foco de áudio. Suíte Flutter (nenhum Dart alterado): NOT_EXECUTED.

## Pendências
- Rebuffering perto do fim também pausa o `AudioTrack` sem contar como pausa para o silêncio; se isso pode cortar o fim: **Unknown / Not yet verified**.
- Seek para muito perto do fim, sem pausa anterior, também reinicia o `AudioTrack` com buffer parcial e sem silêncio; se o fim é cortado nesse caso: **Unknown / Not yet verified**.
- E2/E3: a alteração local (não commitada) de `mobile/integration_test/m22_e1_ministry_audio_test.dart` importa um arquivo não rastreado de `integration_test/support/`. A versão commitada não tem esse import; regularizar ao commitar a alteração, antes de homologar um clone limpo.
- Ampliar duração para 10 minutos; carregamento automático do ONNX.
