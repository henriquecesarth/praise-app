# ExecPlan — LouvAIO Mobile R17 Full Parity (Android + iOS)

- **Data de início:** 10/11/2026
- **Baseline R17 Web/API:** `5947309d67841ef28f13b7d859695a51b2e0a34c`
- **Branch de trabalho:** `feature/mobile-r17-full-parity-20261110`
- **Worktree isolado:** `C:/Users/henrique.hermogenes/Documents/p/praise/worktrees/mobile-r17-full-parity-20261110`
- **Toolchain verificada:** Flutter `3.47.5` • Dart `3.13.4`

---

## 1. Matriz Funcional de Paridade (Web R17 vs. Flutter Baseline `5947309d`)

| Funcionalidade | Web R17 | Flutter Atual (`5947309d`) | Trabalho Necessário | Status Inicial |
|---|---|---|---|---|
| **M21.1 Catálogo canônico de 40 exercícios** | 40 exercícios em `shared/vocal-exercises.json` (`vocal-01`..`vocal-40`, incluindo 10 descendentes `vocal-31`..`vocal-40` com duração final 2 e `category: ascendente\|descendente\|misto`) | 30 exercícios em `mobile/assets/vocal-exercises.json` e `vocal_catalog.dart`, sem `category` e sem `isCustom` | Sincronizar `mobile/assets/vocal-exercises.json` e `vocal_catalog.dart` 1:1 com `shared/vocal-exercises.json`, atualizar `VocalExercise` e criar teste de paridade 1:1 | `PARTIAL` |
| **M21.2 Biblioteca visual recolhível (M21-UX1)** | Categorias (`Todos`, `Ascendentes`, `Descendentes`, `Mistos`, `Meus exercícios`), busca, cards com direção melódica e nº de notas, auto-collapse ao selecionar, resumo compacto com `"Trocar exercício"`, botão `"Recolher"`, preservação de filtro/busca/scroll | `DropdownButtonFormField` simples sem categorias, sem busca e sem recolhimento | Implementar `VocalExerciseLibrary` nativa em Flutter com paridade completa M21-UX1, estado preservado, acessibilidade/Semantics e suporte claro/escuro | `MISSING` |
| **M21.3 Extensão vocal por notas musicais** | Seletores `Mais grave` e `Mais aguda` com notas em português (`Dó3`..`Mi6`, MIDI 60 = `Dó4`), presets (`Voz Grave`, `Voz Média`, `Voz Aguda`, `Padrão`), validação `min < max`, alerta quando exercício não cabe | `RangeSlider` exibindo números MIDI crus e intervalo limitado a `48..84` em `transposeBounds` | Substituir por seletores de notas musicais (`Dó3`..`Mi6`, MIDI `48..88`), adicionar presets da Web, validação `min < max` e aviso de extensão insuficiente | `PARTIAL` |
| **M21.4 Persistência da extensão vocal** | `PATCH /api/v1/auth/me/preferences` (`vocal_min_midi`, `vocal_max_midi`), botão `"Salvar minha extensão"`, hidratação do perfil, isolamento por usuário sem sobrescrever fontes do Smart Chords | `AuthUser` e `AuthRepository` só persistem `chord_font_family` e `chord_line_spacing_px` | Estender `AuthUser`, `PreferencesStorage`, `AuthRepository` e `AuthController` com `vocalMinMidi` e `vocalMaxMidi` via `PATCH /auth/me/preferences` com isolamento por conta e limpeza no logout | `MISSING` |
| **M21.5 Exercícios personalizados (CRUD)** | Endpoints `/api/v1/vocal-exercises/custom` (GET, POST, PATCH, DELETE), modal visual de criação/edição/duplicação com sequência de notas, durações (`0.5, 1, 1.5, 2, 3, 4`), pré-escuta e exclusão com confirmação | Inexistente no mobile | Criar `VocalExerciseRepository`, controller Riverpod com isolamento de sessão e modal/sheet `CustomExerciseEditorSheet` com pré-escuta e CRUD completo | `MISSING` |
| **M21.6 Teclado de piano opcional sincronizado** | Oculto por padrão (`"Mostrar teclado"` / `"Ocultar teclado"`), teclas brancas/pretas `Dó3`..`Mi6`, destaque em tempo real pela posição real do áudio, auto-scroll horizontal | Inexistente no mobile | Implementar `PianoKeyboard` em Flutter sincronizado com o head real de reprodução (`position`), preservando nota ativa em pausa e limpando no stop | `MISSING` |
| **M21.7 Áudio nativo Android + iOS e controles de transporte** | Piano acústico amostrado (`upright-kw`), BPM 40..160 + presets (`60, 72, 80, 96, 120`), metrônomo opcional, progressão ascendente/descendente semitom a semitom, Play/Pause/Resume/Stop | Android tem `VocalAudioPlayer.kt` + `SampledPianoMixer.kt` + `PianoBank.kt` (mas limita duração a `<= 8` em vez de `<= 16`, e falta barra de presets de BPM na UI); iOS `AppDelegate.swift` é apenas stub sem canal `com.louvaio.mobile/vocal_audio` | Ajustar limite de duração no Android para `<= 16`, adicionar presets rápidos de BPM na UI e implementar motor nativo de áudio amostrado em Swift no iOS (`AppDelegate.swift` / `VocalAudioPlayer.swift`) | `PARTIAL` / `PLATFORM_DEPENDENT` |
| **Repertório (D1): Modelo multi-versão, links e formulários** | Música com `versions[]`, `links[]`, classificação, `artist` preservado, omissão vs limpeza explícita (`null`), `MusicalKeySelectorField` | Implementado em `SongDetail`, `SongFormData`, `RepertoireView`, `SongFormScreen`, `VersionEditorSheet`, `MusicalKeySelectorField` | Auditar cards de listagem (`SongCard`) para exibir resumo de versões/tons quando houver múltiplas versões | `ALREADY_PARITY` |
| **Repertório (D1): Estante Musical (`SongDetailView`)** | Visualização inline de Cifra Inteligente vinculada com toggle `Cifra Inteligente` / `Apenas Letra`, seletor de cifras vinculadas, transposição inline (`-1`, `+1`, `Resetar`), `Vincular Cifra`, `Abrir no Cifrador` e `Desvincular` | `SongDetailView` lista cifras vinculadas apenas como cards de navegação no rodapé, sem leitura/transposição inline nem botão `Desvincular` direto | Implementar Estante Musical D1 em `SongDetailView` com toggle `Cifra Inteligente` / `Apenas Letra`, transposição inline, seleção entre cifras vinculadas, `Abrir no Cifrador` e `Desvincular` | `PARTIAL` |
| **Smart Chords: Parser, Notação Avançada e Transposição** | Progressões em compassos (`\| G \| D/F# \|`), repetições (`\|\|:`, `:\|\|`, `%`, `2x`), acordes opcionais `(Am)`, acordes adjacentes `C(Am)`, extensões `C(add9)/E`, `A7M/9`, acidentes Unicode (`B♭`, `F♯`, `E♮`), anotações `{{...}}` e `{{^...}}`, tablaturas preservadas | `SmartChordParser` suporta colchetes, compassos simples, barras e tablaturas, mas precisa de paridade integral com os 34 casos de referência de `smart_chord_reference_cases.ts` (acidentes Unicode, `{{...}}`, `C(add9)/E`, `C(Am)`, renderização de anotações no leitor) | Expandir `SmartChordParser`, `ChordLyricLine` e `MusicalProgressionLine` para suportar integralmente a matriz de 34 casos da Web + renderização limpa de anotações `{{...}}` sem corromper edição interativa | `PARTIAL` |
| **Smart Chords: Leitor, Preferências, Folha/PDF e Importação** | Modo Leitura vs Edição de Toque, auto-scroll, tela cheia, preferências `chord_font_family` e `chord_line_spacing_px`, preview de folha/PDF paginada com marcador, importação universal (PDF/Texto/URL/Imagem + Android Share) | Já implementado em `SmartChordReaderScreen`, `SmartChordFormScreen`, `SmartChordImportScreen` e `MainActivity.kt` | Validar integração com anotações avançadas e garantir preservação de `vocal_min_midi`/`vocal_max_midi` ao salvar preferências de fonte/espaçamento | `ALREADY_PARITY` |
| **Ambientes e Navegação (`AppEnvironment`, `AppShell`)** | Staging R17 em `https://louvaio-r17-api-staging.vercel.app/api/v1` | `AppEnvironment` só autoriza `louvaio-m20-c14-api-staging.vercel.app`; `Perfil` não tem atalho direto para Exercícios Vocais | Autorizar `louvaio-r17-api-staging.vercel.app` em `AppEnvironment` e adicionar entrada para Exercícios Vocais também na aba `Perfil` | `PARTIAL` |

