# ExecPlan — R2.2: Estante Musical Compacta, Navegação Sequencial nas Escalas e RBAC/Visibilidade Compartilhada de Cifras

- **Data:** 2026-11-15
- **Branch:** `fix/louvaio-audit-remediation-20261113`
- **Baseline:** `4f252b78822901f8d3ff0725e3e685f17f1d0590`
- **Escopo:** Backend + Web + Mobile Flutter
- **Revisão independente:** Codex (lógica de navegação/versão/concorrência no mobile + modelagem RBAC/leitura compartilhada no backend/web/mobile)

---

## 1. Objetivo

Entregar uma experiência de Estante Musical compacta, responsiva e adequada ao uso ao vivo durante o culto no Android (`SongDetailView` e `_SongFullscreenStandScreen`), navegação sequencial entre músicas da escala sem empilhamento de telas nem perda de contexto de versão, e correção completa de autorização RBAC + visibilidade compartilhada de Cifras Inteligentes entre administradores e membros comuns do mesmo ministério no Backend, Web e Mobile.

---

## 2. Diagnóstico Técnico dos Problemas Atuais

### 2.1 Estante Musical D1 (`mobile/lib/features/repertoire/presentation/views/song_detail_view.dart`)
- A barra `song_detail_music_stand_bar` usa `ChoiceChip` extensos ("Cifra Inteligente", "Apenas Letra"), botões `OutlinedButton.icon` grandes ("Abrir no Cifrador", "Desvincular") visíveis para qualquer papel, e botões largos `-1 Semitom` / `+1 Semitom`.
- Em telas estreitas (320px–393px), esses controles ocupam várias linhas acima da cifra, reduzindo a área de leitura.
- Além disso, botões de vínculo (`Vincular cifra existente`, `Nova Cifra para esta música`, `Desvincular`, `Associar à <versão>`) são exibidos mesmo para usuários `member`.

### 2.2 Tela Cheia (`_SongFullscreenStandScreen`)
- O corpo usa `Center(child: ConstrainedBox(..., child: SingleChildScrollView(...)))`; quando o conteúdo tem altura menor que a viewport, `SingleChildScrollView` encolhe verticalmente e o `Center` deixa uma grande área vazia no topo.
- `ChordLyricLine` e `MusicalProgressionLine` sem scroll horizontal controlado ou sem container top-aligned prejudicam linhas largas/tablaturas.
- A barra flutuante usa `Align(alignment: Alignment.bottomRight)` com `Wrap` e botão largo `Sair`, quebrando em múltiplas linhas em celulares estreitos.

### 2.3 Navegação Sequencial nas Escalas (`schedule_detail_view.dart` & `song_detail_view.dart`)
- `_SongsSection` e `_TimelineSection` navegam para `SongDetailView` passando apenas um `songId` e `initialVersionId` avulsos, sem lista ordenada da escala nem índice da posição atual.
- Não existe navegador anterior/próximo (`Música X de Y`) na tela da música nem dentro da tela cheia (`_SongFullscreenStandScreen`), e alternar músicas no modo tela cheia não deve empilhar novas rotas nem manter auto-scroll/respostas assíncronas antigas.

### 2.4 Backend RBAC & Leitura Compartilhada de Cifras (`smart_chord_ministry.routes.ts`, `smart_chord.service.ts`)
- `smart_chord_ministry.routes.ts` aplica `requireMinistryRole('member')` globalmente para `GET`, `PUT` e `DELETE /:chordId/repertoire-link`, permitindo que membros comuns criem, atualizem, classifiquem ou removam vínculos no repertório.
- `smart_chord.service.ts` (`createSmartChord` / `updateSmartChord`) permite `syncCanonicalBridgeLink` e remoção de vínculo ao enviar `song_id`/`version_id` sem verificar `role === 'admin'` no ministério alvo.
- `SmartChordService.getMySmartChordsForSong` filtra estritamente por `user_id == caller` em `smart_chord_song_links` e `smart_chords`, impedindo que membros comuns (`member`) visualizem cifras vinculadas por administradores ao repertório do ministério.
- Web (`SongDetail.tsx`, `SmartChordsWorkspace.tsx`) e Mobile (`SongDetailView`, `SmartChordReaderScreen`, `SmartChordFormScreen`) exibem ações administrativas de vínculo/classificação/edição mesmo quando o papel ativo é `member`.

