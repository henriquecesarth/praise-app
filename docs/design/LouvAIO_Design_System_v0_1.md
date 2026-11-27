# LouvAIO — Direção de Produto e Design System v0.1

**Status:** proposta inicial para validação; não implementada  
**Data:** 06/11/2026  
**Base examinada:** 20 capturas de tela fornecidas pelo proprietário e código Web R16 (`29d09f1b2cf1d94aa8f5e84d77f906a6a88ae6f8`) via GitHub.  
**Nota de escopo:** análise direcionada do frontend, não é auditoria integral de UX; Flutter/M21 não foi inspecionado diretamente em código. Nenhuma alteração foi realizada nos repositórios, ambientes ou deployments.

## 1. Visão de produto

LouvAIO é uma plataforma de organização ministerial e prática musical. O design deve ter a clareza, densidade controlada e estabilidade de um produto SaaS maduro, sem perder o acolhimento necessário a usuários leigos. Inspirações de princípios: Linear (informação, navegação, tipografia e ferramentas contextuais) e Planning Center/Music Stand (fluxos de repertório, leitura musical e execução prática). A identidade, conteúdo, fluxos e componentes devem permanecer originais do LouvAIO, não uma cópia visual das referências.

### Objetivos
- Diminuir a competição visual entre menus, painéis, botões e caixas.
- Tornar evidente a ação principal de cada tela sem esconder ferramentas importantes.
- Facilitar leitura, ensaios, gerenciamento de voluntários e trabalho com música.
- Criar consistência entre Web, PWA, Android e, futuramente, iOS.
- Modernizar sem alterar lógica de negócio, contratos API, RBAC, estado de salvar, PDFs ou mecanismos de áudio.

### Decisões preservadas (não negociáveis nesta etapa)
1. Nome **LouvAIO**, nunca acrescentar “2.0” ao logotipo ou às interfaces.
2. Preservar os verdes atuais, creme e terracota como assinatura da marca; não substituir por gradientes neon ou identidades genéricas.
3. Em Cifras Inteligentes: **Editar** e **Visualizar** são modos alternativos; NÃO recriar editor e preview permanentes lado a lado.
4. Preservar leitura de cifras, alinhamento musical, transposição, fonte, espaçamento, importação, vínculo ao repertório, exportação/preview PDF e estados de salvamento.
5. Preservar versões de músicas (nome, classificação, observações, tom, BPM, duração, letras e links), escalas (participantes, músicas, roteiro, vestimentas, visibilidade e confirmação), liturgias, permissões e gestão de ministérios.
6. O motor de piano FreePats KW no M21 foi homologado em Web e Android; redesign deve alterar somente apresentação, não DSP/áudio.
7. Nenhum trabalho neste documento autoriza editar Production, Firebase, PRs #21/#22/#23, ou sobrescrever workspaces WIP.

## 2. Inventário do frontend existente (amostra verificável)

| Área | Componente/rota confirmada | Implicação de design |
|---|---|---|
| Shell e navegação | `App.tsx`, `Header.tsx`, `BottomNav.tsx`, `routing.ts` | Revisar navegação e hierarquia com preservação de deep links, títulos e estados |
| Tokens e marca | `index.css`, `theme/louvaioTheme.ts` | Migrar uso visual para tokens sem mudar o branding |
| Painel | `DashboardView.tsx` | Substituir excesso de painéis igualmente destacados por seções de prioridade distinta |
| Repertório | `SongDetail.tsx`, `SongFormModal.tsx`, `CreateSongModal.tsx`, `VersionEditModal.tsx` | Melhorar listas, detalhes e edição de músicas/versões sem perda de campos |
| Cifras | `SmartChordsWorkspace.tsx`, `smart-chords/SmartChordsLibrary.tsx`, `SmartChordToolbar.tsx`, `workspace.css` | Manter biblioteca, editor e leitor como contextos próprios, ferramentas contextuais |
| Importação | `SmartChordImportModal.tsx` | Preservar fontes PDF/texto/URL/imagem, extração, preview, avisos e vínculos |
| Escalas | `CreateScheduleModal.tsx` | Evoluir formulário multietapa e rolagens internas preservando dados |
| Mobile Web | `BottomNav.tsx` | Revisar limite de itens e acesso consistente a módulos menos frequentes |

**Atenção:** o inventário completo de componentes de todas as seções e do Flutter deve ser fechado no próximo gate somente-leitura. Não se deve declarar que o aplicativo inteiro está auditado.

## 3. Identidade e tokens — manter o DNA atual

Valores identificados no frontend R16:

