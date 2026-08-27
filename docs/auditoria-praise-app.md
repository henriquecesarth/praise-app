# Auditoria técnica, visual e de PWA — Praise App

> Documento histórico do baseline anterior à correção de 2026-08-27. As afirmações abaixo descrevem o estado observado naquela auditoria e não o checkout atual. O resultado implementado e as pendências vigentes estão em `docs/system-status.md` e no ExecPlan concluído de mobile/PWA/acessibilidade.

## Estado após a correção

- PRA-001 a PRA-003, PRA-005, PRA-007, PRA-012 e PRA-020 a PRA-022 foram tratados no cliente.
- A matriz Playwright passou em 360×800, 390×844 e 412×915, nos temas claro e escuro, com API mockada e sem escritas externas.
- O service worker do build contém apenas precache de shell/assets estáticos e fallback offline; não há runtime cache de API.
- Persistência/segurança Smart Chords backend, integrações reais e testes em dispositivo permanecem fora desta validação e estão classificados no estado do sistema.

**Aplicação:** https://praise-app-m7tn.vercel.app/  
**Data da auditoria:** 27/08/2026  
**Conta utilizada:** conta de demonstração fornecida pelo responsável  
**Escopo percorrido:** login, painel inicial, repertório, detalhes e edição de música, filtros, pastas, artistas, Cifras Inteligentes, escalas anteriores e detalhes, chat, edição de escala, participantes, músicas, roteiro, membros, convite, cadastro manual, equipes, funções, classificações, administradores, modelos, menu recolhido, modos claro/escuro e metadados de PWA.

## Resumo executivo

A aplicação já possui uma identidade visual coerente, boa hierarquia geral, temas claro e escuro, áreas de toque de 44–48 px em grande parte das ações e várias regras específicas para mobile, inclusive `safe-area`, barra inferior e modais em tela cheia.

Os maiores riscos estão na navegação mobile, acessibilidade, consistência dos formulários e robustez do carregamento autenticado. O CSS oculta toda a barra lateral abaixo de 768 px, mas a barra inferior oferece apenas quatro destinos e omite **Cifras Inteligentes**. A mesma troca remove do mobile o logout, a troca/criação de ministério e a entrada por código, sem alternativa equivalente visível. Também foram observados erros reais no console da aplicação, sobreposição de rótulos, data e hora no padrão americano, indicador incorreto de aba e ausência de service worker registrado.

## Limite da evidência mobile

O navegador remoto disponibilizou uma viewport real de **1363 × 936 px** e não expôs controle para redimensioná-la exatamente para 390 × 844, 360 × 800 e 412 × 915. Portanto:

- defeitos visuais marcados como **observados** foram vistos diretamente no navegador;
- conclusões mobile marcadas como **confirmadas pelo CSS/DOM** foram verificadas nas regras ativas para `max-width: 767px` e na estrutura dos controles;
- ainda é recomendada uma rodada final de screenshots/regressão visual nas três larguras-alvo dentro do repositório, usando Playwright ou Chrome DevTools.

## Achados priorizados