---

## 3. Plano de Implementação por Camada

### 3.1 Backend — RBAC Estrito + Leitura Compartilhada Segura (`backend/`)
1. **`backend/src/features/smart_chords/smart_chord_ministry.routes.ts`**
   - Manter `authenticate`.
   - `GET /:chordId/repertoire-link`: `requireMinistryRole('member')`.
   - `PUT /:chordId/repertoire-link` e `DELETE /:chordId/repertoire-link`: `requireMinistryRole('admin')` (retorna `403` para `member`).
2. **`backend/src/repositories/MinistryRepository.ts` & `SmartChordLinkRepository.ts` & `SmartChordRepository.ts`**
   - Adicionar método seguro `MinistryRepository.getAdminUserIds(ministryId: string)` (proprietário em `ministries.owner_user_id` + membros ativos em `ministry_members` com `role === 'admin'`).
   - Adicionar `SmartChordLinkRepository.getLinksBySongIdForMinistry(ministryId: string, songId: string)` sem filtro de `user_id`.
   - Adicionar `SmartChordRepository.getSmartChordsBySongIdForMinistry(songId: string)` / `getSmartChordByIdForLinkedRead(id: string, expectedOwnerUserId: string)` usado **exclusivamente** após validação de vínculo ativo pertencente ao `(ministryId, songId)` e verificação de autoria administrativa no ministério.
   - `GET /api/v1/smart-chords/:id`, `PUT /api/v1/smart-chords/:id`, `DELETE /api/v1/smart-chords/:id` e `GET /api/v1/smart-chords` permanecem estritamente privados por `user_id` (anti-IDOR `404` preservado).
3. **`backend/src/features/smart_chords/smart_chord.service.ts`**
   - `setRepertoireLink` e `removeRepertoireLink`: validação em profundidade `ministry.role !== 'admin' -> AppError(403, ...)`.
   - `validateSongAndArtistAccess` / `createSmartChord` / `updateSmartChord`: exigir `ministry.role === 'admin'` (`AppError(403, ...)`) sempre que um usuário tentar vincular, alterar versão, criar/associar vínculo via `song_id`/`version_id` ou desvincular (`song_id: null`) uma cifra em música pertencente a um ministério; preservar criação/edição/exclusão livre de cifras pessoais não vinculadas (`song_id` ausente/nulo em cifra pessoal).
   - `getMySmartChordsForSong(userId, ministryId, songId, options)`:
     - Autentica integrante via `getMinistryById(ministryId, userId)` e valida música pertencente a `ministryId` (`404` caso contrário).
     - Para `linkStatus === 'pending_classification'`: se `ministry.role !== 'admin'`, retornar `[]` imediatamente (membros não classificam nem visualizam pendências administrativas). Para `admin`, manter listagem de pendências administrativas do usuário/ministério.
     - Para `linkStatus === 'active'`: buscar links canônicos da `(ministryId, songId)` via `getLinksBySongIdForMinistry` filtrando apenas vínculos cujo `link.user_id` pertence aos administradores ativos do ministério (ou proprietário); avaliar versão estritamente (`filterVersionId`), carregar leitura somente dos acordes com vínculo canônico ativo válido (verificando correspondência de `user_id` do criador do vínculo) e incluir legado administrativo (`song_id == songId` de admin sem vínculo canônico movido para outro canto e com versão única inequívoca). Nunca retornar cifras pessoais sem vínculo ou vinculadas a outros ministérios/versões.