| Token existente | Valor | Uso proposto |
|---|---|---|
| Verde principal | `#0F2A1F` | Marca, áreas estruturais, interações selecionadas |
| Verde escuro | `#0A1E16` | Superfícies de navegação profunda |
| Fundo dark | `#0B1913` | Base escura do aplicativo |
| Sidebar dark | `#08140F` | Navegação lateral |
| Terracota | `#B85A3C` | Acento de marca e ação principal pontual |
| Terracota dark atual | `#C96F52` | Acento em tema escuro |
| Creme | `#F5EFE6` | Fundos e textos claros da identidade |
| Texto escuro | `#121212` | Texto principal no claro |

**Regra nova:** cores de superfície organizam a informação; verde identifica o aplicativo e ações selecionadas; terracota não deve colorir indiscriminadamente toda aba ativa, botão e destaque. Estado de sucesso/alerta/erro tem cor semântica distinta. Os tokens existentes devem permanecer a fonte inicial, com ajustes de contraste a validar (WCAG AA). Não fixar novos hexadecimais arbitrariamente antes de aferir contraste e aprovar protótipo.

**Tipografia:** o código já carrega **Inter** e **Outfit**. Usar Inter como tipografia principal de produto (conteúdo, tabelas, campos, labels). Aplicar Outfit somente se houver um uso distintivo comprovadamente consistente, evitando duas famílias competindo na mesma tela. Cifras/tablaturas preservam tipografia especial ou monoespaçada escolhida pelo usuário — a fonte do aplicativo não pode alterar o motor de alinhamento de acordes.

**Espaçamento:** escala de 4 px (4/8/12/16/24/32/48), com espaçamento maior entre seções que entre itens relacionados. Evitar bordas múltiplas e cards aninhados. Raio de referência: 8 px para controles, 12 px para cards, 16 px apenas para superfícies destacadas. Sombras discretas, concentradas em elevação funcional (menus, dialogs), não em todas as caixas.

## 4. Padrões de interface propostos

### Desktop Web
- Sidebar compacta, fixa e menos chamativa que o conteúdo; nome do ministério acessível no topo; perfil e saída em menu próprio.
- Header da página alinhado à esquerda com título, contexto/breadcrumb e única ação principal clara. Não duplicar títulos centralizados no topo e títulos grandes no conteúdo.
- Ferramentas de busca, filtros e ações em uma faixa organizada logo acima de listas; não transformar cada registro em card grande por padrão.
- Tabelas/listas como padrão para repertório, cifras e escalas quando há múltiplos registros; cards reservados para resumo/destaque ou estados vazios.
- Estado vazio compacto e específico: uma frase objetiva e uma ação real; não ocupar centenas de pixels sem necessidade.

### Editor, leitura e PDF de cifras
- Biblioteca é contexto de pesquisa/seleção; abertura da cifra usa toolbar contextual e título com estado `Salvo`, `Alterações não salvas` ou `Salvando`.
- Botão alternável **Editar / Visualizar** permanece. Não criar preview simultâneo obrigatório.
- Leitura prioriza texto e cifras com alto contraste, fonte e espaçamento acessíveis; controles avançados e de PDF em grupo contextual.
- Configurações PDF e pré-visualização preservadas, com modal focado, cabeçalho claro e ação explícita de baixar.
- Todos os layouts preservam a semântica do texto bracket, transposição, preferências por usuário e vínculo ao repertório.

### Repertório e versões
- Primeira tela: busca, abas Músicas/Pastas/Artistas, filtros, lista simples e botão Nova música.
- Detalhes: título, artista, versão ativa, tom, recursos e vínculo com cifra. Alternar versões sem perder contexto.
- Formulário de música/versão com campos agrupados por propósito; caso o formulário exceda a altura, usar página ou dialog amplo com rodapé persistente e sem rolagens aninhadas desnecessárias.
- Manter todos os campos e links de referência, classificações e operações (criar, editar, duplicar, remover versão).

### Escalas e liturgias
- Edição complexa: fluxo por etapas (Detalhes, Participantes, Músicas, Roteiro), progresso visível e dados preservados ao navegar entre etapas.
- Campos avançados como vestimenta/paleta e modelos de roteiro devem permanecer acessíveis.
- Controles de visibilidade e confirmação claramente rotulados; nunca ocultar consequências importantes.
- Listas de escalas separadas por próximas/anteriores, mas usar rótulos e controles visuais coesos com o restante do app.

### Aquecimento Vocal M21
- Iniciante: abrir exercício, entender objetivo, iniciar piano em poucos toques. Mostrar progresso e controles de play/pause/stop.
- Avançado (recolhido por padrão): BPM numérico, metronomo, tessitura, transposição, repetições/direção.
- Não alterar motor musical, assets aprovados, lógica de sincronismo ou suporte offline.

