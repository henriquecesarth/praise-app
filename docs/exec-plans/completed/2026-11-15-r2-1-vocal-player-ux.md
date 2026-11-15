# ExecPlan: R2.1 — Refatoração UX do Player Vocal Android

- **Branch:** `fix/louvaio-audit-remediation-20261113`
- **Worktree:** `/Users/henrique/Documents/code projects/praise-app/praise-app-audit-remediation`
- **Base SHA:** `5527e4e6b6b934f02a18a4af4ad86cbb96627e02`
- **Owner / Orchestrator:** Gemini 4 Hydrogen + Codex (revisão independente)

## Objetivo

Transformar a tela de Exercícios Vocais Android (`VocalPlayerScreen`) em uma experiência compacta, legível, responsiva e intuitiva em celulares estreitos e tablets, com destaque imediato da nota atual no monitor e barra fixa de reprodução + volume interno sempre acessível no rodapé.

## Escopo Técnico

1. **Simplificação radical do monitor de notas (`vocal_monitor_card`)**
   - Remover completamente a lista de `Chip`s da sequência de notas.
   - Exibir visor central de leitura rápida inspirado em `web/src/components/VocalExercisePlayer.tsx`, destacando apenas a nota atualmente tocada (`Dó4`, `Ré4`, `Mi4`, etc. ou `Pausa`), com tom atual e BPM compactos.
   - Exibir indicadores claros de estado: `"Pronto"`, `"Tocando"`, `"Pausa"` e `"Concluído"`, reutilizando `_activeNote`, `_playing`, `_paused` e `_stepTranspose` sem duplicar fontes de verdade e minimizando reconstruções da tela via sinalização escopada ao monitor/teclado + `RepaintBoundary`.
   - Preservar o botão opcional `"Mostrar teclado"` / `"Ocultar teclado"` mantendo `PianoKeyboard` sincronizado com o áudio.

2. **Correção do overflow no `PianoKeyboard`**
   - Substituir o `Row` rígido do cabeçalho em `mobile/lib/features/vocal/presentation/widgets/piano_keyboard.dart` por `Wrap` adaptativo para eliminar overflow horizontal em telas estreitas e fontes ampliadas sem recortar teclas ou bloquear rolagem horizontal.

3. **Barra fixa de reprodução e volume interno no rodapé (`Scaffold.bottomNavigationBar`)**
   - Mover controles de reprodução (`Iniciar exercício`, `Pausar`/`Retomar`, `Parar`), indicador de estado e o controle único de volume interno (`0%..100%`, silenciar/reativar, persistido via `PreferencesStorage` e `setVolume` ao vivo sem reiniciar áudio) para uma única barra fixa em `Scaffold.bottomNavigationBar`.
   - Remover o antigo cartão isolado `vocal_volume_card` do corpo rolável (zero duplicação de volume ou transport controls em celular ou tablet).
   - Aplicar tratamento explícito de `SafeArea` / `padding.bottom` + `viewInsets.bottom` e espaçamento inferior adequado no `SingleChildScrollView` para que a navegação do Android, teclado virtual, modais/bottom sheets, campos e botão `"Salvar minha extensão"` nunca fiquem cobertos.

4. **Revisão visual e contraste de Extensão Vocal, BPM/Metrônomo e Progressão**
   - Melhorar distribuição e hierarquia em `vocal_range_card`, `vocal_tempo_card` e `vocal_progression_card` para evitar truncamentos/sobreposição em 360dp e escalas de texto 1.3x / 1.5x (dropdowns adaptativos lado a lado ou empilhados, controles de direção ascendente/descendente sem corte, botão `"Salvar minha extensão"` bem dimensionado, estados selecionados/desabilitados legíveis durante reprodução).

