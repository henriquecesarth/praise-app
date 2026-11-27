# LouvAIO — Especificação Detalhada e Comparação Antes vs. Depois: Repertório e Cifras Inteligentes

- **Status:** Entregável Oficial D1 (Protótipos Desktop & Mobile + Justificativa de Alterações)
- **Protótipos Visuais Interativos (HTML/CSS):**
  - `docs/design/prototypes/repertorio-desktop-mobile.html`
  - `docs/design/prototypes/cifras-inteligentes-desktop-mobile.html`

---

## 1. Fluxo 1: Repertório (`/repertorio`, `/repertorio/:songId`, `/repertorio/pastas/:folderId`)

### 1.1 Arquitetura da Tela de Listagem (`Músicas`, `Pastas`, `Artistas`)

#### Especificação Desktop (`>= 1024px`)
- **Barra de Topo do Módulo (`Repertório`):**
  - Esquerda: Título `Repertório` + Segmented Tabs compactas: `Músicas (48)`, `Pastas (6)`, `Artistas (19)`.
  - Direita: Campo de busca rápida (`Buscar por título, artista ou trecho da letra...`, debounce 300ms) + Botão `Filtros` (abre `FilterPopover` com `Tom Original` 12 notas e switch `Apenas com YouTube`, exibindo contador de filtros ativos) + CTA primário `+ Nova Música` (ou `+ Nova Pasta` na aba Pastas, visível para `isAdmin`).
- **Linha de Chips de Filtro Ativo / Classificação:**
  - Abaixo da barra de topo, exibe chips clicáveis rápidos para filtrar ou limpar filtros ativos (`Tom: G ✕`, `Com YouTube ✕`) inspirados na agilidade do Flutter `RepertoireView`.
- **Tabela/Lista de Alta Densidade (Linear + Planning Center Style):**
  - Substitui os cards grandes com avatar decorativo em gradiente por linhas estruturadas de `56px` de altura:
    1. **Música & Artista (`minmax(240px, 2fr)`):** Título em `15px semibold` (`--text-primary`) + Artista em `13px` (`--text-secondary`).
    2. **Versões (`110px`):** Badge indicando `1 versão` ou `2 versões` (com tooltip dos nomes das versões, ex.: `Original, Acústico`).
    3. **Tom (`80px`, `tabular-nums`):** Badge estrutural de alto contraste (`Tom: G`). Se houver mais de uma versão com tons distintos, exibe `G / E`.
    4. **Andamento & Duração (`130px`, `tabular-nums`):** `72 BPM • 05:12`.
    5. **Classificações (`160px`):** Chips discretos (`Adoração`, `Ceia`).
    6. **Recursos (`120px`, alinhado à direita):** Indicadores diretos de disponibilidade: badge `Cifra` (quando há Cifra Inteligente vinculada pelo usuário), ícones com tooltip para `YouTube`, `Áudio`, `Cifra Externa` e `Letra`.

#### Especificação Mobile (`< 768px`)
- **Cabeçalho + Sub-abas + Busca Fixa:**
  - Título `Repertório` com badge do ministério ativo no topo + botão `+ Música` (`44×44px`).
  - Segmented control de largura total (`Músicas 48` | `Pastas 6` | `Artistas 19`).
  - Barra de busca (`44px` de altura) integrada ao botão de `Filtro` (`44×44px`).
- **Lista Mobile Escaneável:**
  - Linhas compactas de `68px` (sem avatar decorativo que desperdiça 52px de largura horizontal na tela do celular):
    - Linha superior: `Título da Música` (`15px semibold`, truncamento limpo) + Badge de `Tom` (`G`) fixo à direita.
    - Linha inferior: `Artista` • `72 BPM` • `2 versões` • Ícones de recursos (`Cifra Inteligente`, `YouTube`, `Spotify`).

---

### 1.2 Arquitetura do Detalhe da Música (`SongDetail.tsx`)

#### Problema Atual na Web R16:
- O cabeçalho usa um card com gradiente e blur decorativo (`.detail-header-card::after { filter: blur(100px) }`).
- As barras de controle de **Versão**, **Cifra Inteligente** (`Cifra Inteligente` / `Apenas Letra` / `Vincular` / `Abrir no Cifrador` / `Desvincular`) e **Transposição** (`-1 Semitom` / `+1 Semitom`) ficam fragmentadas em múltiplos blocos com espaçamentos irregulares.