### Mobile
- Barra inferior só para destinos prioritários; módulos restantes em menu de mais se necessário, sem criar rotas inexistentes.
- Priorizar conteúdo e controles de toque de 44×44 px no mínimo; gestos não podem ser o único caminho para função essencial.
- Evitar formulários gigantes com scroll duplo e ações importantes fora de alcance.
- Refletir hierarquia da Web, mas adaptar layout ao toque em vez de copiar colunas.

## 5. O que **não** repetir

- Adicionar “2.0” à marca.
- Gradientes, brilho, vidro, glow, sombras grandes e outras decorações sem função.
- Editor e leitor de cifras permanentes lado a lado.
- Substituir toda lista por cards inflados.
- Usar verde em toda superfície ou terracota em toda ação.
- Abas/ações duplicadas, modais com múltiplos scrolls e cabeçalhos redundantes.
- Simplificar removendo recursos reais ou inventando novos recursos como progresso gamificado, painel de IA, player de áudio de cifra inexistente, etc.
- Aprovar só por mockup bonito sem mapear tela original e checklist de paridade funcional.

## 6. Qualidade e critérios de aprovação

**Para cada tela do redesign**, produzir: (a) screenshot atual, (b) inventário de todos os controles/estados, (c) proposta visual Web desktop e mobile, (d) tabela de preservação de funções/ações, (e) explicação concreta do que veio dos princípios Linear e Planning Center, (f) checklist de acessibilidade, (g) aprovação do proprietário antes de implementar.

Avaliar no mínimo: contraste AA, teclado e foco, labels/erros, tipografia ≥14 px para conteúdo principal quando viável, densidade apropriada, estado vazio/loading/erro, viewport estreita, scroll, dados longos, modo claro e escuro. Nenhum protótipo autoriza mexer em contratos de API, RBAC, salvamento, produção ou dados.

## 7. Etapas de execução propostas

**D0 — Inventário visual (somente leitura):** completar rastreio de rotas, componentes, modais e tokens da Web R16 e de Flutter/M21; usar as capturas atuais sem reproduzir screenshots de usuários identificáveis em materiais públicos.

**D1 — Design System v1:** documentar tokens aprovados, componentes (botões, inputs, tab, lista, sidebar, toolbar, modais), templates responsivos e regras de acessibilidade. Deve ser um conjunto de especificações verificáveis, não somente imagens.

**D2 — Prototipagem:** começando por Repertório (lista, detalhe, edição/versões) e Cifras (biblioteca, editar, visualizar, PDF), apresentar protótipos reais de desktop/mobile com preservação de fluxos. A seguir Painel, Escalas, Liturgias, Ministério e Aquecimento Vocal.

**D3 — Implementação incremental:** somente após aprovação explícita, em worktree isolado, com testes de regressão funcionais, Web/Flutter e checks de acessibilidade; sem deploy até autorização.

## 8. Referências verificadas no código

- [`web/src/index.css`](https://github.com/henriquecesarth/praise-app/blob/29d09f1/web/src/index.css) — tokens reais e padrões CSS.
- [`web/src/theme/louvaioTheme.ts`](https://github.com/henriquecesarth/praise-app/blob/29d09f1/web/src/theme/louvaioTheme.ts) — cores e assets de marca.
- [`web/src/routing.ts`](https://github.com/henriquecesarth/praise-app/blob/29d09f1/web/src/routing.ts) — rotas.
- [`web/src/components/SmartChordsWorkspace.tsx`](https://github.com/henriquecesarth/praise-app/blob/29d09f1/web/src/components/SmartChordsWorkspace.tsx) — orquestração de cifra.
- [`web/src/components/smart-chords/SmartChordToolbar.tsx`](https://github.com/henriquecesarth/praise-app/blob/29d09f1/web/src/components/smart-chords/SmartChordToolbar.tsx) — alternância Editar/Visualizar e ações.
- [`web/src/components/CreateSongModal.tsx`](https://github.com/henriquecesarth/praise-app/blob/29d09f1/web/src/components/CreateSongModal.tsx) e [`VersionEditModal.tsx`](https://github.com/henriquecesarth/praise-app/blob/29d09f1/web/src/components/VersionEditModal.tsx) — versões de músicas.
- [`web/src/components/CreateScheduleModal.tsx`](https://github.com/henriquecesarth/praise-app/blob/29d09f1/web/src/components/CreateScheduleModal.tsx) — etapas da escala.

---

**Próxima decisão:** aprovar direção e regras (não implementar ainda). O mockup deve ser elaborado com base no inventário real, preferencialmente primeiro Repertório e Cifras; proprietário pode solicitar mudanças antes de abrir qualquer tarefa de código.
