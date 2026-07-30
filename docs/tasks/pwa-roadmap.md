# Roadmap PWA e Adequação Mobile-First

Mapeamento completo de conformidade PWA e experiência mobile de todos os componentes de interface do Praise App (`web/src/components/`).

> **Diretrizes de Referência**:
> - [`AGENTS.md`](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/AGENTS.md)
> - [`docs/architecture.md`](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/docs/architecture.md)
> - [`docs/domain-rules.md`](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/docs/domain-rules.md)

---

## 📊 Resumo da Auditoria PWA

- **Total de componentes analisados**: 29
- **Critérios de avaliação**:
  1. **Modais & Formulários**: Modais flutuantes convertidos em Full-Screen Views no mobile (`< 768px`).
  2. **BottomNav**: Barra de navegação inferior oculta quando telas/modais de edição ou detalhes estão abertos.
  3. **Safe Areas**: Suporte a entalhes/notch no iOS/Android via `env(safe-area-inset-top)` e `env(safe-area-inset-bottom)`.
  4. **Touch Targets**: Botões, ícones e linhas com dimensão mínima de clique de **44x44px**.
  5. **Layout & Scroll**: Ausência de vazamento de tela e presença de scroll horizontal (`overflow-x: auto`) em abas/chips.

---

## 📋 Lista de Conformidade por Componente

- [x] **AdminsView.tsx**
  - **Problemas corrigidos**:
    - [x] Safe Area Insets adicionadas no topo (`safe-area-inset-top`) e fundo da tela (`safe-area-inset-bottom`)
    - [x] Touch targets do botão de voltar, limpar busca e botões de toggle admin (`admin-toggle-switch`) ajustados para no mínimo 44x44px
    - [x] Proteção contra sobreposição e alinhamento responsivo mantidos para resoluções mobile

- [x] **ArtistCard.tsx**
  - **Problemas corrigidos**:
    - [x] Área interativa do card ajustada com altura mínima de 64px e avatar de 44x44px
    - [x] Botão de excluir artista ajustado com área de toque de no mínimo 44x44px com alinhamento flex centralizado

- [ ] **AuthModal.tsx**
  - **Problemas identificados**:
    - [ ] Modal não abre em tela cheia no mobile (< 768px) (dialog popup flutuante)
    - [ ] Falta Safe Area no topo e rodapé do modal
    - [ ] Botões e campos de formulário possuem altura inferior a 44px

- [x] **BottomNav.tsx**
  - **Problemas identificados**:
    - [ ] Utiliza variável CSS customizada (`--safe-area-bottom`) que necessita de garantia direta de fallback `env(safe-area-inset-bottom)`

- [x] **ClassificationsView.tsx**
  - **Problemas corrigidos**:
    - [x] Modal de criação/edição de classificação (`.classification-modal`) adaptado para Full-Screen View no mobile (< 768px)
    - [x] Safe Area Insets adicionadas no container principal e no rodapé do modal (`safe-area-inset-bottom`)
    - [x] Botões do cabeçalho (voltar, nova classificação), menu de 3 pontos e botões de ação do formulário ajustados para no mínimo 44x44px

- [ ] **CreateGroupModal.tsx** *(Componente Stub Legado)*
  - **Problemas identificados**:
    - [ ] Componente legado em desuso (redirecionamento de 82 bytes)

- [x] **CreateMinistryModal.tsx**
  - **Problemas corrigidos**:
    - [x] Modal convertido em Full-Screen View no mobile (< 768px)
    - [x] BottomNav e Header ocultados automaticamente quando `showCreateGroupModal` está ativo
    - [x] Safe Area Insets adicionadas no topo (`safe-area-inset-top`) e rodapé sticky (`safe-area-inset-bottom`)
    - [x] Touch targets de fechar (`ChevronLeft`/`X`), inputs e botões de ação ajustados para no mínimo 44x44px

- [x] **CreateScheduleModal.tsx**
  - **Problemas corrigidos**:
    - [x] Adicionados Safe Area Insets no topo e rodapé fixo de salvamento (`env(safe-area-inset-top)` e `env(safe-area-inset-bottom)`)
    - [x] Botões das abas superiores ajustados para altura mínima de 44px e contêiner com rolagem horizontal touch (`overflow-x: auto`)
    - [x] Área de toque dos botões de reordenar (grip 44x44px) e remover participantes/músicas ajustados para no mínimo 44x44px
    - [x] Adicionada proteção contra vazamento de largura (`min-width: 0`, `ellipsis`) nos seletores para telas estreitas (< 360px)

- [x] **DashboardView.tsx**
  - **Problemas corrigidos**:
    - [x] Safe Area Insets adicionadas no topo (`safe-area-inset-top`) e fundo da tela (`safe-area-inset-bottom`)
    - [x] Touch targets de botões de ação (Acessar Repertório, Adicionar, Ver Todos), cards de ministérios, escalas e aniversariantes ajustados para no mínimo 44x44px
    - [x] Layout responsivo com adaptações flexíveis para os 4 blocos principais do painel em telas mobile

