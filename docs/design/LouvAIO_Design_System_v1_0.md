# LouvAIO — Design System v1.0 (Proposta Consolidada D1)

- **Status:** Proposta para Aprovação Visual do Proprietário (Etapa D1)
- **Evolução de:** `docs/design/LouvAIO_Design_System_v0_1.md` e ADR `docs/decisions/2026-08-28-louvaio-visual-identity.md`
- **Referências de Engenharia de Interface:**
  - **Linear:** Arquitetura de informação silenciosa, navegação lateral compacta, listas densas com hierarquia tipográfica, bordas estruturais de `1px` e ausência de ruído decorativo.
  - **Planning Center Services & Music Stand:** Controles musicais contextuais (versões, tom original vs. transposto, folha de leitura limpa para palco, recursos e ordem do culto).
  - **LouvAIO Oficial:** Preservação integral da marca **LouvAIO** (sem sufixo "2.0"), Verde Profundo (`#0F2A1F`), Terracota (`#B85A3C`), Creme (`#F5EFE6`), logotipos oficiais e 100% das funcionalidades reais.

---

## 1. Princípios Diretores e Restrições Inegociáveis

1. **Identidade LouvAIO Intacta:** A marca é exclusivamente **LouvAIO**. Nunca adicionar `"2.0"` em títulos, cabeçalhos, rodapés ou documentação.
2. **Zero Estilo Futurista / Zero Ruído Decorativo:**
   - **Proibido:** brilhos neon (`filter: blur(80px)` / `box-shadow: 0 0 12px`), gradientes decorativos multi-cores (`#7C3AED`, `#EC4899`, `#06B6D4`), animações de levitação exageradas em listas (`transform: translateY(-4px)`) e cards inflados apenas para preencher espaço.
   - **Adotado:** superfícies sólidas, contraste tipográfico rigoroso, bordas de `1px solid`, sombras sutis apenas em camadas flutuantes (popovers e modais) e foco imediato na tarefa musical ou administrativa.
3. **Acessibilidade para Pessoas Leigas (WCAG 2.1 AA):**
   - Contraste mínimo de **4.5:1** para todo texto normal (inclusive textos secundários/terciários e labels flutuantes) e **3.0:1** para bordas de controles e componentes gráficos.
   - Alvos de toque de no mínimo **`44×44px`** no mobile e **`36×36px`** no desktop.
   - Rótulos autoexplicativos em português claro (ex.: mostrar o tom junto ao nome da versão `Original (G)`, explicar colchetes `[G]` com exemplo visual).
4. **Fidelidade Funcional e Separação de Modos:**
   - **Cifras Inteligentes:** `Editar` e `Visualizar` permanecem **modos estritamente alternativos** acionados pelo segmented toggle da barra superior. **Nunca** exibir editor e preview fixos lado a lado.
   - **Exercícios Vocais (M21):** O piano interativo de 37 teclas (`C3–C6`) e o motor de áudio Web Audio / PCM permanecem **intocados**.

---

## 2. Tokens Semânticos Unificados (CSS & Flutter)

Esta tabela resolve definitivamente a inversão entre `louvaio-brand.css` e `index.css`, elimina as variáveis quebradas (`--bg-color`, `--bg-primary`, `--border`, `--color-brand-accent: #7C3AED`) e corrige os contrastes reprovados no WCAG AA.

### 2.1 Tokens de Cores — Modo Claro (`:root` / `AppTheme.lightTheme`) e Modo Escuro (`.dark` / `AppTheme.darkTheme`)