5. **Testes obrigatórios, revisão Codex e CI/APK Staging**
   - Estender `mobile/test/features/vocal/vocal_player_test.dart` cobrindo todos os cenários obrigatórios R2.1 (monitor de nota única e estados, slider/mute e persistência ao vivo de volume sem reiniciar áudio, barra fixa única com `SafeArea`/`viewInsets` inclusive teclado de 320dp, extensão vocal com feedback/presets/contraste, BPM/metrônomo, progressão ascendente/descendente, teclado opcional sincronizado, trava de proteção de estado em polling atrasado/troca de conta e 14 cenários responsivos em 360dp, 393dp, 740x360 paisagem+IME, tablet 768x1024 e 1024x768, escalas 1.0/1.3/1.5 e temas claro/escuro) preservando os testes existentes.
   - Executar revisão independente via Codex CLI sobre estabilidade de áudio/playback, persistência de volume e gerenciamento de estado (3 rodadas concluídas com veredito `APPROVE`).
   - Validar via GitHub Actions (`unified-staging-ci.yml`): `flutter analyze`, `flutter test`, `testStagingDebugUnitTest` (Kotlin) e novo artefato APK Debug Staging com SHA256 confirmado.

## Plano de Execução

- [x] Criar ExecPlan ativo e validar contratos de testes existentes
- [x] Corrigir cabeçalho responsivo de `piano_keyboard.dart`
- [x] Refatorar `vocal_player_screen.dart` (monitor simplificado, rebuild escopado, rodapé fixo `SafeArea`/`viewInsets` com volume + transport únicos, cartões de configuração responsivos e acessíveis)
- [x] Adicionar e atualizar suíte de testes Widget em `mobile/test/features/vocal/vocal_player_test.dart`
- [x] Executar revisão independente com Codex e corrigir eventuais apontamentos (Verdict: `APPROVE` após 3 rodadas)
- [x] Commitar, enviar para `fix/louvaio-audit-remediation-20261113`, acompanhar GitHub Actions e validar novo APK Staging (`43740134924`)
- [x] Corrigir overflows estreitos revelados pela nova suíte responsiva no CI (`_LockedSettingBadge` sob escala 1.5x e `CustomExerciseEditorSheet` dropdown/botões em 393dp)
- [x] Finalizar ExecPlan e mover para `docs/exec-plans/completed/`

## Resultados Finais e Evidências

- **Commits de código e validação CI:**
  - `b6736253f0878e4105f10546137486755bae2a1d` — refatoração UX R2.1 (`vocal_player_screen.dart`, `piano_keyboard.dart`, `vocal_player_test.dart`, ExecPlan ativo)
  - `e60d171e22212340b64b6b5459e87e168aeb9539` — correção de overflows estreitos no `_LockedSettingBadge` e `custom_exercise_editor_sheet.dart` (build alvo do APK Staging aprovado)
- **Revisão independente Codex:** 3 rodadas executadas sobre implementação e testes, culminando em **`Verdict: APPROVE`**.
- **GitHub Actions CI (`LouvAIO Unified Staging CI & APK Build`):**
  - Run: [`43740134924`](https://github.com/henriquecesarth/praise-app/actions/runs/43740134924) — **success** no commit `e60d171e22212340b64b6b5459e87e168aeb9539`
  - `Validate isolated staging configuration`: **PASS**
  - `flutter analyze` (`Run static analysis`): **PASS** (`No issues found! (ran in 11.7s)`)
  - `flutter test` (`Run Flutter test suite`): **PASS** (`01:55 +1226: All tests passed!`)
  - `Verify staging build consistency gate` (`app_environment_test.dart`): **PASS** (`12 tests passed.`)
  - `Run Android Kotlin unit tests` (`testStagingDebugUnitTest`): **PASS** (`BUILD SUCCESSFUL in 23s`)
- **Artefato APK Staging (`louvaio-unified-staging-debug`):**
  - Artifact ID: `14171778380` (`size_in_bytes: 104291145`)
  - Download URL: `https://github.com/henriquecesarth/praise-app/actions/runs/43740134924/artifacts/14171778380`
  - Archive ZIP digest: `sha256:8a0ca1a71a9f7dba80bbdf0c606a047c5025e30a2cb50780bc4d58bee42cdd3a`
  - SHA256 interno (`build/app/outputs/flutter-apk/app-staging-debug.apk`): `4625add5d211e401ffd45b4dff593589f3ca7efc09cb308e96469aac15a4ba04`
- **Limitação explícita / homologação física:** **`PHYSICAL_VALIDATION_PENDING`** — validação visual, tátil, foco de áudio e ergonomia em dispositivo Android físico real permanece pendente de execução pelo usuário com o novo APK gerado.