- [x] **FilterPopover.tsx**
  - **Problemas corrigidos**:
    - [x] Popover adaptado para Bottom Sheet no mobile com fundo semitransparente, desfoque (`backdrop-filter`) e handle visual de topo
    - [x] Adicionadas Safe Area Insets na parte inferior do Bottom Sheet (`safe-area-inset-bottom`)
    - [x] Chips de Tom e botões de ação (Limpar/Aplicar) ajustados com touch target de no mínimo 44x44px

- [x] **FolderCard.tsx**
  - **Problemas corrigidos**:
    - [x] Área de toque dos botões de ação rápida (editar e excluir) ajustada para no mínimo 44x44px
    - [x] Ícone da pasta e container do card com altura de 130px e dimensão flexível otimizada para dispositivos móveis

- [x] **FolderDetail.tsx**
  - **Problemas corrigidos**:
    - [x] BottomNav ocultada automaticamente no mobile quando `selectedFolder` está ativo
    - [x] Adicionados Safe Area Insets no topo (`safe-area-inset-top`) e fundo da tela (`safe-area-inset-bottom`)
    - [x] Botões de voltar, ação, remoção e modal de adição de músicas com touch targets de no mínimo 44x44px
    - [x] Modal de adicionar músicas convertido para Full-Screen View no mobile

- [x] **Header.tsx**
  - **Problemas corrigidos**:
    - [x] Safe Area Inset no topo (`safe-area-inset-top`) adicionado para suporte completo a notch no iOS e Android
    - [x] Contêineres laterais das ações esquerda/direita ajustados com altura/largura mínima de toque de 44x44px

- [x] **InstallPWAPrompt.tsx**
  - **Problemas corrigidos**:
    - [x] Botão de dispensar banner (`pwa-dismiss-btn`) e instalar (`pwa-install-btn`) ajustados para área de toque mínima de 44x44px
    - [x] Posicionamento responsivo ajustado para evitar sobreposição com a BottomNav e gestos iOS (`bottom: calc(76px + var(--safe-area-bottom))`) e desktop (`bottom: 20px`)

- [x] **InviteCodeModal.tsx**
  - **Problemas corrigidos**:
    - [x] Modal convertido em Full-Screen View no mobile (< 768px)
    - [x] BottomNav e Header ocultados automaticamente quando `showInviteModal` está ativo
    - [x] Safe Area Insets adicionadas no topo (`safe-area-inset-top`) e rodapé sticky (`safe-area-inset-bottom`)
    - [x] Touch targets de fechar (`ChevronLeft`/`X`), botão de copiar código e botão de gerar código ajustados para no mínimo 44x44px

- [ ] **JoinGroupModal.tsx** *(Componente Stub Legado)*
  - **Problemas identificados**:
    - [ ] Componente legado em desuso (redirecionamento de 76 bytes)

- [x] **JoinMinistryModal.tsx**
  - **Problemas corrigidos**:
    - [x] Modal convertido em Full-Screen View no mobile (< 768px)
    - [x] BottomNav e Header ocultados automaticamente quando `showJoinModal` está ativo
    - [x] Safe Area Insets adicionadas no topo (`safe-area-inset-top`) e rodapé sticky (`safe-area-inset-bottom`)
    - [x] Touch targets de fechar (`ChevronLeft`/`X`), campo de código curto e botão de validação ajustados para no mínimo 44x44px

- [x] **LiturgiesView.tsx**
  - **Problemas corrigidos**:
    - [x] Modal de criação de liturgia (`.liturgy-modal`) adaptado para Full-Screen View no mobile (< 768px)
    - [x] Safe Area Insets adicionadas no topo (`safe-area-inset-top`) e fundo do container (`safe-area-inset-bottom`)
    - [x] Botões de fechar, criar liturgia, excluir liturgia e botões de seleção de músicas ajustados para no mínimo 44x44px
    - [x] Tratamento seguro de datas em `pt-BR` sem deslocamento por timezone UTC

- [x] **LoginPage.tsx**
  - **Problemas corrigidos**:
    - [x] Safe Area Insets adicionadas no topo (`safe-area-inset-top`) e fundo da tela (`safe-area-inset-bottom`)
    - [x] Touch targets das abas (Entrar/Criar Conta), inputs de texto/e-mail/senha, botão de exibir senha e botão de submissão ajustados para no mínimo 44x44px
    - [x] Ícones dos cards de benefícios expandidos para no mínimo 44x44px com alinhamento flex centralizado