#### Proposta D1 (Planning Center / Music Stand Style):
1. **Cabeçalho Enxuto de Palco:**
   - Breadcrumb `← Repertório` + `Título da Música` (`22px bold`) + `Artista` (`14px secondary`) + botões administrativos `Editar Música` e `Excluir` (`isAdmin`).
2. **Barra Contextual Unificada de Versão e Cifra (Music Stand Bar):**
   - **Faixa 1 — Seletor de Versão Musical:** Abas com nome e tom da versão: `[ Gravação Original (G) ]` `[ Acústico Jovem (E) ]`. Ao alternar a versão, atualiza instantaneamente a ficha técnica e os links daquela versão.
   - **Faixa 2 — Barra de Leitura e Cifra Inteligente:**
     - Segmented toggle: `[ Cifra Inteligente ]` vs `[ Apenas Letra ]`.
     - Se houver múltiplas cifras pessoais vinculadas à música: seletor de abas da cifra pessoal (`Minha Cifra Violão (G)` | `Arranjo Base (G)`).
     - **Controles de Transposição com Alvo de `40px–44px`:** `[ −1 ]` **`Tom: A (+2)`** *(Original: G)* `[ +1 ]` `[ Resetar ]`.
     - **Ações de Vínculo Pessoal:** `[ Vincular Outra Cifra ]`, `[ Abrir no Cifrador ↗ ]`, `[ Desvincular ]`.
3. **Layout em Duas Colunas Assimétricas no Desktop (`2.2fr` Folha Musical / `1fr` Ficha & Links) e Abas/Seções Empilhadas no Mobile:**
   - **Coluna Principal — Folha de Leitura Musical:**
     - Fundo branco puro (`#FFFFFF`) no Modo Claro e verde-noturno profundo (`#11231B`) no Modo Escuro.
     - Acordes ancorados por caractere (`rawToVisual`) em destaque terracota (`#9E4427` Claro / `#E69176` Escuro), blocos de tablatura `[tab]` em caixa monoespaçada com borda lateral e progressão de compassos `| G | D/F# | Em7 | C9 |`.
   - **Coluna Lateral Direita (Desktop) / Painel Inferior (Mobile) — Ficha da Versão & Recursos:**
     - **Ficha Técnica da Versão Ativa:** Grid tabular com `Tom da Versão`, `BPM`, `Duração (HH:MM:SS)`, `Classificações` e `Observações da Versão`.
     - **Links e Arquivos da Versão:** Lista estruturada com ícone semântico, rótulo, plataforma detectada (`YouTube`, `Spotify`, `CifraClub`, `Google Drive`, `Link Customizado`) e ação de abertura em nova aba.

---

### 1.3 Arquitetura de Cadastro e Edição de Música e Versões (`CreateSongModal` + `VersionEditModal`)

#### Problema Atual na Web R16:
- `CreateSongModal` e `VersionEditModal` abrem como dois modais sobrepostos (`z-index: 1000` e `z-index: 1050`), usando `FloatingInput`/`FloatingSelect` com labels que têm contraste `2.61:1` no Modo Claro e campos longos que exigem muita rolagem.

#### Proposta D1:
- **Modal Estruturado com Cabeçalho e Rodapé Fixos (`Sticky Header & Sticky Footer`):**
  - Labels superiores fixos de alto contraste (`#46544E` Claro / `#C7C0B8` Escuro).
  - **Bloco 1 — Dados Gerais da Música:** `Título da Música *`, `Artista / Banda`, `Observações Gerais`.
  - **Bloco 2 — Versões da Música:** Lista clara de versões com badges (`Principal`, `Tom`, `BPM`, `Qtd. Links`) e botões explícitos `+ Adicionar Versão`, `Editar`, `Clonar`, `Excluir`.
  - **Painel/Sub-modal de Edição de Versão (`VersionEditModal`):**
    - Agrupado em 3 sub-blocos claros para leigos:
      1. **Identificação e Andamento:** `Nome da Versão *`, `Tom *` (30 opções maiores/menores), `BPM`, `Duração` (`HH` : `MM` : `SS`).
      2. **Classificações e Observações:** Chips selecionáveis de `Classificações` + `Observações da Versão`.
      3. **Links da Versão:** 4 campos padrão (`Letra`, `Cifra`, `Áudio`, `Vídeo`) + lista dinâmica de `Links Customizados` (`Rótulo` + `URL` + botão `+ Adicionar Link Customizado`).