---

## 2. Checkpoints de Execução

### Fase A — Preflight, Auditoria e Matriz de Paridade
- **Status:** `COMPLETED`
- **Resumo:**
  - Worktree isolado criado em `C:/Users/henrique.hermogenes/Documents/p/praise/worktrees/mobile-r17-full-parity-20261110` a partir do commit `5947309d67841ef28f13b7d859695a51b2e0a34c` na branch `feature/mobile-r17-full-parity-20261110`.
  - Repositório principal (`C:/Users/henrique.hermogenes/Documents/p/praise/praise-app`) preservado intacto sem modificações.
  - Auditoria comparativa concluída entre Web R17, Backend R17 e Mobile Flutter.
- **Próximo passo:** Executar Fase B (M21 Exercícios Vocais Completos + Ambiente Staging R17).

### Fase B — M21 Exercícios Vocais Completos + Ambiente Staging R17
- **Status:** `COMPLETED`
- **Resumo:**
  - `AppEnvironment` atualizado para autorizar `louvaio-r17-api-staging.vercel.app` em staging; testes em `app_environment_test.dart` (`PASS`).
  - Catálogo vocal sincronizado 1:1 com `shared/vocal-exercises.json` (40 exercícios `vocal-01`..`vocal-40`, incluindo 10 exercícios descendentes `vocal-31`..`vocal-40` e metadado `category`).
  - Biblioteca visual recolhível (`VocalExerciseLibrary`) implementada com filtro por categoria (`Todos`, `Ascendentes`, `Descendentes`, `Mistos`, `Meus exercícios`), busca textual, badges de direção melódica, auto-collapse ao selecionar, resumo compacto com `"Trocar exercício"` e preservação de filtros/scroll (M21-UX1).
  - Seletores musicais em português (`Dó3`..`Mi6`, MIDI 60 = `Dó4`), presets da Web (`Voz Grave`, `Voz Média`, `Voz Aguda`, `Padrão`), validação `min < max` e persistência via `PATCH /auth/me/preferences` (`vocal_min_midi`, `vocal_max_midi`) preservando `chord_font_family` e `chord_line_spacing_px` com isolamento por conta.
  - CRUD completo de exercícios personalizados (`/vocal-exercises/custom`) com modal visual (`CustomExerciseEditorSheet`), pré-escuta de áudio, duplicação de exercício do catálogo e limpeza de sessão ao trocar de usuário.
  - Teclado de piano opcional (`PianoKeyboard`, `Dó3`..`Mi6`) oculto por padrão e sincronizado em tempo real com a posição real do áudio.
  - Ajuste de duração até 16 tempos no Android (`MainActivity.kt` + `SampledPianoMixerTest.kt`) e implementação do motor nativo de áudio amostrado em Swift para iOS (`AppDelegate.swift`).
  - Atalho para Exercícios Vocais adicionado também na aba `Perfil` (`AppShell`).
  - 32 testes automatizados executados e aprovados (`app_environment_test.dart`, `vocal_player_test.dart`, `vocal_custom_and_preferences_test.dart`, `auth_repository_test.dart`).
