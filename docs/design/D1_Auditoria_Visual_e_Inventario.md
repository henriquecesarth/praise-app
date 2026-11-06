# LouvAIO — Design D1: Auditoria Visual, Inventário Real e Paridade Web/Flutter

- **Status:** Entregável Oficial D1 (Somente Leitura do Código de Produto)
- **Bases Auditadas:**
  - **Web/Backend R16:** commit `29d09f1` (`release/m20-r16-web-backend`)
  - **Android M20:** commit `11b5797` (`release/m20-r16-android-production`)
  - **M21 Vocal:** checkpoint `f3aed6cd` (`m21-vocal-checkpoint-r3`, branch `feat/m21-vocal`) e homologação Android `docs/exec-plans/evidence/m21-2/android-homologation-r4.json`
- **Referência do Proprietário:** `docs/design/LouvAIO_Design_System_v0_1.md` e ADR `docs/decisions/2026-08-28-louvaio-visual-identity.md`

---

## 1. Inventário de Rotas, Telas e Navegação

### 1.1 Mapa de Rotas Web (`web/src/routing.ts` — R16 `29d09f1` + M21 `f3aed6cd`)

| Rota Canônica | Módulo (`ActiveModule`) | Componente Principal | Requer Sessão (`shouldBootstrapSession`) | Controle de Acesso / Contexto |
| :--- | :--- | :--- | :--- | :--- |
| `/` | `dashboard` | `DashboardView.tsx` | Sim | Isolado por `selectedGroupId` (`ministryId`); atalhos e mural variam por `isAdmin`. |
| `/escalas` | `schedules` | `SchedulesView.tsx` | Sim | Listagem do ministério ativo; abas `Próximas` e `Passadas`; botão `+ Nova Escala` apenas `isAdmin`. |
| `/escalas/:scheduleId` | `schedules` | `ScheduleDetailView.tsx` | Sim | Detalhe da escala, confirmação de presença do membro, equipe escalada, repertório na ordem da liturgia, mural de comentários e edição (`CreateScheduleModal`). |
| `/repertorio` | `repertoire` | `App.tsx` (inline view) | Sim | Sub-abas `Músicas`, `Pastas`, `Artistas`; busca com debounce 300ms; `FilterPopover` (Tom Original + YouTube); CRUD administrativo (`SongFormModal`, `CreateSongModal`, `VersionEditModal`). |
| `/repertorio/:songId` | `repertoire` | `SongDetail.tsx` | Sim | Seletor de versões, barra de Cifra Inteligente vinculada, transposição em semitons, letra/cifra/tablatura/progressão, ficha da versão e links externos. |
| `/repertorio/pastas/:folderId` | `repertoire` | `FolderDetail.tsx` | Sim | Lista de músicas da pasta temática; adição/remoção de músicas (`isAdmin`). |
| `/cifras` | `cifrador` | `SmartChordsWorkspace.tsx` (`SmartChordsLibrary.tsx`) | Sim | Biblioteca pessoal por `user_id` (`Minhas Cifras`), busca, `Importar` (`SmartChordImportModal`) e `Criar Cifra`. |
| `/cifras/nova` | `cifrador` | `SmartChordsWorkspace.tsx` (`SmartChordEditor.tsx`) | Sim | Criação de cifra pessoal com alternância obrigatória `Editar` / `Visualizar`. |
| `/cifras/:id/editar` | `cifrador` | `SmartChordsWorkspace.tsx` (`SmartChordEditor` / `SmartChordReader`) | Sim | Workspace da cifra pessoal; modos mutuamente exclusivos `Editar` (`data-workspace-mode="edit"`) e `Visualizar` (`data-workspace-mode="read"`), PDF (`SmartChordPdfSettings`). |
| `/liturgias` | `liturgies` | `LiturgiesView.tsx` | Sim | Modelos de liturgia reutilizáveis do ministério (`Liturgia & Ordem de Culto`), itens ordenáveis (`▲`/`▼`), indicação de louvor (`isSong`). |
| `/ministerio` | `ministry` | `MinistryView.tsx` (`hub`) | Sim | Hub administrativo e pessoal do ministério ativo. |
| `/ministerio/membros` | `ministry` | `MinistryView.tsx` (`members`) | Sim | Diretório de membros, busca, filtro por função, convite e edição de funções do membro (`isAdmin`). |
| `/ministerio/equipes` | `ministry` | `TeamsView.tsx` | Sim | Gestão de equipes fixas/base do ministério (`isAdmin`). |
| `/ministerio/funcoes` | `ministry` | `RolesView.tsx` | Sim | Catálogo de funções ministeriais/instrumentos (`isAdmin`). |
| `/ministerio/classificacoes` | `ministry` | `ClassificationsView.tsx` | Sim | Classificações temáticas de músicas (`isAdmin`). |
| `/ministerio/administradores` | `ministry` | `AdminsView.tsx` | Sim | Promoção e revogação de administradores (`isAdmin`). |
| `/ministerio/modelos` | `ministry` | `TemplatesView.tsx` | Sim | Modelos de escala/culto legado (`isAdmin`). |
| `/ministerio/plano` (`/assinatura`) | `ministry` | `SubscriptionPlanView.tsx` | Sim | Gestão financeira e quotas (`SubscriptionService` + Asaas), preview de troca de plano, blocos extras, histórico, cancelamento/reversão e ativação antecipada (`isAdmin`). |
| `/ministerio/disponibilidade` (`/indisponibilidade`) | `ministry` | `MemberAvailabilityView.tsx` | Sim | Registro pessoal de períodos de indisponibilidade do voluntário. |
| `/ministerio/disponibilidade-equipe` (`/disponibilidade-admin`) | `ministry` | `AdminAvailabilityView.tsx` | Sim | Visão consolidada de indisponibilidades da equipe e lançamento manual (`ManualMemberAvailabilityModal`) (`isAdmin`). |
| `/ministerio/whatsapp` | `ministry` | `WhatsAppFoundationView.tsx` | Sim | Status comercial, capacidade organizacional e conexões WhatsApp (`isAdmin`). |
| `/whatsapp/callback` | `whatsapp-callback` | `WhatsAppCallbackPage.tsx` | Sim | Retorno OAuth/onboarding Meta WhatsApp. |
| `/privacidade` | `privacy` | `PrivacyPolicyView.tsx` | **Não** (pública) | Política de Privacidade pública e acessível dentro/fora da sessão. |
| `/exclusao-conta` | `account-deletion` | `AccountDeletionView.tsx` | **Não** (pública) | Fluxo e instruções de exclusão de conta (compliance Google Play / LGPD). |
| `/exercicios-vocais` *(M21 Vocal)* | `vocal` | `VocalExercisePlayer.tsx` | **Não** (`module !== 'vocal'`) | Exercícios vocais interativos com piano visual de 37 teclas (`C3–C6`), tessitura (`Range`), BPM, metrônomo e motor Web Audio / PCM. |

