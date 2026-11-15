# ExecPlan: Homologação R2 — Correções Funcionais, Musicais e Responsivas

- **Branch:** `fix/louvaio-audit-remediation-20261113`
- **Worktree:** `/Users/henrique/Documents/code projects/praise-app/praise-app-audit-remediation`
- **Base SHA:** `5f62bc90bcf929d681cab76d3174fee4b6816ec6`
- **Owner / Orchestrator:** Gemini 4 Hydrogen + Codex (revisão independente e integridade de dados/backend)

## Escopo das Fases

1. **FASE 1 — Exercícios vocais Android: áudio, volume e overflow**
   - Elevar loudness percebida em `SampledPianoMixer.kt` com normalização segura e soft-knee limiter preservando `clippedSamplesCount == 0`, qualidade do piano e sincronismo BPM.
   - Impedir que a variação do volume físico até o máximo interrompa a reprodução: não parar reprodução em `AppLifecycleState.inactive` (diálogos/avisos do sistema), usar `AudioManager.AUDIOFOCUS_GAIN` com `.setWillPauseWhenDucked(false)` no `AndroidAudioFocusController` e buffer mínimo adequado no `AudioTrack` (`BLOCK_SIZE * 16 * 2`), mantendo interrupção legítima para `AUDIOFOCUS_LOSS`, `AUDIOFOCUS_LOSS_TRANSIENT` e `ACTION_AUDIO_BECOMING_NOISY`.
   - Adicionar controle interno de volume (`0%..100%`, persistido em `PreferencesStorage`, sem alterar volume físico do aparelho e sem reiniciar/interromper áudio) no Flutter (`vocal_player_screen.dart`) e Android (`VocalAudioPlayer.kt`, `MainActivity.kt`), respeitando ducking proporcional e fade.
   - Corrigir `RIGHT OVERFLOWED BY 34 PIXELS` no header do `vocal_exercise_library.dart` e auditar responsividade completa da tela vocal.
   - Estender testes Kotlin (`SampledPianoMixerTest.kt`, `VocalAudioPlayerTest.kt`), Flutter (`vocal_player_test.dart`, `vocal_custom_and_preferences_test.dart`) e executar testes Kotlin também no workflow `.github/workflows/unified-staging-ci.yml`.

2. **FASE 2 — Smart Chords e Repertório: vínculo por versão (`version_id`)**
   - Atualizar contrato backend (`smart_chord_song_links`), repositories, services, controllers, Zod schemas, frontend Web (`api.ts`, `RepertoireView.tsx`/`SongDetail`, Smart Chords) e Flutter (`smart_chords`, `repertoire`) para suportar vínculo explícito por `version_id` além de `ministry_id`, `song_id`, `smart_chord_id`, `user_id`.
   - Garantir isolamento multi-tenant, privacidade por usuário, validação de que `version_id` pertence à música e ao ministério autorizado, suporte a múltiplas cifras e troca de versão em runtime.
   - Estratégia idempotente para dados legados sem `version_id`: música com 1 versão associa automaticamente; música com múltiplas versões marca vínculo legado como pendente de classificação (sem atribuir arbitrariamente à Original e sem exibir em todas as versões). Revisão independente com Codex.

3. **FASE 3 — Abertura de música pela Escala (Web + Mobile)**
   - Tornar clicável e acessível por teclado a lista de músicas em `web/src/components/ScheduleDetailView.tsx`, preservando contexto de volta para a escala e abrindo exatamente a `version_id` escalada (ou fallback explícito).
   - Verificar paridade e correções equivalentes no Flutter (`schedule_detail_screen`).

4. **FASE 4 — Descontinuação do módulo independente Liturgias (sem apagar Firestore)**
   - Inventariar referências em backend, web e mobile separando o que é compartilhado com Escalas/Roteiro do módulo independente Liturgies.
   - Remover entradas de menu/navegação na Web e Mobile, redirecionar rotas Web legadas de Liturgias para Escalas, desativar/remover telas exclusivas e descontinuar endpoints exclusivos no backend preservando 100% dos documentos no Firestore com plano de preservação/migração documentado. Revisão independente com Codex.

5. **FASE 5 — Melhorias visuais (Android e Web)**
   - Reorganizar controles da cifra/música na tela de Repertório Mobile (`SongDetail`) e validar responsividade da tela Vocal.
   - Melhorar `web/src/components/CreateScheduleModal.tsx` (abas superiores alinhadas, cabeçalho unificado, bordas/espaçamento/alinhamento consistentes em desktop/tablet/mobile e temas claro/escuro).

6. **FASE 6 — Testes, revisões independentes e qualidade**
   - Codex review independente de backend, integridade de dados e segurança.
   - Backend `npm run build` + `npm test`, Web `tsc`/build + Vitest + Playwright (desktop + mobile), GitHub Actions Flutter Analyze + testes Flutter + testes Kotlin.

7. **FASE 7 — GitHub, Vercel Preview (Staging) e novo APK Staging**
   - Commits organizados por domínio na branch `fix/louvaio-audit-remediation-20261113`.
   - Deploy manual Preview no Vercel Staging (Web + Backend) mantendo isolamento Firebase `louvaio-staging`.
   - Novo build de APK Android Staging via GitHub Actions no commit final, com entrega de link, SHA256 e manifest.

## Registro de Progresso

- [x] Fase 1 concluída e validada localmente (Android Vocal: ganho/normalização, foco/volume interno 0–100%, persistência e layout `Wrap`; validação física em hardware Android pendente)
- [x] Fase 2 concluída e validada (com revisão Codex — 3 rodadas; vínculos de cifras escopados por `version_id` em Backend/Web/Mobile)
- [x] Fase 3 concluída e validada (navegação Escala -> Música com `?version=`/`versionId` + Music Stand Bar Mobile)
- [x] Fase 4 concluída e validada (com revisão Codex — descontinuação controlada das Liturgias autônomas: `410 Gone`, redirect `/liturgias -> /escalas`, preservação integral no Firestore)
- [x] Fase 5 concluída e validada (contraste `#FFFFFF`/`--text-on-accent` Web Light/Dark >= 4.5:1, alinhamento do modal de escalas, wrap do banner de classificação pendente)
- [x] Fase 6 revisões e suítes completas aprovadas (Backend build + Vitest 91/91 arquivos, 2.604/2.604 testes; Web `tsc --noEmit` + Vitest serializado 44/44 arquivos, 775/775 testes; Playwright 60+9 cenários validados nas regressões)
- [ ] Fase 7 pushes, Vercel Staging e APK Staging entregues