### 3.2 Web — RBAC na Estante e no Cifrador (`web/`)
1. **`web/src/components/SongDetail.tsx` & `web/src/App.tsx`**
   - Receber `userRole?: GroupRole` explicitamente em `SongDetail` (`App.tsx` já possui `userRole`, passar `userRole={userRole}`; derivar `canManageRepertoire = userRole === 'admin'`).
   - Quando `!canManageRepertoire` (`member`):
     - Ocultar `Vincular Cifra` / `Vincular Outra Cifra`, `Desvincular`, banner/ações de classificação pendente (`pending-chords-classification-banner`), além de manter `Editar`/`Excluir` ocultos e restringir `Abrir no Cifrador` a administradores/proprietários autorizados.
     - Preservar integralmente alternância `Cifra Inteligente` / `Apenas Letra`, troca entre versões da música, seleção entre múltiplas cifras da versão, transposição visual temporária (`-1`/`+1`/`Resetar`), ajuste de fonte (`A-`/`A+`) e leitura limpa.
2. **`web/src/components/SmartChordsWorkspace.tsx` & `SmartChordEditor.tsx`**
   - Passar `userRole` para `RoutedSmartChords` -> `SmartChordsWorkspace` -> `SmartChordEditor`.
   - Ocultar controles de vínculo/classificação ao repertório do ministério ativo quando `userRole === 'member'`, mantendo leitura/criação/edição pessoal não vinculada sem causar `403` acidental ao salvar.

### 3.3 Mobile Flutter — Fases 1, 2, 3 e Adendo RBAC (`mobile/`)
1. **Fase 1 — Estante Musical Compacta (`song_detail_view.dart`)**
   - Substituir os botões/chips grandes por uma barra compacta com ícones e grupos coesos:
     - Segmented/toggle compacto com ícones (`Icons.music_note`, `Icons.article_outlined`) + tooltips + `Semantics(selected: ...)` para `Cifra Inteligente` vs `Apenas Letra`, mantendo alvos >= 44dp.
     - Versão ativa e tom atual exibidos de forma discreta no cabeçalho da estante sem repetir títulos extensos.
     - Seletor compacto de múltiplas cifras na mesma versão.
     - Controles agrupados e compactos para transposição (`-`, tom atual / reset, `+`), fonte (`A-`, tamanho, `A+`), auto-scroll (play/pause + velocidade `1x..5x`) e tela cheia (`Icons.fullscreen_rounded`).
     - Ação compacta para `Abrir no Cifrador` (visível apenas quando `isAdmin` e proprietário da cifra, ou admin conforme permissão).
     - `Desvincular` movido para um menu de opções (`PopupMenuButton`, visível apenas para `isAdmin`), preservando o diálogo de confirmação `AlertDialog` com `confirm_unlink_smart_chord_button`.
     - Ocultar para `member` os botões `+` / `Vincular` / `Nova Cifra`, `Vincular cifra existente` no estado vazio, `Desvincular` e ações de associação de pendências.
2. **Fase 2 — Tela Cheia Top-Aligned (`_SongFullscreenStandScreen`)**
   - Substituir `Center` por `Align(alignment: Alignment.topCenter, ...)` com `ConstrainedBox(constraints: BoxConstraints(maxWidth: 900))` e `SizedBox(width: double.infinity, ...)` para começar imediatamente próximo ao topo sem área vazia e centralizar o bloco de leitura apenas horizontalmente em telas largas/tablet sem `TextAlign.center`.
   - Envolver cada bloco musical com scroll horizontal controlado (`SingleChildScrollView(scrollDirection: Axis.horizontal)` por faixa ou bloco musical alinhado com `LayoutBuilder`) mantendo largura mínima igual à área útil para preservar alinhamento exato entre acordes, letras, tablaturas e progressões em qualquer tamanho de fonte/transposição.
   - Reorganizar barra inferior dentro de `SafeArea` (`Align(alignment: Alignment.bottomCenter)`), compacta, em linha única adaptativa/rolável se 320px, com padding inferior generoso na cifra para não cobrir as últimas linhas, contendo: Anterior/Próxima (quando em sequência de escala), `-`, `+`, `A-`, `A+`, auto-scroll, velocidade e `Sair`.