### 1.2 Mapa de Rotas e Telas Flutter (`mobile/lib/app/router/app_router.dart` & `app_shell.dart` — M20 `11b5797` + M21 `f3aed6cd`)

| Rota / Navegação | Tela Flutter | Equivalente Web | Diferença Estrutural Relevante |
| :--- | :--- | :--- | :--- |
| `/login` | `LoginScreen` | `LoginPage.tsx` | No M21 Vocal, inclui botão direto para `/vocal` antes do login. |
| `/ministry-empty` | `MinistryEmptyScreen` | Estado sem ministério em `App.tsx` | Tela dedicada com sheets `CreateMinistrySheet` e `JoinMinistrySheet`. |
| `/ministry-selector` | `MinistrySelectorScreen` | `sidebar-group-select` / `MobileAccountMenu` | Tela dedicada quando nenhum ministério está ativo; troca rápida via `MinistrySwitcherSheet`. |
| `/home` (Tab 0) | `DashboardView` (`dashboard_view.dart`) | `DashboardView.tsx` | Focado em `Minhas Próximas Escalas` e `Mural de Avisos` (sem a grade de 7 atalhos coloridos da Web). No M21, inclui card/botão para `/vocal`. |
| `/home` (Tab 1) | `SchedulesView` (`schedules_view.dart`) | `SchedulesView.tsx` | Push para `ScheduleDetailView`, `ScheduleFormScreen` e `ScheduleChatView`. |
| `/home` (Tab 2) | `RepertoireView` (`repertoire_view.dart`) | `/repertorio` (`App.tsx`) | Lista paginada com busca e chips horizontais de `Classificação` (não possui abas `Pastas` e `Artistas` nem filtro por `Tom`/`YouTube` na barra de busca). |
| `/home` (Tab 3) | `_ProfileStubView` (`app_shell.dart`) | `MinistryView.tsx` + `MobileAccountMenu.tsx` | Agrupa Perfil, Troca de Ministério, Tema Claro/Escuro e links (`ListTile`) para: `Minha Disponibilidade`, `Disponibilidade da Equipe`, `Equipes`, `Liturgias`, `Cifras Inteligentes`, `Membros` e `Notificações`. |
| Push via Repertório | `SongDetailView` (`song_detail_view.dart`) | `SongDetail.tsx` | Seletor de versões (`ChoiceChip`), badges de `Tom`/`BPM`/`Duração`/`Classificações`, card de `Cifras Inteligentes Vinculadas` (abre `SmartChordReaderScreen`), `Links e Recursos` e `Letra`. |
| Push via Repertório | `SongFormScreen` + `VersionEditorSheet` | `CreateSongModal.tsx` + `VersionEditModal.tsx` | Tela dedicada + bottom sheet para edição completa de versões, links padrão e links customizados. |
| Push via Perfil / Música | `SmartChordsScreen` | `SmartChordsLibrary.tsx` | Lista com busca, refresh, botão `Importar cifra` no AppBar e FAB `+ Nova Cifra`. |
| Push via Cifras | `SmartChordReaderScreen` | `SmartChordReader.tsx` + `SmartChordPdfSettings.tsx` | Leitor com barra sticky de transposição (`-`/`+`/`Reset`), tamanho de fonte (`A-`/`A+`), seletor de fonte, sheet de espaçamento (`0–24px`), vínculo com repertório e preview de folha PDF. |
| Push via Cifras | `SmartChordFormScreen` | `SmartChordEditor.tsx` | Editor em tela dedicada com toggle `_showPreview` (`Editar` vs `Pré-visualizar`), inserção rápida de acordes e vínculo com música. |
| Push via Cifras / Share | `SmartChordImportScreen` + `CifraClubCaptureScreen` | `SmartChordImportModal.tsx` | 4 abas (`PDF`, `Texto`, `URL`, `Imagem`) + suporte nativo a Android Share Intent (`ShareIntentService`), OCR local (`ImageOcrService`) e captura assistida WebView (`CifraClubCaptureScreen`). |
| `/vocal` *(M21 Vocal)* | `VocalPlayerScreen` | `VocalExercisePlayer.tsx` | Teclado CustomPaint de 37 teclas (`C3–C6`), síntese PCM 16-bit 44.1 kHz via MethodChannel `com.louvaio.mobile/vocal_audio`. |

---

## 2. Inventário Completo de Componentes (Web R16 + M21)