| Token Semântico CSS | Equivalente Flutter (`ColorScheme`) | Modo Claro (Light — Padrão) | Modo Escuro (Dark — Palco/Noturno) | Função e Contraste Verificado |
| :--- | :--- | :--- | :--- | :--- |
| `--brand-green` | `brandGreen` | `#0F2A1F` | `#0F2A1F` | Identidade institucional LouvAIO (12.5:1 sobre creme). |
| `--brand-terracotta` | `brandTerracotta` | `#B85A3C` | `#C96F52` | Cor de destaque da marca. |
| `--brand-cream` | `brandCream` | `#F5EFE6` | `#F5EFE6` | Base aquecida institucional. |
| `--bg-app` *(alias: `--bg-main`, `--bg-color`)* | `scaffoldBackgroundColor` | `#F5EFE6` | `#0B1913` | Fundo geral da aplicação. |
| `--bg-surface` *(alias: `--surface-color`)* | `surface` | `#FFFFFF` | `#11231B` | Cards, tabelas, painéis de leitura e modais. |
| `--bg-surface-subtle` *(alias: `--surface-variant`)* | `surfaceContainerLow` | `#EFE8DC` | `#162C22` | Cabeçalhos de tabela, inputs, barras de controle secundárias e hover de linhas. |
| `--bg-surface-elevated` *(alias: `--surface-elevated`)* | `surfaceContainerHigh` | `#FFFFFF` | `#1B362A` | Popovers, dropdowns, menus flutuantes e toasts. |
| `--bg-sidebar` *(alias: `--surface-sidebar`)* | `navigationRailBackground` | `#EAE2D6` | `#08140F` | Navegação lateral discreta (Linear-style). |
| `--text-primary` | `onSurface` | `#18221D` | `#F5EFE6` | Títulos, nomes de músicas, letras de cifras (**14.2:1** Claro / **15.9:1** Escuro). |
| `--text-secondary` | `onSurfaceVariant` | `#46544E` | `#C7C0B8` | Subtítulos, nomes de artistas, metadados (**6.8:1** Claro / **8.9:1** Escuro). |
| `--text-muted` *(alias: `--text-tertiary`)* | `outline` | `#5C6862` | `#8E9B94` | Rótulos auxiliares, contadores, timestamps (**4.95:1** sobre `#F5EFE6` ✅ AA). |
| `--action-primary-bg` *(alias: `--primary-color`)* | `primary` (CTA Button) | `#AE5235` | `#B85A3C` | Botão de ação principal com texto `#FFFFFF` (**5.02:1** Claro / **4.52:1** Escuro ✅ AA). |
| `--action-primary-hover` *(alias: `--primary-hover`)* | `primaryContainer` | `#964328` | `#9E472B` | Hover do botão primário (**6.4:1** com `#FFFFFF`). |
| `--action-primary-subtle` *(alias: `--primary-surface`)* | `secondaryContainer` | `rgba(184, 90, 60, 0.12)` | `rgba(224, 138, 110, 0.16)` | Fundo de abas/chips selecionados e destaque de acorde ativo. |
| `--chord-text` | `chordHighlightColor` | `#9E4427` | `#E69176` | Cor exclusiva dos acordes `[C]` acima da letra (**5.9:1** sobre `#FFFFFF` no Claro / **7.4:1** sobre `#11231B` no Escuro ✅ AA). |
| `--structural-accent` | `secondary` | `#0F2A1F` | `#7CC4A4` | Indicador ativo na navegação, links estruturais e labels de formulário (**14.5:1** Claro / **7.8:1** Escuro ✅ AA). |
| `--border-subtle` *(alias: `--border-color`)* | `dividerColor` | `#DCD3C6` | `#1E3D2F` | Divisórias de listas, bordas de cards e separadores de seção. |
| `--border-strong` | `outlineVariant` | `#B8AEA0` | `#2D5945` | Bordas de campos de formulário (`input`, `select`, `textarea`) garantindo percepção clara. |
| `--focus-ring` | `focusColor` | `#0F2A1F` | `#7CC4A4` | Anel de foco de teclado (`2px solid` com `outline-offset: 2px`). |
| `--status-success-bg` / `--status-success-fg` | `success` | `#E6F4EC` / `#145A3A` | `rgba(43,158,107,0.18)` / `#6EE7B7` | Confirmado em escala, cifra salva, assinatura ativa (**7.1:1**). |
| `--status-warning-bg` / `--status-warning-fg` | `warning` | `#FEF3C7` / `#92400E` | `rgba(217,119,6,0.20)` / `#FCD34D` | Pendente de confirmação, período de graça (`grace`), PDF desatualizado (**6.5:1**). |
| `--status-danger-bg` / `--status-danger-fg` | `error` | `#FEE2E2` / `#991B1B` | `rgba(220,38,38,0.20)` / `#FCA5A5` | Ação destrutiva, conflito de indisponibilidade, suspensão (**7.4:1**). |
| `--status-info-bg` / `--status-info-fg` | `tertiary` | `#E6EFEA` / `#0F2A1F` | `rgba(124,196,164,0.16)` / `#A7F3D0` | Badges informativos (ex.: quantidade de versões, vínculo com repertório). |

---

## 3. Tipografia e Hierarquia Musical