3. **Fase 3 — Navegação Sequencial nas Escalas (`schedule_detail_view.dart` & `song_detail_view.dart`)**
   - Criar modelo tipado `ScheduleSongSequenceItem` e `ScheduleSongSequenceContext` (lista ordenada de entradas da escala preservando duplicatas em posições ou versões distintas na ordem exata da escala, índice atual `currentIndex`, helpers seguros `hasPrevious`, `hasNext`, `moveTo(index)`).
   - Em `schedule_detail_view.dart`: helper compartilhado `_openScheduleSongSequence(...)` usado tanto em `_SongsSection` (abrindo diretamente a lista de músicas na ordem da escala pelo índice da entrada clicada) quanto em `_TimelineSection` (construindo a sequência a partir da ordem da escala `songs`, localizando a entrada correspondente do slot clicado para abrir no índice exato com suporte à versão da escala).
   - Em `SongDetailView`: gerenciar o item ativo via estado de sessão de leitura (sem empurrar novas rotas `Navigator.push` a cada troca de música), com barra sequencial compacta (`Icons.chevron_left`, `"Música X de Y"`, `Icons.chevron_right`, botões desabilitados nas extremidades) e preservação do botão `"Voltar para Escala"`. Quando aberto pelo Repertório (`sequence == null`), a barra sequencial não aparece.
   - Ao trocar para música anterior/próxima (tanto na `SongDetailView` quanto dentro do `_SongFullscreenStandScreen` sem empilhar rotas):
     - Parar imediatamente `autoScroll` anterior;
     - Incrementar token/sequência da sessão e descartar respostas assíncronas obsoletas (`SongDetailNotifier` + `SongSmartChordsNotifier`);
     - Resetar scroll da cifra ao topo e limpar conteúdo visual da música anterior imediatamente (exibindo carregamento da nova música sem flash de cifra/letra antiga);
     - Resetar transposição efêmera (`_chordSemitones = 0`) e `_selectedChordIndex = 0`;
     - Preservar preferências visuais de sessão (tamanho da fonte, velocidade de auto-scroll e modo de leitura preferido);
     - Carregar detalhes da música e cifras filtrando pela `versionId` vinculada à entrada atual da escala;
     - Tratar erro `404`/música removida ou indisponível de forma elegante com mensagem explícita e mantendo a barra sequencial ativa para avançar/voltar na escala ou voltar à escala;
     - Proteger troca de ministério e logout limpando contexto e cancelando requisições em voo.
4. **RBAC no Mobile Cifrador (`SmartChordReaderScreen` / `SmartChordFormScreen`)**
   - Ocultar controles de vínculo/alteração/desvínculo/classificação com o repertório do ministério ativo quando `ministryContext.selectedMinistry?.isAdmin != true`.

---

## 4. Plano de Testes e Validações

- **Backend (Vitest):**
  - Novos/atualizados testes em `smart_chord_repertoire_link.test.ts`, `smart_chord.feature.test.ts` e novo teste de integração de rotas/HTTP (`smart_chord_rbac_routes.test.ts` se necessário via supertest):
    - Admin vincula/atualiza/classifica/desvincula cifra com sucesso (200/204).
    - Member recebe `403` em `PUT/DELETE /:chordId/repertoire-link` e ao tentar vincular/alterar vínculo via `POST/PUT /smart-chords` com `song_id`/`version_id`.
    - Member lê cifras ativas vinculadas por admin para `(ministryId, songId, versionId)`.
    - Cifras pessoais não vinculadas de outros usuários NÃO são expostas.
    - Sem vazamento entre versões (`ver-1` vs `ver-2`) nem entre ministérios (`min-A` vs `min-B`).
    - Usuário de outro ministério (`outsider`) recebe `403/404` conforme endpoint sem vazar dados.
  - Rodar `cd backend && npm run build && npm test`.