| Categoria | Arquivo (`web/src/components/...`) | Responsabilidade Real | Estado / Observações de Design |
| :--- | :--- | :--- | :--- |
| **Shell & Navegação** | `App.tsx` | Shell autenticado, sidebar desktop, orquestração de rotas, estado global do repertório e modais globais. | Mistura shell de navegação com toda a view de listagem de Repertório (~1.600 linhas). Sidebar tem excesso de widgets e botões de ação. |
| **Shell & Navegação** | `Header.tsx` | Cabeçalho mobile/responsivo, busca contextual no Repertório, botão de filtro, botão `+ Música`, toggle de tema e avatar. | Oculta o título e o seletor de ministério quando `activeModule === 'repertoire'`, substituindo-os pela busca. |
| **Shell & Navegação** | `BottomNav.tsx` | Barra inferior mobile com 5 destinos (`Início`, `Escalas`, `Repertório`, `Cifras`, `Ministério`). | Omite `Liturgias` (presente na sidebar desktop). |
| **Shell & Navegação** | `MobileAccountMenu.tsx` | Bottom sheet / modal de conta no mobile: dados do usuário, troca de ministério, ações de convite/criação, tema e logout. | Repete os mesmos controles da sidebar desktop em layout de sheet. |
| **Repertório** | `SongCard.tsx` | Card de música na grade do Repertório. | Altura mínima ~90px, avatar com gradiente, hover com `translateY(-4px)`, baixa densidade (3 cards/linha no desktop). |
| **Repertório** | `FolderCard.tsx` & `FolderDetail.tsx` | Card de pasta temática e tela de detalhe da pasta com gestão de músicas. | Usa ícone colorido customizável e modal de adição de músicas do repertório. |
| **Repertório** | `ArtistCard.tsx` | Card de artista na aba `Artistas` do Repertório. | Avatar circular com gradiente roxo/verde legado e contador de músicas. |
| **Repertório** | `FilterPopover.tsx` | Popover de filtro de músicas por `Tom Original` (12 tons) e switch `Apenas com YouTube`. | Largura fixa `320px`, posicionamento absoluto no Header. |
| **Repertório** | `SongDetail.tsx` | Visualização completa da música, versões, cifra inteligente vinculada, transposição, tablatura, progressão, links e ficha técnica. | Possui duas barras de controle empilhadas (abas de Versão + barra de Cifra Inteligente + barra de Transposição). |
| **Repertório** | `CreateSongModal.tsx` & `VersionEditModal.tsx` | Criação/edição de música com múltiplas versões (`Versão Principal`, `Clonar`, `Editar`, `Excluir`). | Formulário longo em coluna única; `VersionEditModal` empilha sobre `CreateSongModal` (`z-index: 1050`). |
| **Repertório** | `SongFormModal.tsx` | Modal legado de criação/edição simples de música. | Mantido no código; `App.tsx` utiliza `CreateSongModal` para o fluxo com versões. |
| **Cifras Inteligentes** | `SmartChordsWorkspace.tsx` & `RoutedSmartChords.tsx` | Container principal do módulo de Cifras Inteligentes, roteamento `/cifras/*`, estado de edição/leitura, dirty guard e geração de PDF (`html2pdf`). | Contém tag `<style>` inline residual (linhas 1179–1250) que duplica/conflita com `workspace.css`. |
| **Cifras Inteligentes** | `smart-chords/SmartChordsLibrary.tsx` | Biblioteca pessoal (`Minhas Cifras`), busca, botões `Importar` e `Criar Cifra`, grade de cards. | Visual limpo, mas cards não exibem claramente o vínculo com o repertório na listagem. |
| **Cifras Inteligentes** | `smart-chords/SmartChordToolbar.tsx` | Barra superior contextual do documento: voltar, título, status de salvamento, toggle `Editar`/`Visualizar`, `Exportar PDF`, `Salvar cifra`, menu `•••`. | O botão `Exportar PDF` e o item `Configurações do PDF` no menu `•••` disparam exatamente o mesmo callback (`onOpenPdfSettings`). |
| **Cifras Inteligentes** | `smart-chords/SmartChordEditor.tsx` | Formulário de metadados (`Título *`, `Artista`, `Tom Original *`), seção colapsável `Vínculo com o repertório` e textarea do conteúdo em colchetes. | Emprega `FloatingInput`, `FloatingSelect`, `FloatingTextarea`. |
| **Cifras Inteligentes** | `smart-chords/SmartChordReader.tsx` | Leitor interativo com transposição, painel colapsável `Aparência da leitura` (espaçamento, fonte, tamanho) e edição inline de acordes célula a célula com sugestões do campo harmônico. | Usa `var(--border)` indefinido em dois estilos inline (linhas 120 e 282). |
| **Cifras Inteligentes** | `smart-chords/SmartChordPdfSettings.tsx` | Modal de configuração do PDF (`Fonte do PDF`, `Tamanho`, `Espaçamento`, `Marcador`) + modal de preview A4 paginado em JPEG. | Separa bem configuração e preview A4 com alerta de `PDF desatualizado`. |
| **Cifras Inteligentes** | `SmartChordImportModal.tsx` | Modal de importação em 4 fontes (`PDF`, `Colar Texto`, `Link / URL`, `Imagem / transcrição`), preview alinhado/editável e vínculo opcional ao repertório. | **Crítico:** mais de 40 estilos inline com cores hardcoded (`#1e293b`, `#0f172a`, `#3b82f6`, `#f8fafc`), quebrando o Modo Claro e a identidade LouvAIO. |
| **Início / Dashboard** | `DashboardView.tsx` | Painel inicial com `Minhas Próximas Escalas`, `Atalhos Rápidos` (7 cards) e `Mural de Avisos`. | Usa ícones multicoloridos (`purple`, `amber`, `cyan`, `rose`, `#A855F7`, `#EC4899`) fora da paleta semântica. |
| **Escalas & Liturgias** | `SchedulesView.tsx`, `ScheduleDetailView.tsx`, `CreateScheduleModal.tsx`, `LiturgiesView.tsx` | Gestão completa de escalas, confirmação de presença, ordem do culto integrada com músicas/tons/links, mural de comentários e modelos de liturgia. | `CreateScheduleModal` possui 4 abas internas (`Informações`, `Liturgia`, `Equipe`, `Músicas`). |
| **Ministério & Billing** | `MinistryView.tsx`, `TeamsView.tsx`, `RolesView.tsx`, `ClassificationsView.tsx`, `AdminsView.tsx`, `TemplatesView.tsx`, `MemberAvailabilityView.tsx`, `AdminAvailabilityView.tsx`, `ManualMemberAvailabilityModal.tsx` | Hub e sub-telas de gestão de pessoas, equipes, funções, classificações e disponibilidade. | Mistura classes CSS globais com estilos inline extensos. |
| **Ministério & Billing** | `SubscriptionPlanView.tsx`, `RestrictedBanner.tsx` | Gestão de assinatura, quotas, preview de checkout Asaas, histórico, cancelamento/reversão, ativação antecipada e banners de restrição (`grace`, `restricted_over_limit`, `suspended`). | `RestrictedBanner` usa fallbacks de texto escuro (`#F5EFE6`, `#A0AAB0`) que precisam respeitar o Modo Claro. |
| **WhatsApp & Compliance** | `WhatsAppFoundationView.tsx`, `WhatsAppCallbackPage.tsx`, `whatsapp/*`, `PrivacyPolicyView.tsx`, `AccountDeletionView.tsx` | Integração WhatsApp Business, política de privacidade e exclusão de conta. | Seguem estrutura de página centralizada (`max-width: 800px`). |
| **Primitivos de UI** | `ui/FloatingInput.tsx`, `FloatingSelect.tsx`, `FloatingTextarea.tsx` | Campos com label flutuante reutilizados nos modais de Música, Versão e Cifrador. | `FloatingSelect` fixa `text-[var(--primary-light)]` no label, que fica com baixo contraste no Modo Claro (`#86A38F` sobre `#FFFFFF` = 2.6:1). |
| **Vocal (M21)** | `VocalExercisePlayer.tsx` | Player de exercícios vocais com piano interativo de 37 teclas (`C3–C6`), tessitura, BPM, metrônomo e acompanhamento. | **Intocável no motor musical e piano** (decisão obrigatória). |

