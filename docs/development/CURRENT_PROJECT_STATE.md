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

## Defeitos conhecidos no caminho WAV (não corrigidos)
Já existiam antes do S4.2 (mesmo código em `a2d8a90`); as correções do S4.2 valem só para o caminho incremental. Origem: revisão de código em `MinistryAudioEngine.kt`; não reproduzidos em teste no caminho WAV.

1. Retomar após um seek feito em pausa toca um instante do áudio da posição antiga.
2. Pausar durante o dreno final pode cortar o fim do áudio.
3. Um seek aceito enquanto a reprodução está sendo finalizada é perdido.

## Pendências
- Decidir se os três defeitos do WAV entram numa tarefa própria.
- E2/E3: a alteração local (não commitada) de `mobile/integration_test/m22_e1_ministry_audio_test.dart` importa um arquivo não rastreado de `integration_test/support/`. A versão commitada não tem esse import; regularizar ao commitar a alteração, antes de homologar um clone limpo.
- Ampliar duração para 10 minutos; carregamento automático do ONNX.