### 3.1 Famílias Tipográficas
- **Interface Geral (`--font-sans`):** `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- **Cifras, Tablaturas e Editor (`--font-chord`):** Respeita a preferência sincronizada do usuário (`monospace`, `'Courier New'`, `'Arial'`, `'Times New Roman'`, `'Georgia'`, `'Verdana'`), usando `'JetBrains Mono', 'Fira Code', 'Courier New', monospace` como base monoespaçada padrão para tablaturas (`[tab]`) e edição em colchetes.
- **Alinhamento Numérico (`font-variant-numeric: tabular-nums`):** Obrigatório em colunas de `BPM`, `Duração (HH:MM:SS)`, `Tom`, contadores de abas (`Músicas (48)`), datas de escalas e valores monetários de planos.

### 3.2 Escala Tipográfica Enxuta

| Token / Nível | Tamanho (`rem` / `px`) | Peso (`font-weight`) | Altura de Linha (`line-height`) | Aplicação Real no LouvAIO |
| :--- | :--- | :--- | :--- | :--- |
| **Page Title (`h1`)** | `1.375rem` (`22px`) | `700` | `1.25` | Título da tela (`Repertório`, `Cifras Inteligentes`, `Escalas`) ou título da música no `SongDetail`. |
| **Section / Modal Title (`h2`)** | `1.125rem` (`18px`) | `600` | `1.3` | Cabeçalhos de modais (`Editar Música`, `Importar Cifra`) e seções principais. |
| **Item Title (`h3`)** | `0.9375rem` (`15px`) | `600` | `1.35` | Título da música na linha da lista, nome do modelo de liturgia ou escala. |
| **Body Default** | `0.875rem` (`14px`) | `400` / `500` | `1.5` | Textos de interface, descrições, comentários, inputs e botões. |
| **Caption / Meta** | `0.75rem` (`12px`) | `500` / `600` | `1.35` | Artista secundário, rótulos de coluna, badges (`Tom: G`, `128 BPM`, `04:35`, `2 versões`). |
| **Chord & Lyric Sheet** | `10px` a `24px` (padrão `15px`–`16px`) | Acorde `700` / Letra `400` | Dinâmico (`lineSpacingPx`: `0px` a `24px`, padrão `6px`) | Folha de leitura musical em `SongDetail` e `SmartChordReader`. |

---

## 4. Grid, Densidade e Arquitetura de Layout

### 4.1 Escala de Espaçamento (Base 4px)
- `--space-1: 4px` (gaps internos de badges)
- `--space-2: 8px` (gaps entre botões, padding de chips)
- `--space-3: 12px` (padding vertical de linhas compactas e inputs)
- `--space-4: 16px` (padding lateral mobile e espaçamento entre blocos)
- `--space-5: 20px` (padding interno de painéis e modais)
- `--space-6: 24px` (padding lateral desktop e separação de colunas)
- `--space-8: 32px` (margem superior/inferior de páginas desktop)

### 4.2 Raios de Borda Contidos (Sóbrios e Profissionais)
- `--radius-xs: 4px` (badges técnicos de Tom e BPM)
- `--radius-sm: 6px` (botões compactos, chips de filtro, inputs)
- `--radius-md: 8px` (cards, listas agrupadas, barra de ferramentas)
- `--radius-lg: 12px` (modais e painéis de leitura de cifra)

### 4.3 Arquitetura do App Shell (Inspiração Linear + Planning Center)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ SIDEBAR DESKTOP (224px fixa)     │ HEADER CONTEXTUAL ENXUTO (56px altura)    │
│ ┌──────────────────────────────┐ │ ┌───────────────────────────────────────┐ │
│ │ [Logo LouvAIO]               │ │ │ Título / Breadcrumb   [Busca] [+ Ação]│ │
│ ├──────────────────────────────┤ │ └───────────────────────────────────────┘ │
│ │ [Igreja Batista ▾] (Admin)   │ ├───────────────────────────────────────────┤
│ ├──────────────────────────────┤ │ ÁREA DE CONTEÚDO (max-width: 1200px)      │
│ │ • Início                     │ │                                           │
│ │ • Escalas                    │ │ • Sub-abas + Filtros rápidos              │
│ │ • Repertório                 │ │ • Lista densa (56px/linha) ou Workspace   │
│ │ • Cifras Inteligentes        │ │                                           │
│ │ • Liturgias                  │ │                                           │
│ │ • Ministério                 │ │                                           │
│ │ • Exercícios Vocais (M21)    │ │                                           │
│ ├──────────────────────────────┤ │                                           │
│ │ [Avatar] Nome   [☼/☾] [Sair] │ │                                           │
│ └──────────────────────────────┘ └───────────────────────────────────────────┘
```