---

## 3. Mapeamento de Tokens CSS, Estilos Inline e Inconsistências

### 3.1 Arquitetura Atual de Tokens (`louvaio-brand.css`, `index.css`, `workspace.css`, `louvaioTheme.ts`, `app_theme.dart`)

1. **Inversão Semântica entre `louvaio-brand.css` e `index.css`:**
   - Em `web/src/styles/louvaio-brand.css`:
     - `--brand-primary: var(--louvaio-green)` (`#0F2A1F`)
     - `--brand-accent: var(--louvaio-terracotta)` (`#B85A3C`)
   - Em `web/src/index.css`:
     - `--primary-brand: var(--louvaio-terracotta)` (`#B85A3C` no claro / `#C96F52` no escuro)
     - `--primary-color: var(--louvaio-terracotta)`
     - `--accent: var(--louvaio-green)` (`#0F2A1F` no claro / `#1C4836` no escuro)
   - **Impacto:** Desenvolvedores e componentes usam `--primary-color` esperando Terracota em botões (`.btn-primary`), enquanto `louvaioTheme.ts` exporta `primary: '#0F2A1F'` (Verde) e `accent: '#B85A3C'` (Terracota).

2. **Variáveis CSS Indefinidas ou Legadas em Uso Ativo:**
   - `var(--bg-color)`: usada em `index.css` nas linhas **219** (`body`), **253** (`.main-content`), **1011** (`.detail-header-card`), **1469** (`.sidebar-group-card`) e **1573** (`.login-page-container`), mas `:root` em `index.css` define apenas `--bg-main` (linha 114), **não** `--bg-color`.
   - `--color-brand-accent: #7C3AED`: roxo legado da época pré-LouvAIO ainda declarado em `index.css` (linha 29) e referenciado em `ArtistCard.tsx` / gradientes.
   - `var(--bg-primary, #161b28)`: usada no `<style>` inline de `SmartChordsWorkspace.tsx` (linha 1188); variável inexistente que cai em azul-escuro legado se `workspace.css` não sobrescrever.
   - `var(--border)`: usada em `SmartChordReader.tsx` (linhas 120 e 282) em vez de `var(--border-color)`.

3. **Cores Hardcoded Fora do Design System (Quebra de Tema Claro/Escuro):**
   - `SmartChordImportModal.tsx`: utiliza `#1e293b`, `#0f172a`, `#334155`, `#f8fafc`, `#94a3b8`, `#3b82f6`, `#60a5fa`, `#38bdf8` diretamente em dezenas de `style={{ ... }}`. No Modo Claro (`#F5EFE6`), o modal exibe caixas azul-marinho escuro com botões azul-elétrico, destoando completamente da paleta Verde/Terracota/Creme.
   - `DashboardView.tsx`: utiliza ícones e fundos hardcoded em roxo (`#A855F7`), rosa (`#EC4899`), ciano (`#06B6D4`) e âmbar (`#F59E0B`).
   - `RestrictedBanner.tsx`: define fallback `color: 'var(--text-primary, #F5EFE6)'` e `color: 'var(--text-secondary, #A0AAB0)'` pensando apenas em fundo escuro.