---

## 2. Fluxo 2: Cifras Inteligentes (`/cifras`, `/cifras/nova`, `/cifras/:id/editar`)

### 2.1 Regra Obrigatória de Alternância de Modos (`Editar` vs `Visualizar`)
- Em conformidade estrita com a decisão do proprietário e o contrato real do componente `SmartChordsWorkspace.tsx` (`data-workspace-mode="edit" | "read"`):
  - **O modo `Editar` e o modo `Visualizar` NUNCA aparecem lado a lado.**
  - O usuário alterna entre `Editar` e `Visualizar` pelo segmented toggle centralizado na barra superior do documento (`SmartChordToolbar`).

### 2.2 Biblioteca Pessoal (`SmartChordsLibrary`)
- **Banner Informativo Sutil para Pessoas Leigas:** Explica com clareza a regra de negócio do produto: *"Suas cifras inteligentes são pessoais. Quando você vincula uma cifra a uma música do repertório, ela fica acessível na sua leitura sem alterar as cifras dos outros integrantes."*
- **Barra de Ações:** Busca por título ou artista + botão secundário `Importar Cifra` (abre `SmartChordImportModal`) + botão primário `+ Criar Cifra`.
- **Lista/Grade de Cifras Pessoais:**
  - Exibe `Título`, `Artista`, badge de `Tom Original`, badge de `Vínculo com Repertório` (ex.: `Vinculada ao Repertório` ou `Apenas pessoal`) e ações rápidas (`Abrir Leitura`, `Editar`).

### 2.3 Barra Contextual do Documento (`SmartChordToolbar`)
- **Organização Enxuta:**
  - Esquerda: Botão `← Biblioteca` + Título da cifra + Badge de status (`● Salvo` em verde semântico ou `● Alterações não salvas` em âmbar).
  - Centro: **Segmented Toggle Obrigatório:** `[ ✎ Editar ]` `[ 👁 Visualizar ]` (com altura de `38px` no desktop e `44px` no mobile).
  - Direita: Botão `PDF / Imprimir` (unificando a abertura do modal de preview/configuração de PDF sem duplicar a ação), botão primário `Salvar Cifra` e menu `•••` (`Excluir cifra`).

### 2.4 Modo Editar (`SmartChordEditor` — `data-workspace-mode="edit"`)
- **Metadados em Linha Única no Desktop (3 colunas) / Empilhados no Mobile:**
  - `Título da Cifra *` | `Artista` | `Tom Original *` (24 tonalidades).
- **Seção Colapsável `Vínculo com o Repertório do Ministério`:**
  - Mostra claramente se a cifra já está vinculada a uma música do ministério ativo.
  - Permite selecionar `Nenhuma`, `+ Nova Música (Auto-Criar)...` (exibindo `Título da Nova Música` e checkbox `Auto-criar música no repertório se não existir`) ou qualquer música existente do repertório.
- **Área de Edição da Cifra (`Letra e Acordes`):**
  - Barra de ajuda amigável para leigos logo acima do editor:
    - Exemplos clicáveis/visuais: `Acorde na sílaba: [G]Santo` • `Compassos: | G | D/F# | Em |` • `Tablatura: [tab] ... [/tab]`.
  - Textarea monoespaçado amplo, confortável, com contraste `15.8:1` no Modo Claro e `15.9:1` no Modo Escuro, e aviso de recuperação de rascunho (`sessionStorage`) quando aplicável.

### 2.5 Modo Visualizar (`SmartChordReader` — `data-workspace-mode="read"`)
- **Barra de Palco Fixa (Sticky Reader Bar):**
  - Esquerda: `Tom Original: G` → **`Tom Atual: A (+2)`** com botões `[ − ]` `[ + ]` `[ Resetar ]` de `44×44px` para toque seguro em palco.
  - Direita: Botão toggle `[ Aa Aparência da Leitura ▾ ]` + dica discreta `"Toque em qualquer letra ou acorde para ajustar acordes"`.