#### Mudanças Estruturais no Shell (Comparado à R16 Atual):
1. **Despoluição da Sidebar Desktop:**
   - **Antes (R16):** A sidebar tinha 260px e empilhava um card grande de usuário com botão vermelho `"Sair da Conta"`, um segundo card `"MINISTÉRIO ATIVO"` com `<select>` e **3 botões largos permanentes** (`Criar Ministério`, `Entrar com Código`, `Gerar Convite`) que empurravam a navegação principal para baixo e competiam com os CTAs das telas.
   - **Proposta D1 (Linear Style):**
     - Topo da sidebar: Logotipo **LouvAIO** + **Seletor de Ministério compacto** (que ao clicar abre um menu popover contendo a troca de ministério e as ações `Gerar Convite`, `Entrar com Código` e `+ Criar Ministério`).
     - Centro da sidebar: Navegação limpa com indicador lateral de `3px` e fundo sutil para o item ativo.
     - Rodapé da sidebar: Linha compacta com Avatar, Nome do usuário, botão de alternância de tema (`Claro`/`Escuro`) e ícone de logout.
2. **Consistência Mobile (Header + BottomNav):**
   - Header mobile sempre preserva a percepção de qual ministério está ativo e oferece busca sem esconder a identidade da tela.
   - `BottomNav` mantém os 5 destinos de alta frequência (`Início`, `Escalas`, `Repertório`, `Cifras`, `Ministério`), com acesso de 1 toque a `Liturgias` e `Exercícios Vocais` tanto no Início quanto no topo do hub Ministério.

---

## 5. Especificação de Componentes Reutilizáveis

1. **Listas de Alta Densidade (`DataRow` / `CompactCard`):**
   - No Desktop, o Repertório deixa de usar uma grade de cards altos (`90px+` com avatares decorativos em gradiente e apenas 3 músicas por linha) e passa a usar uma **Lista Estruturada de Alta Densidade (`56px` por linha)** inspirada no Linear e no Planning Center Services:
     - Colunas alinhadas: `Título & Artista` | `Versões` | `Tom` | `BPM & Duração` | `Classificações` | `Recursos (Cifra Inteligente, YouTube, Áudio, Letra)`.
     - Permite escanear **12 a 15 músicas sem rolar a página** (contra 6 a 9 cards hoje), facilitando a montagem de repertório de culto.
   - No Mobile, cada música é exibida em uma linha compacta de duas camadas (`68px`) com `Título`, `Artista`, badge de `Tom` em destaque à direita, metadados (`BPM`, `Versões`, `Classificação`) e ícones indicadores de recursos disponíveis.
2. **Inputs com Rótulo Sempre Visível (`FormField`):**
   - Substituir o estilo atual de `FloatingSelect`/`FloatingInput` (onde o rótulo fica em cima da linha da borda com fonte `--primary-light` de baixo contraste) por **Rótulo Superior Fixo (`12px`, `font-weight: 600`, `--text-secondary`)** + campo de `40px` (desktop) / `44px` (mobile) com borda `--border-strong`.
   - **Justificativa para pessoas leigas:** rótulos fixos acima do campo nunca colidem com o valor preenchido, são lidos com 100% de clareza em qualquer tamanho de fonte do sistema e evitam truncamento em telas estreitas.
3. **Modais com Cabeçalho e Rodapé Fixos (`StickyModal`):**
   - Cabeçalho fixo (`56px`) com título e botão `✕` (`44×44px`).
   - Corpo rolável organizado em seções visuais claras (ex.: em `CreateSongModal`, separar `1. Dados da Música` e `2. Versões e Links`).
   - Rodapé fixo (`64px`) com botões `Cancelar` (secundário) e `Salvar` (primário Terracota) sempre visíveis sem precisar rolar até o fim do modal.
4. **Estados Padronizados (`Loading`, `Empty`, `Error`, `Restricted`):**
   - **Loading:** Skeletons discretos na mesma geometria exata das linhas da lista (`56px`), sem brilhos agressivos.
   - **Empty:** Caixa sóbria com borda tracejada `--border-subtle`, ícone monocromático, explicação curta em português simples e botão de ação direto.
   - **Error:** Banner semântico `--status-danger-bg` com mensagem clara e botão `Tentar novamente`.
   - **Restricted (`RestrictedBanner`):** Compatível com Modo Claro e Modo Escuro usando tokens semânticos (`--status-warning-*` para `grace` e `--status-danger-*` para `restricted_over_limit`/`suspended`).