4. **Divergência de Modo Escuro entre Web e Flutter:**
   - **Web (`index.css` `.dark`):** usa superfícies verdes profundas (`--bg-main: #0B1913`, `--bg-surface: #0F2A1F`, `--surface-sidebar: #08140F`, `--border-color: #1B4534`).
   - **Flutter (`app_theme.dart` `darkTheme`):** usa cinzas neutros (`darkBackground: #121212`, `darkSurface: #1A1A1A`, `darkCard: #242424`) e `primary: #4E9A7B`.
   - **Proposta D1:** Unificar a direção cromática escura com tons escuros esverdeados sóbrios ou neutros aquecidos de alto contraste documentados nos tokens v1.0.

---

## 4. Matriz de Preservação Funcional Obrigatória por Tela

> **Regra de Ouro D1:** Nenhum recurso, campo, validação, atalho ou regra de negócio pode ser removido. Nenhum recurso inexistente pode ser inventado.

### 4.1 Repertório (`/repertorio`, `/repertorio/:songId`, `/repertorio/pastas/:folderId`)

| Sub-tela / Fluxo | Funcionalidades e Campos Obrigatórios a Preservar |
| :--- | :--- |
| **Listagem Principal** | • 3 sub-abas com contadores em tempo real: `Músicas (count)`, `Pastas (count)`, `Artistas (count)`.<br>• Busca textual com debounce de 300ms por `título`, `artista` ou `letra` (`searchQuery`).<br>• `FilterPopover`: seleção de `Tom Original` (12 notas: `C, C#, D, D#, E, F, F#, G, G#, A, A#, B`) + switch `Apenas com YouTube` + botão `Limpar Filtros`.<br>• Indicador visual de filtros ativos no botão de filtro.<br>• Paginação / carregamento incremental (`nextCursor` / `hasMore`) e estados de loading (shimmer), vazio (`empty-state`) e erro.<br>• Botão `+ Música` (`isAdmin`) na aba Músicas e `+ Pasta` (`isAdmin`) na aba Pastas; oculto na aba Artistas. |
| **Detalhe da Música (`SongDetail.tsx`)** | • Navegação `← Voltar para o Repertório` + botões administrativos `Editar` e `Excluir` (`isAdmin`).<br>• **Seletor de Versões Musicais:** exibido quando `versions.length > 1`, alternando imediatamente `key`, `bpm`, `duration`, `notes`, `classificationIds` e `links` da versão selecionada.<br>• **Barra de Cifra Inteligente no Repertório:**<br>  - Alternância de visualização `Cifra Inteligente` vs `Apenas Letra` (quando há cifra pessoal vinculada).<br>  - Seletor de abas quando o usuário possui múltiplas cifras pessoais vinculadas à mesma música.<br>  - Ações contextuais: `Vincular Cifra` / `Vincular Outra Cifra` (abre modal listando as cifras pessoais do usuário), `Abrir no Cifrador` (`/cifras/:id/editar`), `Desvincular` (remove vínculo pessoal no ministério ativo).<br>• **Controles de Transposição:** `-1 Semitom`, `Resetar` (quando `semitones !== 0`), `+1 Semitom`, exibição de `Tom Original` e `Tom Transposto`.<br>• **Renderização Musical Fiel:** acordes ancorados por caractere (`rawToVisual`), blocos de tablatura (`[tab]...[/tab]` com `data-musical-tablature`), linhas de progressão de compassos (`| C | G/B | Am7 | F |` com `data-musical-progression`), respeitando as preferências do usuário (`lineSpacingPx` e `chordFontFamily`).<br>• **Ficha da Versão e Links:** `Tom`, `BPM`, `Duração`, `Classificações`, `Observações da Versão` e tiles de `Links & Arquivos` (`Letra`, `Cifra`, `Áudio`, `Vídeo` + `Links Customizados` com detecção de domínio YouTube, Spotify, Deezer, Apple Music, CifraClub, Google Drive). |
| **Cadastro/Edição de Música e Versões (`CreateSongModal` + `VersionEditModal`)** | • **Dados da Música:** `Título da Música *`, `Artista / Banda`, `Observações Gerais`.<br>• **Gestão de Versões:** lista de versões cadastradas, botão `+ Adicionar Versão`, ações por versão: `Editar`, `Clonar` (cria cópia editável da versão), `Excluir` (permitido quando há mais de 1 versão).<br>• **Campos da Versão (`VersionEditModal`):**<br>  - `Nome da Versão *` (ex.: `Gravação Original`, `Acústico`).<br>  - `Classificações` (seleção múltipla de chips das classificações do ministério).<br>  - `Observações da Versão`.<br>  - `Tom *` (seletor com 30 tonalidades maiores e menores: `C` a `B` e `Cm` a `Bm`).<br>  - `BPM` (numérico).<br>  - `Duração` (3 campos numéricos independentes: `Horas (HH)`, `Minutos (MM)`, `Segundos (SS)`, formatados para `HH:MM:SS`).<br>  - `Links Padrão`: `Letra`, `Cifra`, `Áudio`, `Vídeo` (URLs).<br>  - `Links Customizados`: adição dinâmica (`+ Adicionar Link Customizado`), edição de `Rótulo` e `URL`, e remoção individual. |

### 4.2 Cifras Inteligentes (`SmartChordsWorkspace.tsx` e subcomponentes)