- **Próximo passo:** Executar Fase C (Repertório R17 — Estante Musical D1 em `SongDetailView` e indicador de versões em `SongCard`).

### Fase C — Repertório R17 (Estante Musical D1 + Indicadores de Múltiplas Versões)
- **Status:** `COMPLETED`
- **Resumo:**
  - `SongDetailView` atualizado com a **Estante Musical D1** (`song_detail_music_stand_bar`):
    - Alternância inline entre `Cifra Inteligente` e `Apenas Letra`.
    - Seletor em pílulas (`song_detail_chord_pill_<id>`) quando há mais de uma cifra inteligente pessoal vinculada.
    - Controles inline de transposição (`-1 Semitom`, `+1 Semitom`, `Resetar`) e indicador de `Tom Original` e `Tom Atual`.
    - Renderização inline da cifra inteligente (`song_detail_inline_chord_sheet`) usando `MusicalProgressionLine` e `ChordLyricLine` com as preferências tipográficas do usuário.
    - Ações diretas `Abrir no Cifrador` e `Desvincular` com diálogo de confirmação.
  - `SongCard` atualizado para exibir badge `<N> versões` quando a música possui múltiplas versões cadastradas.
  - Matriz contratual `bpm-contract-matrix.json` incluída em `mobile/test/features/repertoire/data/fixtures/`.
  - Todos os 158 testes automatizados da suíte `test/features/repertoire` executados e aprovados (`PASS`).
- **Próximo passo:** Executar Fase D (Smart Chords R17 — Paridade 1:1 com os 34 casos de referência de `smart_chord_reference_cases.ts`, acidentes Unicode e semântica de anotações `{{...}}`).