| ID | Gravidade | Tela/componente | Problema | Evidência | Correção recomendada |
| --- | --- | --- | --- | --- | --- |
| PRA-001 | 🔴 Crítico | Navegação mobile | **Cifras Inteligentes fica sem acesso direto no mobile.** | Confirmado pelo CSS/DOM: `aside.no-print` é ocultado em `max-width: 767px`; a `.bottom-nav` contém somente Início, Escalas, Repertório e Ministério. | Incluir Cifras na barra inferior ou criar um menu “Mais” claramente acessível. Validar em 360, 390 e 412 px sem truncar rótulos. |
| PRA-002 | 🔴 Crítico | Conta e ministérios no mobile | **Logout, troca/criação de ministério e entrada por código desaparecem quando a lateral é ocultada.** | Confirmado pelo CSS/DOM: esses controles existem na lateral; o header mobile não contém alternativas equivalentes e a barra inferior só navega entre quatro seções. | Adicionar menu de perfil/ministério no header mobile, contendo sair, selecionar ministério, criar ministério e entrar por código. Não depender da sidebar escondida. |
| PRA-003 | 🟠 Alto | PWA/offline | **Nenhum service worker registrado e a página não está controlada por service worker.** | Observado em execução: zero registros e `navigator.serviceWorker.controller` ausente; existe manifesto, mas não há camada offline/cache. | Registrar service worker, cachear somente o shell e assets estáticos versionados, criar fallback offline e nunca cachear respostas autenticadas/API de forma insegura. |
| PRA-004 | 🟠 Alto | Inicialização autenticada | **Condição de corrida de autenticação.** | Erro real do app: “Erro ao carregar grupos do usuário: Token de autenticação não fornecido.” logo após o acesso; a UI recuperou depois. | Bloquear chamadas dependentes de token até a hidratação da sessão terminar; centralizar estado `authReady`; evitar requests concorrentes durante bootstrap. |
| PRA-005 | 🟠 Alto | Editar Escala — abas | **O realce visual da aba fica uma posição atrás da aba ativa.** | Observado: ao abrir Participantes, Detalhes permanece realçado; em Músicas, Participantes aparece realçado; em Roteiro, Músicas aparece realçado. O DOM marca a aba correta como ativa, mas o indicador gráfico está deslocado. | Vincular a posição do indicador ao índice real, revisar cálculo de `transform/width` e cobrir as quatro abas com teste visual. |
| PRA-006 | 🟠 Alto | Editar Escala e membro | **Localização de data/hora incompatível com pt-BR.** | Observado: data `07/30/2026`, hora `07:00 PM` e placeholder `mm/dd/yyyy`, enquanto o restante da interface usa português e 24 horas. | Usar `pt-BR`, mostrar `30/07/2026` e `19:00`; manter ISO apenas no valor interno. Validar Chrome Android e Safari iOS. |
| PRA-007 | 🟠 Alto | Formulários | **Rótulos se sobrepõem aos valores/placeholders.** | Observado na edição de música: “Título da Música *” sobre “Ao Teu rosto vir”; no cadastro manual: “Data de Nascimento” sobre `mm/dd/yyyy`. | Refatorar o componente de campo flutuante: mover label somente com foco ou valor, reservar altura e testar input vazio, preenchido, autofill, date e textarea. |
| PRA-008 | 🟠 Alto | Acessibilidade mobile | **Zoom por gesto está desabilitado.** | Meta viewport: `maximum-scale=1.0, user-scalable=no`. | Remover essas duas restrições e manter apenas `width=device-width, initial-scale=1, viewport-fit=cover`. |
| PRA-009 | 🟠 Alto | Cifras Inteligentes | **Falha ao carregar artistas/músicas por perda do ministério.** | Erro real do app: “Erro ao carregar artistas/músicas: Ministério não encontrado.” durante o fluxo de Cifras. | Fazer o editor aguardar `selectedMinistryId`, cancelar requests obsoletos ao navegar e exibir erro recuperável na própria tela. |
| PRA-010 | 🟠 Alto | Navegação interna | **Todas as seções permanecem na URL `/`.** | Observado ao alternar Início, Repertório, Cifras, Escalas e Ministério: a URL não muda. | Adotar rotas estáveis (`/repertorio`, `/cifras`, `/escalas/:id`, `/ministerio`), suportando voltar/avançar, refresh, deep link e restauração de estado. |
| PRA-011 | 🟠 Alto | Cards de músicas e escalas | **Elementos clicáveis não têm semântica de link/botão.** | No snapshot acessível, títulos e cards aparecem como `generic`; a navegação ocorre clicando no texto/card. | Usar `<a>` ou `<button>` com nome acessível, foco visível e ativação por Enter/Espaço. |
| PRA-012 | 🟠 Alto | Botões por ícone | **Há ações sem nome acessível.** | Observado em excluir música, excluir escala, editar/clonar versão e alguns botões de opções: aparecem como `button` sem nome no snapshot. | Adicionar `aria-label` específico, `title` auxiliar e estado de foco. Ex.: “Excluir música Ao Teu rosto vir”. |
| PRA-013 | 🟠 Alto | SmartChord — visualização | **A prévia fragmenta o conteúdo em dezenas de nós por caractere.** | Snapshot acessível mostrou cada letra da frase como um `generic` separado. | Renderizar a linha como texto contínuo e marcar acordes de forma semântica; adicionar `aria-label`/estrutura que permita leitura natural por leitor de tela. |
| PRA-014 | 🟡 Médio | Tema escuro | **Metadados secundários ficam abaixo do contraste recomendado.** | Medição aproximada em elementos sólidos: textos como “Liderança de Louvor”, “Hoje, 14:00”, “Coordenação” e “Ontem” ficaram em cerca de **3,21:1** para fonte de 11,2 px. | Clarear `--text-muted` no escuro para atingir ao menos 4,5:1; revisar também badges e labels de 11–12 px. |
| PRA-015 | 🟡 Médio | Áreas de toque | **Alguns controles têm dimensão menor que 44 × 44 px.** | Observado: alternador de tema com cerca de 26 × 44 px; seletor de ministério com 32 px de altura no desktop. | Garantir caixa clicável mínima de 44 × 44 px, mesmo quando o ícone visual permanece menor. |
| PRA-016 | 🟡 Médio | Cifras Inteligentes | **Campos e ação principal têm pouca aparência de controle.** | Observado: busca, inputs/selects e “Criar Cifra” parecem texto solto; limites e estados de foco são discretos demais. | Reforçar bordas/fundos, espaçamento e foco; transformar a ação principal em botão inequívoco, sticky no mobile se necessário. |
| PRA-017 | 🟡 Médio | Painel inicial | **Mensagem de escala contradiz os dados existentes.** | O painel informa “Nenhuma escala criada ainda”, mas a seção Escalas possui quatro escalas anteriores. | Alterar para “Nenhuma próxima escala agendada” e oferecer “Criar próxima escala” ou “Ver histórico”. |
| PRA-018 | 🟡 Médio | Modais | **Ações duplicadas e controles de fechamento ambíguos.** | Observado em música, escala e convite: ação de salvar no topo e rodapé; em alguns headers há seta voltar e `X` lado a lado. | Definir um padrão: header com voltar/fechar + título; rodapé sticky com ação primária. Evitar duas ações equivalentes simultâneas. |
| PRA-019 | 🟡 Médio | Estados vazios | **Áreas vazias ocupam altura excessiva e reduzem densidade.** | Observado em Pastas, Artistas, Escalas e Chat; grandes blocos vazios dominam a tela mesmo com uma única ação. | Reduzir altura mínima em desktop; no mobile usar conteúdo compacto e CTA próximo da explicação. |
| PRA-020 | 🟡 Médio | PWA/idioma | **Manifesto declara idioma inglês.** | Manifesto: `lang: "en"`; HTML: `lang="pt-BR"`. | Alterar o manifesto para `pt-BR`. |
| PRA-021 | 🟡 Médio | PWA/tema | **`theme-color` permanece escura mesmo no modo claro.** | Meta `theme-color` fixa em `#131614`. | Usar duas metas com `media="(prefers-color-scheme: ...)"` ou atualizar a meta ao alternar tema. |
| PRA-022 | 🟡 Médio | Ícones PWA | **Um único SVG é declarado como favicon, apple-touch-icon e ícone 192/512/maskable.** | Manifesto e `<head>` usam apenas `/icon.svg`; o manifesto declara `sizes: "192x192 512x512"`. | Fornecer PNGs reais 192, 512 e maskable com safe zone; adicionar apple-touch-icon PNG 180 × 180; manter SVG como favicon. |
| PRA-023 | 🔵 Polimento | Painel claro | **Sombras e brilhos são pesados e competem com a hierarquia.** | Observado nos CTAs, cards e estado ativo; o brilho faz vários botões parecerem simultaneamente prioritários. | Reservar glow para ação primária/foco; reduzir blur/opacidade nos cards e estados selecionados. |
| PRA-024 | 🔵 Polimento | Detalhe de escala | **Título e data aparecem duplicados no header e no card principal.** | Observado em “Culto de Domingo”. | No mobile manter header compacto e título no conteúdo; no desktop reduzir a duplicação ou usar breadcrumb. |
| PRA-025 | 🔵 Polimento | Papéis dos participantes | **Lista de funções fica visualmente comprimida.** | Observado: vários emojis e funções em uma linha estreita antes do badge “Pendente”. | Permitir wrap controlado em chips, limitar funções exibidas e mostrar “+N” quando necessário. |