| Sub-tela / Fluxo | Funcionalidades e Campos Obrigatórios a Preservar |
| :--- | :--- |
| **Decisão Obrigatória de Modos** | • **Preservar `Editar` e `Visualizar` como modos estritamente alternativos (`data-workspace-mode="edit"` vs `data-workspace-mode="read"`).**<br>• **PROIBIDO** exibir editor e preview fixos lado a lado simultaneamente. |
| **Biblioteca Pessoal (`SmartChordsLibrary`)** | • Escopo pessoal por `user_id` (isolado de outros membros; vincular ao repertório não compartilha a cifra com terceiros).<br>• Busca por título ou artista, botão `Importar` (`SmartChordImportModal`) e botão `Criar Cifra`.<br>• Listagem de cifras com `title`, `artistName`, `originalKey` e abertura direta no Workspace. |
| **Barra Contextual (`SmartChordToolbar`)** | • Botão `← Biblioteca` (com bloqueio `dirty guard` se houver alterações não salvas).<br>• Título do documento + badge de status (`Salvo`, `Alterações não salvas`, `Salvando…`).<br>• Segmented toggle `Editar` / `Visualizar`.<br>• Ação de PDF (`Configurar / Exportar PDF`), botão primário `Salvar cifra` e menu `•••` (`Configurações do PDF`, `Excluir`). |
| **Modo Editar (`SmartChordEditor`)** | • Campos: `Título *`, `Artista`, `Tom Original *` (24 tonalidades).<br>• Seção colapsável `Vínculo com o repertório`: seletor de música do ministério ativo (`Nenhuma`, `+ Nova Música (Auto-Criar)...` com campo `Título da Nova Música` e checkbox `Auto-criar música no repertório se não existir`, ou música existente).<br>• Textarea `Conteúdo da Cifra (Formato Bracket) *` com suporte a `[Acorde]`, `| Progressão |` e `[tab]...[/tab]`.<br>• Persistência automática de rascunho em `sessionStorage` por `userId + chordId` e proteção contra saída acidental (`beforeunload` + modal de confirmação). |
| **Modo Visualizar (`SmartChordReader`)** | • Cabeçalho de leitura: `Tom Original`, `Tom Atual`, botões de transposição `-`, indicador de semitons, `+` e `Reset`.<br>• Painel colapsável `Aparência da leitura`:<br>  - `Espaçamento entre linhas`: botões `-` / `+` (0px a 24px, passo 2px) + botão `Padrão` (sincronizado na conta do usuário via `preferenceWriter`).<br>  - `Fonte`: seletor (`Monospace`, `Arial`, `Times New Roman`, `Georgia`, `Verdana`, `Courier New`) sincronizado na conta do usuário.<br>  - `Tamanho da Fonte`: slider/controle de `10px` a `24px`.<br>• **Edição Inline de Acordes no Modo Visualizar:** clique em qualquer caractere da letra, linha vazia, botão `➕` de fim de linha ou acorde de progressão abre popover com input de acorde, botão remover e **sugestões automáticas do Campo Harmônico** (`getSuggestions` / `getHarmonicFieldChords`). |
| **Configuração e Preview de PDF (`SmartChordPdfSettings`)** | • Configuração: `Fonte do PDF` (exclusiva do PDF ou herdada da leitura), `Tamanho no PDF` (`10–24px`), `Espaçamento` (`0–24px`), `Marcador (opcional)` (persistido em `localStorage` por usuário).<br>• Preview A4 paginado (`html2pdf`): renderiza páginas A4 reais em JPEG com badge `PDF • N páginas` (ou alerta `PDF desatualizado` quando configurações mudam), botões `Configurações`, `📥 Baixar PDF` e `Fechar`. |
| **Importação de Cifra (`SmartChordImportModal`)** | • 4 abas de origem:<br>  1. `Documento PDF` (upload até 3MB, extração sem escrita no banco).<br>  2. `Colar Texto` (suporte a colagem rica HTML/texto com preservação de alinhamento).<br>  3. `Link / URL` (CifraClub com suporte a captura assistida / colagem manual normalizada quando bloqueado na origem).<br>  4. `Imagem / transcrição` (upload PNG/JPEG/WebP até 5MB com preview da imagem + transcrição manual assistida).<br>• Etapa de `Preview` obrigatória antes de persistir: edição de `Título *`, `Artista`, `Tom Original *`, metadados de origem (`sourceUrl`, `displayedKey`, `capo`), alertas de extração (`warnings`) e alternância entre `Editar Texto` e `Visualização Alinhada`.<br>• Etapa `link_prompt` pós-confirmação: opção de vincular a cifra recém-importada a uma música do repertório do ministério ativo. |

### 4.3 Escalas, Liturgias, Ministério, Assinatura e Vocal M21