- **Web (Vitest):**
  - Estender `web/src/components/SongDetail.test.tsx` (e verificar `ScheduleDetailView.test.tsx` / `SmartChordsWorkspace` tests):
    - Admin vê ações de vínculo/desvínculo/classificação e `Abrir no Cifrador`; Member lê cifras compartilhadas com transposição temporária, modo cifra/letra e zoom, mas NÃO vê vínculo/desvínculo/classificação/edição/exclusão.
  - Rodar `cd web && npm run build && npm test`.
- **Mobile Flutter (Widget & Unit Tests, via GitHub Actions CI já que macOS 12 local não executa Dart VM):**
  - Estender `song_detail_view_test.dart`, `schedule_detail_view_test.dart`, e testes do `SmartChordReaderScreen`:
    - Barra D1 compacta sem `ChoiceChip` antigos, menu de opções com confirmação de `Desvincular` (somente admin), member read-only sem ações admin.
    - Fullscreen top-aligned (verificar posição `y` do cabeçalho próxima do topo em tela alta 393x852, barra inferior centralizada sem overflow a 320px/360px/393px, tablet 800px, tema claro/escuro, `textScaleFactor: 1.5`).
    - Navegação sequencial na escala (`_SongsSection` e `_TimelineSection`, inclusive músicas repetidas em posições diferentes e versões distintas), navegação anterior/próxima dentro e fora da tela cheia sem empilhamento de rotas, cancelamento de corrida assíncrona (`Completer`), reset de transposição, preservação de fonte/velocidade, falha 404 com continuidade para próxima música, ausência da barra sequencial quando aberto pelo Repertório.
- **Revisão independente Codex + Deploy Staging Web/Backend + GitHub Actions Android CI + APK Staging.**


---

## 5. Checkpoint Atual e Evidências Verificadas (2026-11-16)

- **Branch / Worktree:** `fix/louvaio-audit-remediation-20261113` (`/Users/henrique/Documents/code projects/praise-app/praise-app-audit-remediation`)
- **SHAs de Código Publicados no GitHub:**
  - Backend RBAC/leitura compartilhada: `dad9878`
  - Web RBAC/leitura compartilhada: `10e16ad`
  - Mobile R2.2 (estante compacta, fullscreen top-aligned, navegação sequencial nas escalas e RBAC): `ec19f7f`, `3edf8fe`, `4b0306c`, `ae5a78ca36047fd4eda450ad1e9df30720b8ab5c`
- **Revisões Independentes (Codex CLI):**
  - Backend + Web (`codex_review_backend_web_v2`): **NO BLOCKING ISSUES FOUND**
  - Mobile R2.2 (`codex_review_mobile_v3`): **NO BLOCKING ISSUES FOUND**
- **Validação Backend (pós-última edição Backend):**
  - `cd backend && npm run build && npm test`: **PASS** (`92` test files passed, `2611` tests passed, `0` failures).
- **Validação Web (pós-última edição Web):**
  - `cd web && npx tsc --noEmit && npx vite build --mode test`: **PASS**.
  - `cd web && caffeinate -dimsu npx vitest run --maxWorkers=1`: **PASS** (`44` test files passed, `777` tests passed, `0` failures em `144.88s` com timeouts padrão).
- **GitHub Actions Android (`LouvAIO Unified Staging CI & APK Build`):**
  - Run [`43836618907`](https://github.com/henriquecesarth/praise-app/actions/runs/43836618907) no SHA `ae5a78ca36047fd4eda450ad1e9df30720b8ab5c`:
    - Steps 1–11 concluídos com **success**: `Validate isolated staging configuration` (**PASS**), `Run static analysis` (`flutter analyze`, **PASS**), `Run Flutter test suite` (**PASS**), `Verify staging build consistency gate` (**PASS**).
    - Steps 12–14 (`Build staging debug APK`, `Run Android Kotlin unit tests`, `Upload staging APK artifact`): **em andamento no momento deste checkpoint documental**.
- **Continuidade Windows:** [`WINDOWS_MIGRATION_CONTINUITY_20261116.md`](../../development/WINDOWS_MIGRATION_CONTINUITY_20261116.md).
- **Homologação física Android:** `PHYSICAL_VALIDATION_PENDING`.