## Pontos positivos confirmados

- Identidade visual consistente entre telas e temas.
- Uso recorrente de alvos de 44–48 px para ações principais.
- Regras mobile explícitas para `safe-area`, barra inferior e padding inferior do body.
- Modais complexos são convertidos para tela cheia abaixo de 768 px, com header/footer sticky.
- Grids principais colapsam para uma coluna em 680–900 px.
- Hierarquia de títulos, cards e CTAs é compreensível na maior parte das telas.
- Estados vazios normalmente explicam o próximo passo.

## Ordem recomendada de implementação

1. Restaurar todas as rotas e ações essenciais no mobile (PRA-001 e PRA-002).
2. Corrigir bootstrap autenticado e dependência de ministério (PRA-004 e PRA-009).
3. Corrigir abas, locale e campos sobrepostos (PRA-005, PRA-006 e PRA-007).
4. Resolver semântica, zoom, contraste e áreas de toque (PRA-008 e PRA-011 a PRA-015).
5. Implementar PWA real com service worker e ajustar manifesto/ícones (PRA-003 e PRA-020 a PRA-022).
6. Refinar densidade, modais, hierarquia e polimento visual.

## Critérios de aceite da rodada mobile

- Screenshots e testes em 360 × 800, 390 × 844 e 412 × 915, nos temas claro e escuro.
- Nenhum overflow horizontal no documento ou em modais.
- Todas as cinco áreas principais acessíveis no mobile, incluindo Cifras.
- Logout e gestão/troca de ministério acessíveis sem sidebar.
- Navegação por URL, refresh e botão Voltar preservando a tela esperada.
- Nenhum campo com label sobreposto, inclusive autofill e inputs de data/hora.
- Alvos interativos mínimos de 44 × 44 px.
- Contraste mínimo de 4,5:1 para texto pequeno.
- Nenhum botão icon-only sem nome acessível.
- Nenhum erro da aplicação no console durante login e navegação principal.
- Service worker registrado, fallback offline testado e APIs autenticadas fora do cache público.