| Módulo | Funcionalidades Obrigatórias a Preservar |
| :--- | :--- |
| **Escalas (`/escalas`, `/escalas/:id`)** | • Abas `Próximas` e `Passadas`; cards com data, título, horário, contagem de músicas e membros.<br>• Confirmação de presença do próprio membro escalado (`Confirmado` / `Pendente`).<br>• Ordem do Culto integrada: itens da liturgia e músicas com tom da versão, duração, notas e links diretos.<br>• Mural de comentários da escala com envio e exclusão pelo autor/admin.<br>• Modal `CreateScheduleModal` com 4 abas (`Informações`, `Liturgia` com importação de modelo, `Equipe` com alerta de conflito de indisponibilidade e importação de Equipe Base, `Músicas` com seleção de versão). |
| **Liturgias (`/liturgias`)** | • Listagem de modelos de liturgia do ministério; criação, edição e exclusão (`isAdmin`).<br>• Adição de etapas com `título`, `duração`, `responsável`, `descrição`, flag `Momento de Louvor (Música)` e reordenação (`▲` / `▼`). |
| **Ministério & Assinatura (`/ministerio/*`)** | • Diretório de membros, convites por código (`InviteCodeModal`), entrada por código (`JoinMinistryModal`), criação de ministério (`CreateMinistryModal`).<br>• CRUD de `Equipes`, `Funções`, `Classificações`, `Administradores` e `Modelos`.<br>• `Disponibilidade`: lançamento pessoal (`MemberAvailabilityView`) e visão administrativa consolidada + lançamento manual (`AdminAvailabilityView` + `ManualMemberAvailabilityModal`).<br>• `Assinatura e Plano` (`SubscriptionPlanView` + `RestrictedBanner`): exibição fiel de `SubscriptionService`, ciclo mensal/anual, blocos adicionais (`addonBlocks`), preview de troca (`CheckoutPreviewResult`), transições pendentes (`billing_plan_changes`), ativação antecipada (`EarlyActivationQuoteResponse`), histórico de transações, cancelamento e reversão de cancelamento, e estados `normal`, `grace`, `restricted_over_limit` e `suspended`.<br>• `WhatsApp`: status comercial, capacidade e onboarding (`WhatsAppFoundationView`). |
| **Exercícios Vocais (`/exercicios-vocais` — M21)** | • Acesso sem exigir login (`shouldBootstrapSession` retorna `false` para `vocal`).<br>• Catálogo de exercícios vocais, controle de BPM, metrônomo, direção (`Subindo`/`Descendo`), tessitura (`midiLow`/`midiHigh`), piano de 37 teclas (`C3–C6`) e motor de áudio intocados. |

---

## 5. Matriz de Paridade Web R16 vs. Flutter M20/M21

| Dimensão / Funcionalidade | Web R16 (`29d09f1`) + M21 (`f3aed6cd`) | Flutter Android M20 (`11b5797`) + M21 (`f3aed6cd`) | Diagnóstico e Diretriz de Design D1 |
| :--- | :--- | :--- | :--- |
| **Navegação Principal** | Desktop: Sidebar 6 itens (`Início`, `Repertório`, `Cifras`, `Escalas`, `Liturgias`, `Ministério`).<br>Mobile: BottomNav 5 itens (`Liturgias` ausente da barra). | `NavigationBar` (`<600dp`) / `NavigationRail` (`>=600dp`) com 4 abas (`Início`, `Escalas`, `Repertório`, `Perfil`). `Cifras` e `Liturgias` ficam dentro de `Perfil`. | **Diretriz:** No Web Mobile, manter 5 destinos principais (`Início`, `Escalas`, `Repertório`, `Cifras`, `Ministério`) mas tornar `Liturgias` e `Exercícios Vocais` acessíveis em 1 toque no Hub/Header. No Desktop, limpar a Sidebar mantendo os módulos claros e movendo ações secundárias de ministério para um menu popover discreto estilo Linear. |
| **Paleta Modo Claro** | Creme `#F5EFE6` (`--bg-main`), Branco `#FFFFFF` (`--bg-surface`), Verde `#0F2A1F`, Terracota `#B85A3C`. | Creme `#FAF7F2` (`lightBackground`), Branco `#FFFFFF`, AppBar Verde `#0F2A1F`, Terracota `#B85A3C`. | **Diretriz:** Alinhar fundo principal claro em `#F5EFE6` (ou `#FAF7F2` como superfície elevada sutil) e unificar a hierarquia de botões (Terracota `#B85A3C` para CTA primário de ação, Verde `#0F2A1F` para identidade estrutural/navegação). |
| **Paleta Modo Escuro** | Verde escuro profundo (`#0B1913` / `#0F2A1F` / `#08140F`). | Cinza escuro neutro (`#121212` / `#1A1A1A` / `#242424`) com verde `#4E9A7B`. | **Diretriz:** Documentar no Design System v1.0 os tokens escuros unificados (`#0B1913` fundo principal, `#11231B` superfície, `#172E24` superfície elevada) para que Web e Flutter compartilhem a mesma identidade noturna. |
| **Repertório — Sub-abas e Filtros** | Possui abas `Músicas`, `Pastas`, `Artistas` + filtro por `Tom` (12 notas) e `YouTube`. | Lista de `Músicas` com busca e chips horizontais de `Classificação` (`availableClassifications`). Não exibe abas `Pastas` e `Artistas`. | **Diretriz:** Nos protótipos Web/Mobile do Repertório, combinar a clareza dos chips rápidos de filtro com as 3 abas (`Músicas`, `Pastas`, `Artistas`) e o popover de `Tom`/`YouTube`. |
| **Cifras Inteligentes — Importação** | 4 abas (`PDF`, `Texto`, `URL`, `Imagem` com transcrição manual). | 4 abas (`PDF`, `Texto`, `URL`, `Imagem`) + **Android Share Intent**, **OCR local em imagem** (`ImageOcrService`) e **WebView CifraClub assistida**. | **Diretriz:** Preservar integralmente os fluxos de cada plataforma; corrigir o tema visual do modal Web (`SmartChordImportModal`) para seguir o mesmo padrão limpo do restante do produto. |
| **Cifras Inteligentes — Leitura e Edição** | Workspace único com toggle `Editar` / `Visualizar` e edição inline de acordes no leitor com sugestões de campo harmônico. | `SmartChordReaderScreen` (leitura + PDF preview) separado de `SmartChordFormScreen` (edição com toggle `_showPreview`). | **Diretriz:** Preservar na Web o toggle `Editar` / `Visualizar` na toolbar sem nunca dividir a tela lado a lado, e manter a ergonomia de leitura de palco em ambas as plataformas. |

---

## 6. Revisão de Acessibilidade (WCAG 2.1 AA) e Uso por Pessoas Leigas

### 6.1 Auditoria de Contraste de Cores (Cálculo Real de Luminância Relativa WCAG)