- [x] **MinistryView.tsx**
  - **Problemas corrigidos**:
    - [x] Safe Area Insets adicionadas no topo (`safe-area-inset-top`) e fundo da tela (`safe-area-inset-bottom`)
    - [x] Touch targets das abas superiores (Informações/Membros), botões de adicionar membro e menus de 3 pontos ajustados para no mínimo 44x44px
    - [x] Suporte preservado para as visões filhas (Equipes, Funções, Classificações, Administradores e Modelos) com navegação fluida em dispositivos móveis

- [x] **RolesView.tsx**
  - **Problemas corrigidos**:
    - [x] Modal de criação/edição de função (`.role-modal`) adaptado para Full-Screen View no mobile (< 768px)
    - [x] Safe Area Insets adicionadas no container principal e no rodapé do modal (`safe-area-inset-bottom`)
    - [x] Botões do cabeçalho (voltar, nova função), menu de 3 pontos e botões seletores de ícones (`icon-picker-btn`) ajustados para no mínimo 44x44px

- [x] **ScheduleDetailView.tsx**
  - **Problemas corrigidos**:
    - [x] Modal de chat da escala (`schedule-chat-modal`) adaptado para Full-Screen View no mobile (< 768px)
    - [x] Safe Area Insets adicionadas no container principal e barra de envio de comentário sticky no rodapé (`safe-area-inset-bottom`)
    - [x] Botões do cabeçalho (voltar, chat, editar, excluir), confirmação de presença (confirmar/recusar) e envio de mensagens ajustados para no mínimo 44x44px

- [x] **SchedulesView.tsx**
  - **Problemas corrigidos**:
    - [x] Safe Area Insets adicionadas no container principal (`safe-area-inset-bottom`)
    - [x] Botões das abas ("Próximas" / "Anteriores"), botão de criar escala e área de toque dos cards de escala ajustados para no mínimo 44x44px
    - [x] Formatação de datas preservada no padrão `pt-BR` sem deslocamento de fusos horários UTC

- [x] **SmartChordsWorkspace.tsx**
  - **Problemas corrigidos**:
    - [x] Safe Areas adicionadas no topo (`safe-area-inset-top`) e fundo do container (`safe-area-inset-bottom`)
    - [x] Botões de transposição (+/-), tamanho de fonte (+/-), inputs e ações do workspace ajustados para no mínimo 44x44px
    - [x] Layout reativo flexível adaptado para telas mobile com rolagem vertical e horizontal de cifras
    - [x] Suporte ao tema escuro/claro e visualização pre-formatada preservados

- [x] **SongCard.tsx**
  - **Problemas corrigidos**:
    - [x] Área interativa do card ajustada com altura mínima de 64px e avatar de 44x44px
    - [x] Chips de Tom, BPM, Duração e Classificação com padding e tipografia otimizada para toque mobile

- [x] **SongDetail.tsx**
  - **Problemas corrigidos**:
    - [x] BottomNav ocultada automaticamente no mobile quando `selectedSong` está ativo
    - [x] Adicionados Safe Area Insets no topo (`safe-area-inset-top`) e fundo da tela (`safe-area-inset-bottom`)
    - [x] Botões de voltar, ação, abas, transposição de tom (+/-) e tiles de links com touch targets de no mínimo 44x44px

- [x] **SongFormModal.tsx**
  - **Problemas corrigidos**:
    - [x] Modal convertido em Full-Screen View no mobile (< 768px)
    - [x] BottomNav e Header ocultados automaticamente quando `showSongModal` está aberto
    - [x] Safe Areas adicionadas no cabeçalho sticky (`safe-area-inset-top`) e rodapé de salvamento (`safe-area-inset-bottom`)
    - [x] Touch targets de botões, fechar e campos de entrada garantidos com no mínimo 44x44px

- [x] **TeamsView.tsx**
  - **Problemas corrigidos**:
    - [x] Full-Screen View & Modal (`.team-modal`) com suporte a Safe Areas no topo e rodapé (`safe-area-inset-bottom`)
    - [x] Ocultação da BottomNav e Header ativada quando o modal de criar/editar equipe está aberto
    - [x] Botões do cabeçalho (voltar, nova equipe), menu de 3 pontos e limpar busca ajustados para no mínimo 44x44px
    - [x] Linhas de seleção de integrantes (`team-member-row`) com altura mínima de toque de 48px

- [x] **TemplatesView.tsx**
  - **Problemas corrigidos**:
    - [x] Modal de adicionar/editar eventos (`template-event-modal`) adaptado para Full-Screen View no mobile (< 768px)
    - [x] Safe Area Insets adicionadas no topo (`safe-area-inset-top`) e no rodapé da página (`safe-area-inset-bottom`)
    - [x] Drag handles de reordenação (44x44px), botões de mover (subir/descer), fechar e seletor de ícones ajustados para no mínimo 44x44px
    - [x] Botões de navegação, criar modelo e opções do menu ajustados para a área de toque padrão de 44px