- **Painel Colapsável `Aparência da Leitura`:**
  - Três controles alinhados horizontalmente no desktop e empilhados no mobile:
    1. **Espaçamento entre linhas:** `[ − ]` `8 px` `[ + ]` `[ Padrão ]` (`0px` a `24px`, passo `2px`, salvo na preferência do usuário).
    2. **Fonte da cifra:** Seletor (`Monospace`, `Arial`, `Times New Roman`, `Georgia`, `Verdana`, `Courier New`).
    3. **Tamanho do texto:** Slider e botões `A−` / `A+` (`10px` a `24px`).
- **Folha de Cifra Interativa com Sugestões do Campo Harmônico:**
  - Exibe os acordes posicionados exatamente sobre cada sílaba (`rawToVisual`), progressões de compasso e tablaturas.
  - Ao clicar/tocar em qualquer sílaba, acorde existente ou no botão `+` ao final da linha, abre um **Popover Contextual Limpo** com:
    - Campo de acorde (`Ex.: Am7, G/B`) + botões `Salvar` e `Remover`.
    - **Chips do Campo Harmônico do Tom Atual** (`getSuggestions` / `getHarmonicFieldChords`, ex. em Sol Maior: `G`, `Am`, `Bm`, `C`, `D`, `Em`, `F#m7(b5)`), permitindo inserir ou trocar acordes com 1 toque sem precisar digitar colchetes no modo de leitura.

### 2.6 Configuração e Preview A4 de PDF (`SmartChordPdfSettings`)
- Mantém os 4 controles reais (`Fonte do PDF`, `Tamanho no PDF`, `Espaçamento`, `Marcador opcional`) e a pré-visualização paginada A4 em JPEG com badge `PDF • N páginas` (ou `PDF desatualizado` quando algum parâmetro é alterado), com botões claros `Atualizar Preview`, `📥 Baixar PDF` e `Fechar`.

### 2.7 Modal de Importação (`SmartChordImportModal`)
- **Correção Crítica de Identidade Visual e Acessibilidade:**
  - Remove integralmente os mais de 40 estilos inline azul-marinho/slate (`#1e293b`, `#0f172a`, `#3b82f6`) que quebravam o Modo Claro.
  - Aplica os tokens oficiais do Design System v1.0 (`--bg-surface`, `--bg-surface-subtle`, `--border-subtle`, `--action-primary-bg`, `--text-primary`) às 4 abas (`Documento PDF` até 3MB, `Colar Texto`, `Link / URL` CifraClub com captura assistida, `Imagem / transcrição` até 5MB), à etapa de `Preview` (`Editar Texto` vs `Visualização Alinhada` + alertas de extração + metadados de capotraste/tom exibido) e ao prompt final de vínculo opcional com o repertório.

---

## 3. Tabela Comparativa: Experiência Atual (R16) vs. Proposta D1 e Justificativas