| Par de Cores Auditado | Hex Foreground | Hex Background | Razão de Contraste | Status WCAG AA | Ação Corretiva no Design System v1.0 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Texto Primário (Claro) sobre Creme** | `#1E2421` | `#F5EFE6` | **13.6 : 1** | ✅ AAA | Mantido (`--text-primary` light). |
| **Texto Primário (Claro) sobre Branco** | `#1E2421` | `#FFFFFF` | **15.8 : 1** | ✅ AAA | Mantido. |
| **Verde LouvAIO sobre Creme** | `#0F2A1F` | `#F5EFE6` | **12.5 : 1** | ✅ AAA | Excelente para títulos, navegação ativa e badges estruturais. |
| **Texto Secundário (Claro) sobre Creme** | `#525E58` | `#F5EFE6` | **5.7 : 1** | ✅ AA | Mantido (`--text-secondary` light). |
| **Texto Muted v0.1 (`#7A8680`) sobre Creme (`#F5EFE6`)** | `#7A8680` | `#F5EFE6` | **3.22 : 1** | ❌ **Reprova AA (< 4.5:1)** | **Corrigido no v1.0:** ajustar `--text-tertiary` / `--text-muted` no Modo Claro para **`#5C6862`** (**4.95 : 1** sobre `#F5EFE6` e **5.74 : 1** sobre `#FFFFFF`). |
| **Label Flutuante (`--primary-light: #86A38F`) sobre Branco** | `#86A38F` | `#FFFFFF` | **2.61 : 1** | ❌ **Reprova AA (< 4.5:1)** | **Corrigido no v1.0:** em `FloatingInput`/`FloatingSelect`/`FloatingTextarea`, usar `--brand-primary` (`#0F2A1F`, **14.5:1**) no Modo Claro e `#7CC4A4` (**7.8:1**) no Modo Escuro. |
| **Botão Terracota (`#B85A3C`) com Texto Branco (`#FFFFFF`)** | `#FFFFFF` | `#B85A3C` | **4.52 : 1** | ✅ AA (Limite) | Para garantir margem segura acima de 4.5:1 em qualquer tela e estado hover, ajustar token de botão preenchido para **`#AE5235`** (**5.02 : 1** com `#FFFFFF`) ou manter `#B85A3C` com texto `#FFFFFF` em fonte `>= 14px bold` (AA Large/UI) e `#9E472B` (**6.01 : 1**) no hover. |
| **Terracota no Modo Escuro (`#C96F52`) com Texto Branco (`#FFFFFF`)** | `#FFFFFF` | `#C96F52` | **3.48 : 1** | ❌ **Reprova AA texto normal** | **Corrigido no v1.0:** no Modo Escuro, quando o botão primário usar `#D47A5D` / `#C96F52` como destaque luminoso, ou (a) usar fundo **`#B85A3C`** com texto `#FFFFFF` (**4.52:1**), ou (b) para badges/links e acordes sobre fundo escuro `#0B1913`, usar **`#E08A6E`** sobre `#0B1913` (**6.8 : 1** ✅ AA). |
| **Texto Primário (Escuro) sobre Verde Noturno** | `#F5EFE6` | `#0B1913` | **15.9 : 1** | ✅ AAA | Excelente para leitura de cifras em palco escuro. |
| **Texto Secundário (Escuro) sobre Superfície (`#0F2A1F`)** | `#C7C0B8` | `#0F2A1F` | **8.9 : 1** | ✅ AAA | Excelente legibilidade. |
| **Texto Terciário (Escuro `#8E9B94`) sobre `#0F2A1F`** | `#8E9B94` | `#0F2A1F` | **4.72 : 1** | ✅ AA | Mantido. |

### 6.2 Diretrizes de Acessibilidade e Usabilidade para Pessoas Leigas

1. **Alvos de Toque Mínimos de `44×44px` (WCAG 2.5.5 / Mobile Ergonomics):**
   - Atualmente, os botões de transposição (`-`, `+`, `Reset`) em `SmartChordReader.tsx` possuem `padding: 2px 10px` (~26px de altura), dificultando o toque rápido por músicos no celular ou tablet no altar.
   - **Correção nos Protótipos D1:** Todos os botões de transposição, abas de versão, chips de filtro, ações de linha e botões de modal possuem área clicável mínima de `44×44px` no mobile e `36×36px` no desktop.
2. **Linguagem Clara para Pessoas Leigas (Zero Jargão Técnico):**
   - Substituir rótulos técnicos ou ambíguos na apresentação visual (mantendo a estrutura funcional):
     - Em vez de `"Conteúdo da Cifra (Formato Bracket) *"`, exibir **`"Letra e Acordes"`** com uma barra de ajuda visual simples: *`Dica: coloque os acordes entre colchetes antes da sílaba, ex.: [G]Santo. Use | G | D | para compassos.`*
     - Distinguir claramente os dois botões de PDF na toolbar: um botão direto **`"PDF / Imprimir"`** (que abre o preview A4 com as configurações ao lado) em vez de dois botões separados (`Exportar PDF` e `Configurações do PDF`) que abrem a mesma janela.
     - No seletor de versões do `SongDetail`, exibir claramente **`"Versão da Música:"`** com indicação do tom ao lado do nome da versão (ex.: `Gravação Original (G)`, `Acústico (E)`), facilitando a escolha imediata por voluntários.
3. **Foco Visível por Teclado (`:focus-visible`):**
   - Anel duplo de foco (`outline: 2px solid var(--focus-ring); outline-offset: 2px`) visível tanto no Modo Claro (`#0F2A1F`) quanto no Modo Escuro (`#7CC4A4`).