| Ponto da Interface | Experiência Atual (Web R16 `29d09f1`) | Proposta de Redesign D1 | Justificativa Técnica, Musical e de Usabilidade |
| :--- | :--- | :--- | :--- |
| **1. Navegação Lateral (Sidebar Desktop)** | 260px com card grande de usuário, card de ministério e 3 botões largos permanentes (`Criar Ministério`, `Entrar com Código`, `Gerar Convite`) acima da navegação. | Sidebar de 224px estilo Linear: seletor de ministério compacto no topo (ações de criar/entrar/convidar em popover), lista de módulos no centro e perfil compacto no rodapé. | Reduz a poluição visual permanente e libera foco para os módulos diários (`Repertório`, `Cifras`, `Escalas`), mantendo 100% das ações de ministério a 1 clique no seletor superior. |
| **2. Densidade da Lista de Repertório (Desktop)** | Grade de cards de `90px+` com avatar em gradiente e efeito `translateY(-4px)`. Exibe apenas 6 a 9 músicas por tela. | Lista estruturada estilo Linear / Planning Center (`56px` por linha) com colunas alinhadas (`Música/Artista`, `Versões`, `Tom`, `BPM/Duração`, `Classificações`, `Recursos`). | Líderes de louvor precisam comparar tons, BPM e versões de dezenas de músicas rapidamente ao montar uma escala. A lista densa dobra a capacidade de leitura sem rolagem. |
| **3. Cards de Repertório no Mobile** | Card com avatar quadrado de 42px à esquerda que comprime o título da música e os chips em telas de 360px–390px. | Linha mobile compacta sem avatar decorativo: título completo à esquerda, badge de `Tom` em destaque à direita e linha inferior com artista, BPM, versões e ícones de mídia. | Em celulares, o músico precisa ler o nome inteiro da música e o **Tom** imediatamente. Remover o ícone genérico ganha +54px de largura útil para o título. |
| **4. Controles de Versão e Cifra no `SongDetail`** | Controles espalhados entre o card de cabeçalho com blur, uma linha de botões de versão, uma caixa de botões da cifra e outra linha de transposição. | **Music Stand Bar** unificada em duas faixas claras: (1) Versão da Música com tom (`Original (G)`, `Acústico (E)`) e (2) Leitura (`Cifra Inteligente` vs `Apenas Letra`, transposição `-1 / +1` com alvo de `44px` e ações de vínculo). | Segue o padrão do Planning Center Music Stand: todos os controles que afetam o que o músico vê no palco ficam agrupados no topo da folha musical, com botões fáceis de tocar. |
| **5. Alternância `Editar` / `Visualizar` no Cifrador** | Segmented toggle na `SmartChordToolbar` (`data-workspace-mode="edit" \| "read"`), mas com estilos duplicados entre `<style>` inline em `SmartChordsWorkspace.tsx` e `workspace.css`. | **Preservado estritamente como modos alternativos (`Editar` ou `Visualizar`, nunca lado a lado)**, com segmented control de alto contraste e remoção do CSS duplicado/quebrado (`--bg-primary`). | Cumpre a decisão obrigatória do proprietário, evita compressão horizontal da cifra e garante foco total tanto na escrita em colchetes quanto na leitura de palco. |
| **6. Botões de PDF na `SmartChordToolbar`** | Botão `Exportar PDF` na barra e item `Configurações do PDF` no menu `•••` chamam exatamente a mesma função (`handlePrint()`). | Botão único e claro `PDF / Imprimir` na barra principal (que abre o modal de Configuração + Preview A4 paginado). | Elimina redundância confusa para usuários leigos, deixando evidente onde gerar, configurar e baixar o PDF A4. |
| **7. Modal de Importação (`SmartChordImportModal`)** | Mais de 40 estilos inline com cores azul-marinho/slate hardcoded (`#1e293b`, `#0f172a`, `#3b82f6`), quebrando o Modo Claro. | Totalmente tokenizado no Design System v1.0 (Creme/Branco/Verde/Terracota no Claro e Verde Noturno no Escuro), preservando as 4 abas (`PDF`, `Texto`, `URL`, `Imagem`) e o preview obrigatório. | Corrige a maior quebra visual da Web R16, integrando a importação de cifras à identidade oficial do LouvAIO. |
| **8. Campos de Formulário (`FloatingInput` / `FloatingSelect`)** | Label flutuante sobre a linha da borda em `--primary-light` (`#86A38F`), resultando em contraste **2.61:1** (reprovado no WCAG AA) no Modo Claro. | Rótulos superiores fixos (`#46544E` no Claro = **6.8:1** / `#C7C0B8` no Escuro = **8.9:1**) e bordas de input visíveis (`--border-strong`). | Garante conformidade WCAG 2.1 AA e facilita o preenchimento por voluntários leigos sem sobreposição entre rótulo e texto digitado. |
| **9. Contraste de Textos Secundários e Botões Terracota** | `--text-muted: #7A8680` sobre `#F5EFE6` tinha contraste **3.22:1**; `--brand-terracotta: #C96F52` com texto branco no escuro tinha **3.48:1**. | Ajustados para `--text-muted: #5C6862` (**4.95:1**) no Claro e botão primário `#AE5235` (**5.02:1**) / `#B85A3C` (**4.52:1**) com acordes em `#9E4427` (Claro) e `#E69176` (Escuro, **7.4:1**). | Preserva fielmente a identidade Verde + Terracota + Creme enquanto atinge aprovação matemática em todos os critérios de contraste WCAG AA. |
