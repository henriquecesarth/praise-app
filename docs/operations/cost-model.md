# Modelo de Consumo, Custos e Escalabilidade da Arquitetura LouvAIO

**Data do Snapshot**: 2026-08-29  
**Versão do Documento**: 3.0.0 (Reconciliação Final de Infraestrutura e Baseline Comercial)  
**Status**: Auditoria e Modelagem Financeira Concluída (Sem alterações de código funcional)  
**Scripts Analíticos de Verificação**:  
- `docs/analysis/reconcile-cost-model.mjs` (Consumo e Volumes Técnicos)  
- `docs/analysis/calculate-pricing.mjs` (Precificação Monetária e Cenários Financeiros)  
- `docs/operations/infrastructure-pricing-snapshot.md` (Catálogo Oficial de Tarifas)  

---

## 1. Introdução e Escopo

Este documento apresenta a auditoria técnica de consumo de infraestrutura, comportamento assintótico e modelagem determinística de escalabilidade e precificação financeira da arquitetura operacional do **LouvAIO** (anteriormente *Praise App*).

O objetivo é mapear quantitativamente como o consumo de computação, persistência, rede, egress e autenticação cresce à medida que o sistema ganha novos ministérios, integrantes e volume de dados, transformando métricas técnicas em **custo monetário estimado em USD e BRL** antes de qualquer decisão de precificação comercial ou otimização prematura.

### 1.1 Classificação Epistemológica de Evidências

Todas as informações desta auditoria seguem estritamente os quatro níveis de certeza operacional:
- **`[Observed from code]`**: Comportamento, rota, query, ciclo de vida ou estrutura de dados diretamente verificada no código-fonte e arquivos de configuração atuais.
- **`[Observed Pricing]`**: Preço, taxa ou franquia coletada diretamente da documentação e tabelas oficiais vigentes de Google Cloud, Firebase e Vercel (Snapshot 2026-08-29).
- **`[Derived]`**: Cálculo matemático, dedução lógica ou fórmula exata derivada diretamente da implementação observada e das tarifas oficiais.
- **`[Assumption]`**: Hipótese de comportamento humano, frequência de uso, taxa de acesso ou proporção comercial de clientes adotada para fins de modelagem e simulação.
- **`[Unknown / must verify in provider dashboards]`**: Informação ou métrica que depende de medição em produção sob carga real ou confirmação manual no console de provedor.

---

## 2. Inventário da Arquitetura Atual

`[Observed from code]`

```
                     ┌─────────────────────────────────────────────────────────┐
                     │                     CLIENT (Browser/PWA)                │
                     │  React 18.3.1 + TypeScript + Vite 5.3.1 + Tailwind v4   │
                     │  - Armazenamento de Token: localStorage (praise_auth_*) │
                     │  - Roteamento: React Router v6.30.6                     │
                     │  - Sem biblioteca de cache global (sem SWR/React Query) │
                     └────────────────────────────┬────────────────────────────┘
                                                  │ HTTPS / REST (api.ts)
                                                  ▼
                     ┌─────────────────────────────────────────────────────────┐
                     │               VERCEL SERVERLESS FUNCTION                │
                     │  Node.js + Express 5.2.1 Monolith (`backend/src/app.ts`)│
                     │  - Autenticação: JWT próprio assinado (7 dias)          │
                     │  - Middlewares: requireMinistryRole + quota-enforcement │
                     └────────────────────────────┬────────────────────────────┘
                                                  │ Firebase Admin SDK 14.2.0
                                                  ▼
                     ┌─────────────────────────────────────────────────────────┐
                     │                   CLOUD FIRESTORE                       │
                     │  Coleções: ministries, ministry_members, songs,         │
                     │  schedules, schedule_comments, ministry_subscriptions,  │
                     │  ministry_usage, folders, artists, ministry_roles, etc. │
                     └─────────────────────────────────────────────────────────┘
```

1. **Frontend / PWA** `[Observed from code]`:
   - SPA React 18.3.1 com TypeScript e TailwindCSS v4.3.3 (`web/package.json`).
   - Hospedada estaticamente na Vercel (`web/vercel.json`).
   - Service Worker via `vite-plugin-pwa` faz precache apenas dos assets estáticos e do shell da aplicação; requisições de API utilizam `NetworkOnly` sem runtime caching de endpoints (`web/vite.config.ts`).
   - Cliente centralizado `web/src/api.ts` executa chamadas `fetch` diretas e trata conversões de casing.
2. **Backend** `[Observed from code]`:
   - Monólito Express 5.2.1 empacotado como Serverless Function da Vercel (`backend/vercel.json` direciona `/(.*)` para `src/app.ts` usando `@vercel/node`).
   - Região de execução serverless: `Repository-configured function region: not explicitly set; Platform default for new projects: iad1; Actual deployed project setting: UNKNOWN until Dashboard verification`.
   - Inicialização do Firebase Admin SDK 14.2.0 em `backend/src/lib/firebase.ts` compartilhada no ciclo de vida da instância.
   - Emissão de JWT próprio assinado com expiração de 7 dias via `jsonwebtoken` (`backend/src/repositories/UserRepository.ts`).
3. **Persistência (Cloud Firestore)** `[Observed from code]`:
   - Persistência NoSQL orientada a documentos agrupados por chave de partição lógica `ministry_id` (com aliases legados `group_id`).
   - Coleções ativas: `ministries`, `ministry_members`, `ministry_subscriptions`, `ministry_usage`, `songs`, `artists`, `folders`, `folder_songs`, `ministry_classifications`, `schedules`, `schedule_comments`, `ministry_teams`, `ministry_roles`, `ministry_schedule_templates`, `smart_chords`, `users`, `ministry_invites`.
   - Região do Firestore: `Firestore region: UNKNOWN / must verify in Firebase Console`.
4. **Recursos Externos e CDNs** `[Observed from code]`:
   - Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`).
   - `html2pdf.js` via CDN (`cdnjs.cloudflare.com`) para geração de PDF de cifras exclusivamente no cliente.
   - Firebase Identity Toolkit REST API (`identitytoolkit.googleapis.com`) para validação de senha quando `FIREBASE_WEB_API_KEY` está configurada.

---

## 3. Mapa de Jornadas do Produto

`[Observed from code]`

A tabela abaixo mapeia as 38 principais jornadas do produto identificadas no código-fonte, os endpoints HTTP disparados e o comportamento de concorrência:

| ID | Jornada do Usuário | Endpoints HTTP Invocados | Qtd. Chamadas | Concorrência / Padrão | Observações de Código |
|---|---|---|:---:|---|---|
| **J01** | Login (Credenciais) | `POST /auth/login` | 1 | Sequencial | Verifica senha no Identity Toolkit / Admin e busca doc `users` |
| **J02** | Cadastro (Sign Up) | `POST /auth/signup` | 1 | Sequencial | Cria usuário no Firebase Auth e cria documento em `users` |
| **J03** | Bootstrap Inicial (Sessão) | `GET /auth/me`<br>`GET /ministries/my-ministries` | 2 | `Promise.all` via `bootstrapAuth` | Valida JWT e lista ministérios do usuário |
| **J04** | Bootstrap de Ministério (Carregamento de Tela) | `GET /ministries/:id/subscription`<br>`GET /ministries/:id/counts`<br>`GET /ministries/:id/classifications`<br>`GET /ministries/:id/folders`<br>`GET /ministries/:id/artists`<br>`GET /ministries/:id/songs`<br>`GET /ministries/:id/schedules` | 7 | Disparo em lote paralelo após resolução de assinatura | Executado após login, refresh ou troca de ministério ativo (`App.tsx:146-179`) |
| **J05** | Troca de Ministério Ativo | `GET /ministries/:id/subscription` + 6 endpoints paralelos (igual J04) | 7 | Paralelo | Limpa estado local e recarrega todos os recursos do ministério selecionado |
| **J06** | Dashboard (Visualização) | `GET /ministries/:id/members` | 1 | Efeito local ao montar DashboardView | Executa busca de membros para calcular aniversariantes (`DashboardView.tsx:131`) |
| **J07** | Repertório: Abrir lista | Utiliza cache de memória do estado (`songs`), ou `GET /ministries/:id/songs` | 0 a 1 | — | Se re-renderizado ou filtro alterado, dispara nova busca |
| **J08** | Repertório: Busca com digitação | `GET /ministries/:id/songs?search=...` | N | Debounce de 300ms (`App.tsx:219`) | Cada busca debounced lê toda a coleção de músicas do ministério |
| **J09** | Repertório: Detalhe de Música | `GET /ministries/:id/songs/:songId` | 1 | Sequencial | Disparado via deep link ou clique (`App.tsx:575`) |
| **J10** | Repertório: Criar Música | `POST /ministries/:id/songs` | 1 | Transacional | Transação atômica (`createSongTransactional`) com validação de quota |
| **J11** | Repertório: Editar Música | `PUT /ministries/:id/songs/:songId` | 1 | Sequencial | Atualiza documento e relê dados (`App.tsx:377`) |
| **J12** | Repertório: Excluir Música | `DELETE /ministries/:id/songs/:songId` | 1 | Transacional | Transação atômica decrementa contador de `ministry_usage` |
| **J13** | Pastas: Listagem | `GET /ministries/:id/folders` | 1 | Loop interno no backend | Backend executa query de contagem em `folder_songs` para cada pasta ($N+1$) |
| **J14** | Pastas: Detalhe da Pasta | `GET /ministries/:id/folders/:folderId` | 1 | Loop interno no backend | Lê pasta + `folder_songs` + leitura pontual de cada música individual ($N+1$) |
| **J15** | Pastas: Criar / Editar Pasta | `POST` ou `PUT /ministries/:id/folders` | 1 | Sequencial | Escrita/atualização de pasta |
| **J16** | Pastas: Vincular Música | `POST /ministries/:id/folders/:id/songs` | 1 | Sequencial | Cria documento composto `folder_songs/{folderId}_{songId}` |
| **J17** | Pastas: Desvincular Música | `DELETE /ministries/:id/folders/:id/songs/:sId` | 1 | Sequencial | Deleta documento `folder_songs` |
| **J18** | Artistas: Listar / Criar | `GET` ou `POST /ministries/:id/artists` | 1 | Sequencial | CRUD de artistas |
| **J19** | Escalas: Listagem | Utiliza estado local ou `GET /ministries/:id/schedules` | 0 a 1 | — | Filtro entre "Próximas" e "Anteriores" é puramente client-side |
| **J20** | Escalas: Detalhes da Escala | Leitura de estado local ou `GET /schedules/:id` | 0 a 1 | Deep link dispara leitura | Lê documento único de escala contendo participantes e roteiro embutidos |
| **J21** | Escalas: Criar Escala | `POST /ministries/:id/schedules` | 1 | Sequencial | Cria documento completo com arrays embutidos |
| **J22** | Escalas: Editar Escala | `PUT /ministries/:id/schedules/:scheduleId` | 1 | Sequencial | Sobrescreve documento de escala |
| **J23** | Escalas: Excluir Escala | `DELETE /ministries/:id/schedules/:scheduleId`| 1 | Sequencial | Remove documento de escala |
| **J24** | Escalas: Confirmação de Presença | `PATCH /schedules/:id/confirmation` | 1 | Sequencial | Lê escala, atualiza array embutido e regrava documento |
| **J25** | Escalas: Chat / Comentários (Ler) | `GET /ministries/:id/schedules/:id/comments` | 1 | Ao abrir modal de chat | Retorna todos os comentários da escala ordenados em memória |
| **J26** | Escalas: Chat / Comentários (Enviar)| `POST /ministries/:id/schedules/:id/comments` | 1 | Sequencial | Valida escala e insere novo documento em `schedule_comments` |
| **J27** | Ministério: Listar Membros | `GET /ministries/:id/members` | 1 | Loop interno no backend | Lê `ministry_members` e faz leitura pontual em `users` para cada membro |
| **J28** | Ministério: Adicionar Membro Manual | `POST /ministries/:id/members` | 1 | Transacional | Transação atômica (`addMemberTransactional`) valida quota em `ministry_usage` |
| **J29** | Ministério: Remover Membro | `DELETE /ministries/:id/members/:memberId` | 1 | Transacional | Transação atômica remove membro e decrementa `ministry_usage` |
| **J30** | Ministério: Editar Cargo/Dados | `PATCH /ministries/:id/members/:memberId` | 1 | Sequencial | Atualiza membro e sincroniza doc `users` e Firebase Auth se aplicável |
| **J31** | Ministério: Criar Convite PR-* | `POST /ministries/:id/invites` | 1 | Sequencial | Gera código aleatório e grava em `ministry_invites` |
| **J32** | Ministério: Ingressar via Convite | `POST /ministries/join` | 1 | Transacional | Transação atômica valida convite, quota do plano e grava membership |
| **J33** | Ministério: Equipes (CRUD) | `GET`, `POST`, `PUT`, `DELETE /teams` | 1 | Sequencial | Lê equipes e filtra/ordena em memória |
| **J34** | Ministério: Funções / Roles (CRUD) | `GET`, `POST`, `PUT`, `DELETE /roles` | 1 | Sequencial | Se vazio, executa seed batch de 11 funções padrão |
| **J35** | Ministério: Modelos de Roteiro | `GET`, `POST`, `PUT`, `DELETE /templates` | 1 | Sequencial | CRUD de templates de roteiro com itens embutidos |
| **J36** | Ministério: Plano e Assinatura | `GET /ministries/:id/subscription`<br>`GET /plans` | 2 | `Promise.all` | Consulta status resolvido e catálogo público de planos |
| **J37** | Smart Chords: Espaço de Trabalho | `GET /artists` + `GET /songs` + `GET /smart-chords` | 3 | Paralelo | Transposição e edição de cifras são 100% executadas no navegador |
| **J38** | Smart Chords: Exportar PDF | *Nenhuma chamada backend* | 0 | Client-side | Renderizado diretamente via `html2pdf.js` no navegador |

---

## 4. Mapeamento de Operações Firestore por Endpoint

`[Observed from code]` + `[Derived]`

Para quantificar a carga real no banco de dados, analisamos a cadeia completa de execução de cada requisição: **Middlewares Globais + Middlewares de Rota + Camada Repository + Efeitos Colaterais**.

### 4.1 Custo Fixo de Middlewares de Segurança

Antes que o controller de qualquer rota seja executado, os middlewares realizam leituras no Firestore:
1. **`requireMinistryRole(role)`** (`backend/src/middleware/rbac.ts`):
   - Lê `ministries.doc(ministryId).get()` (1 read).
   - Se o usuário for o proprietário (`owner_user_id`), encerra. Se não for proprietário, executa query em `ministry_members.where('ministry_id', '==', ministryId).where('user_id', '==', userId).limit(1).get()` (1 read).
   - *Custo*: **1 read** (proprietário) ou **2 reads** (membro regular).
2. **`enforceOperationalAccess`** (`backend/src/middleware/quota-enforcement.ts`):
   - Invocado em mutações (`POST`, `PUT`, `DELETE` operacionais).
   - Executa `subscriptionService.getSubscriptionSummary(ministryId)`.
   - Lê `ministry_subscriptions.doc(ministryId).get()` (1 read) + `ministry_usage.doc(ministryId).get()` (1 read).
   - *Custo*: **2 reads** adicionais por mutação.

### 4.2 Tabela Detalhada de Operações por Endpoint

Definições de variáveis:
- $M$: quantidade de integrantes do ministério (`ministry_members`).
- $S$: quantidade de músicas do ministério (`songs`).
- $E$: quantidade de escalas cadastradas (`schedules`).
- $F$: quantidade de pastas (`folders`).
- $A$: quantidade de artistas (`artists`).
- $C$: quantidade de classificações (`ministry_classifications`).
- $T$: quantidade de equipes (`ministry_teams`).
- $R$: quantidade de funções (`ministry_roles`).
- $L$: quantidade de comentários da escala (`schedule_comments`).
- $S_f$: músicas associadas a uma pasta específica.

| Endpoint | Método | Reads Firestore | Writes Firestore | Deletes Firestore | Complexidade Assintótica | Observação e Tradeoffs |
|---|---|---|---|---|---|---|
| `/api/v1/auth/login` | POST | 1 read | 0 | 0 | $O(1)$ | Busca perfil na coleção `users` |
| `/api/v1/auth/signup` | POST | 0 (Auth) | 1 write | 0 | $O(1)$ | Salva perfil em `users` |
| `/api/v1/auth/me` | GET | 1 read | 0 | 0 | $O(1)$ | Consulta documento `users/{uid}` |
| `/api/v1/ministries/my-ministries` | GET | $1 + M_{user}$ reads | 0 | 0 | $O(M_{user})$ | Query em `ministry_members` + leitura pontual de cada ministério pertencente |
| `/api/v1/ministries` | POST | 0 | 4 writes (Batch) | 0 | $O(1)$ | Cria ministry, membership admin, subscription e usage + seed |
| `/api/v1/ministries/:id` | GET | 1 a 2 reads (RBAC) + 1 | 0 | 0 | $O(1)$ | Consulta dados do ministério |
| `/api/v1/ministries/:id` | PUT | 3 a 4 reads | 2 writes | 0 | $O(1)$ | RBAC (2) + Quota (2) + Update (1) + Get (1) |
| `/api/v1/ministries/:id` | DELETE | 2 reads + $M + I$ | 0 | $1 + M + I$ | $O(M + I)$ | Remove ministério, membros e convites |
| `/api/v1/ministries/:id/subscription` | GET | 1 a 2 reads (RBAC) + 2 | 0 | 0 | $O(1)$ | RBAC (2) + Subscription (1) + Usage (1) |
| `/api/v1/plans` | GET | 0 reads | 0 | 0 | $O(1)$ | Retorna catálogo em memória (`plans.config.ts`) |
| `/api/v1/ministries/:id/counts` | GET | 2 (RBAC) + $S + F + A + C$ | 0 | 0 | $O(S + F + A + C)$ | **ALERTA**: Executa 4 queries de coleção para ler contagens |
| `/api/v1/ministries/:id/songs` | GET | 1 a 2 reads (RBAC) + $S$ | 0 | 0 | $O(S)$ | **ALERTA**: Lê TODAS as músicas do ministério; filtra e pagina em memória |
| `/api/v1/ministries/:id/songs/:id` | GET | 1 a 2 reads (RBAC) + 1 | 0 | 0 | $O(1)$ | Leitura direta do documento da música |
| `/api/v1/ministries/:id/songs` | POST | 2 (RBAC) + 2 (Quota) + 2 (Tx) | 2 writes (Tx) | 0 | $O(1)$ | Transação atômica: cria música e incrementa `ministry_usage` |
| `/api/v1/ministries/:id/songs/:id` | PUT | 2 (RBAC) + 2 (Quota) + 2 | 1 write | 0 | $O(1)$ | Atualiza música |
| `/api/v1/ministries/:id/songs/:id` | DELETE | 2 (RBAC) + 2 (Tx) | 1 write (Tx) | 1 delete (Tx) | $O(1)$ | Transação atômica: remove música e decrementa `ministry_usage` |
| `/api/v1/ministries/:id/folders` | GET | 2 (RBAC) + $F + (F \times 1)$ | 0 | 0 | $O(F)$ ($N+1$) | **$N+1$**: Lê $F$ pastas e para cada uma faz query em `folder_songs` |
| `/api/v1/ministries/:id/folders/:id`| GET | 2 (RBAC) + $1 + 1 + S_f$ | 0 | 0 | $O(S_f)$ ($N+1$) | **$N+1$**: Lê pasta, lê links e faz `doc.get()` para cada música individual |
| `/api/v1/ministries/:id/artists` | GET | 2 (RBAC) + $A$ | 0 | 0 | $O(A)$ | Query em `artists` filtrada por `ministry_id` |
| `/api/v1/ministries/:id/classifications` | GET | 2 (RBAC) + $C$ | 0 a 6 (seed) | 0 | $O(C)$ | Se vazio, executa 6 writes de seed inicial |
| `/api/v1/ministries/:id/schedules` | GET | 1 a 2 reads (RBAC) + $E$ | 0 | 0 | $O(E)$ | Lê todas as escalas do ministério e ordena por data em memória |
| `/api/v1/ministries/:id/schedules/:id` | GET | 1 a 2 reads (RBAC) + 1 | 0 | 0 | $O(1)$ | Leitura direta do documento da escala |
| `/api/v1/ministries/:id/schedules` | POST | 2 (RBAC) + 2 (Quota) | 1 write | 0 | $O(1)$ | Grava escala completa (participantes e timeline embutidos) |
| `/api/v1/ministries/:id/schedules/:id` | PUT | 2 (RBAC) + 2 (Quota) + 2 | 1 write | 0 | $O(1)$ | Atualiza documento da escala |
| `/api/v1/ministries/:id/schedules/:id/confirmation` | PATCH | 2 (RBAC) + 2 a 3 | 1 write | 0 | $O(1)$ | Lê escala e usuário, atualiza status no array e regrava |
| `/api/v1/ministries/:id/schedules/:id/comments` | GET | 2 (RBAC) + 1 + $L$ | 0 | 0 | $O(L)$ | Lê escala e todos os comentários associados |
| `/api/v1/ministries/:id/schedules/:id/comments` | POST | 2 (RBAC) + 2 (Quota) + 1 | 1 write | 0 | $O(1)$ | Valida existência da escala e insere comentário |
| `/api/v1/ministries/:id/members` | GET | 2 (RBAC) + $M + M_{real}$ | 0 | 0 | $O(M)$ ($N+1$) | **$N+1$**: Lê $M$ membros e faz `users.doc().get()` para cada membro real |
| `/api/v1/ministries/:id/members` (Manual) | POST | 2 (RBAC) + 2 (Quota) + 2 (Tx) | 2 writes (Tx) | 0 | $O(1)$ | Transação atômica valida quota e incrementa `ministry_usage` |
| `/api/v1/ministries/:id/members/:id` | DELETE | 2 (RBAC) + 2 (Tx) | 1 write (Tx) | 1 delete (Tx) | $O(1)$ | Transação atômica remove membro e decrementa `ministry_usage` |
| `/api/v1/ministries/join` | POST | 1 (Invite) + 1 (Min) + 3 (Tx) | 2 writes + 1 update (Tx) | 0 | $O(1)$ | Transação atômica valida quota, incrementa usage e uso do convite |
| `/api/v1/ministries/:id/teams` | GET | 2 (RBAC) + $T$ | 0 | 0 | $O(T)$ | Lê todas as equipes e ordena por data em memória |
| `/api/v1/ministries/:id/roles` | GET | 2 (RBAC) + $R$ | 0 | 0 | $O(R)$ | Lê todas as funções do ministério |
| `/api/v1/ministries/:id/schedule-templates` | GET | 2 (RBAC) + $Templates$ | 0 | 0 | $O(Templates)$ | Lê modelos de roteiro |
| `/api/v1/smart-chords` | GET | 1 scan de coleção | 0 | 0 | $O(All Chords)$ | **ALERTA**: Lê toda a coleção `smart_chords` sem filtro de tenant/user |

---

## 5. Análise de Padrões $N+1$ e Fan-out de Leituras

`[Observed from code]`

A auditoria identificou cinco pontos críticos de amplificação de leituras no backend:

### 5.1 $N+1$ na Listagem e Enriquecimento de Membros (`GET /members`)
- **Arquivo**: `backend/src/repositories/MinistryRepository.ts:334-366`
- **Mecanismo**: A query busca todos os registros da coleção `ministry_members` para o ministério ($M$ reads). Em seguida, executa um `Promise.all` iterando sobre cada membro e disparando `usersCol.doc(member.user_id).get()` para buscar nome e e-mail ($M$ reads adicionais).
- **Impacto**: Para um ministério com 100 membros, uma única chamada a `GET /members` realiza **202 leituras no Firestore** ($2 \text{ RBAC} + 100 \text{ members} + 100 \text{ users}$).

### 5.2 $N+1$ na Listagem de Pastas (`GET /folders`)
- **Arquivo**: `backend/src/repositories/RepertoireRepository.ts:293-304`
- **Mecanismo**: A rota busca as pastas (`foldersCol.where('ministry_id', '==', id)`) gerando $F$ reads. Para cada pasta, executa uma subquery `folderSongsCol.where('folder_id', '==', folder.id).get()` para contar músicas.
- **Impacto**: Um ministério com 20 pastas consome $2 + 20 + 20 = \mathbf{42 \text{ reads}}$ por requisição.

### 5.3 Fan-out no Detalhe da Pasta (`GET /folders/:folderId`)
- **Arquivo**: `backend/src/repositories/RepertoireRepository.ts:306-340`
- **Mecanismo**: Ao abrir uma pasta, o backend busca os IDs em `folder_songs` e faz um loop sequencial de `songsCol.doc(sId).get()` para cada música. Se o documento da música não possuir o objeto do artista/classificação embutido, executa leituras adicionais em `artists` e `ministry_classifications`.
- **Impacto**: Uma pasta com 30 músicas pode gerar até $2 + 1 + 1 + (30 \times 3) = \mathbf{94 \text{ reads}}$ no Firestore.

### 5.4 Scan Completo de Coleção em Músicas (`GET /songs`)
- **Arquivo**: `backend/src/repositories/RepertoireRepository.ts:35-83`
- **Mecanismo**: A query ao Firestore não utiliza limites ou filtros compostos: executa sempre `this.songsCol.where('ministry_id', '==', ministryId).get()`. Todos os filtros (busca por texto na letra/título, tom, classificação, YouTube) e a paginação (`limit`, `page`) são aplicados **em memória** pelo Node.js após trazer 100% dos documentos do banco.
- **Impacto**: Um ministério do plano Pro com 500 músicas consome **502 reads no Firestore a cada consulta ou digitação de busca**, mesmo que a tela exiba apenas 10 músicas paginadas.

### 5.5 Cálculo de Aniversariantes no Dashboard
- **Arquivo**: `web/src/components/DashboardView.tsx:127-193`
- **Mecanismo**: Ao renderizar o Dashboard, o frontend invoca `api.getMinistryMembers()`, que aciona o padrão $N+1$ descrito no item 5.1.
- **Impacto**: O simples ato de carregar a tela inicial do LouvAIO aciona leituras de todos os membros e usuários do ministério.

---

## 6. Impacto Quantitativo do Bootstrap Autenticado

`[Observed from code]` + `[Derived]`

O ciclo de vida da SPA dispara requisições HTTP e operações no Firestore em três momentos fundamentais:
1. **Login Inicial** (credenciais);
2. **Page Refresh / F5 / Deep Link**;
3. **Troca de Ministério Ativo no seletor**.

### 6.1 Fluxo de Requisições do Bootstrap

```
[ Usuário abre o app ]
       │
       ▼
 1. bootstrapAuth() ──────────────► GET /auth/me (1 read)
                                  ► GET /ministries/my-ministries (1 + M_user reads)
       │
       ▼ (Seleciona activeMinistry)
 2. loadSubscription() ───────────► GET /ministries/:id/subscription (2 RBAC + 2 Sub/Usage = 4 reads)
       │
       ▼ (Se ativo / não suspenso, dispara LOTE PARALELO)
 3. Lote Paralelo de Dados:
       ├── GET /counts ──────────► 2 RBAC + S + F + A + C reads
       ├── GET /classifications ─► 2 RBAC + C reads
       ├── GET /folders ─────────► 2 RBAC + 2F reads
       ├── GET /artists ─────────► 2 RBAC + A reads
       ├── GET /songs ───────────► 2 RBAC + S reads
       └── GET /schedules ───────► 2 RBAC + E reads
       │
       ▼ (Renderiza DashboardView)
 4. Efeito do Dashboard ──────────► GET /ministries/:id/members (2 RBAC + 2M reads)
```

### 6.2 Fórmulas Matemáticas do Bootstrap

#### Requisições HTTP por Bootstrap:
$$\text{HTTP Requests}_{\text{bootstrap}} = 2 \text{ (Sessão)} + 1 \text{ (Assinatura)} + 6 \text{ (Dados Paralelos)} + 1 \text{ (Dashboard)} = \mathbf{10 \text{ chamadas HTTP}}$$

*(Na troca de ministério sem recarregar a página, as duas chamadas de sessão não se repetem: **8 chamadas HTTP**).*

#### Leituras no Firestore por Bootstrap ($\text{Reads}_{\text{bootstrap}}$):
$$\begin{aligned}
\text{Reads}_{\text{bootstrap}} &= \underbrace{(1)}_{\text{/auth/me}} + \underbrace{(1 + M_{\text{user}})}_{\text{/my-ministries}} + \underbrace{(4)}_{\text{/subscription}} + \underbrace{(2 + S + F + A + C)}_{\text{/counts}} + \underbrace{(2 + C)}_{\text{/classifications}} \\
&\quad + \underbrace{(2 + 2F)}_{\text{/folders}} + \underbrace{(2 + A)}_{\text{/artists}} + \underbrace{(2 + S)}_{\text{/songs}} + \underbrace{(2 + E)}_{\text{/schedules}} + \underbrace{(2 + 2M)}_{\text{/members (Dashboard)}}
\end{aligned}$$

Agrupando termos constantes e variáveis ($M_{\text{user}} \approx 1$ para usuário médio):
$$\mathbf{\text{Reads}_{\text{bootstrap}} \approx 20 + 2S + 2M + 3F + 2A + 2C + E}$$

### 6.3 Exemplos Práticos de Leituras por Bootstrap (Por Plano em Capacidade Típica)

`[Derived]`

| Plano | Músicas ($S$) | Membros ($M$) | Pastas ($F$) | Artistas ($A$) | Classif. ($C$) | Escalas ($E$) | Total Reads por Bootstrap |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Free** (Típico) | 30 | 8 | 3 | 10 | 6 | 4 | **155 reads** |
| **Free** (No limite) | 50 | 10 | 5 | 15 | 7 | 8 | **207 reads** |
| **Lite** (No limite) | 100 | 20 | 8 | 25 | 7 | 12 | **360 reads** |
| **Lite+** (No limite) | 150 | 30 | 10 | 30 | 8 | 16 | **502 reads** |
| **Essential** (No limite) | 200 | 40 | 15 | 40 | 8 | 20 | **661 reads** |
| **Pro** (No limite) | 500 | 100 | 30 | 80 | 10 | 40 | **1.530 reads** |
| **Premium** (Cenário 1k) | 1.000 | 200 | 50 | 150 | 12 | 80 | **2.974 reads** |
| **Premium** (Cenário 3k) | 3.000 | 500 | 100 | 300 | 15 | 150 | **8.100 reads** |

> **Nota sobre Vazão Temporal**: Os valores acima representam **leituras concentradas durante o carregamento inicial (bootstrap)** disparadas em lote paralelo, e não devem ser interpretados como uma taxa sustentada de throughput contínuo de regime permanente.

---

## 7. Cadeia de Cálculo Unificada e Premissas de Atividade

`[Observed from code]` + `[Derived]` + `[Assumption]`

Para garantir consistência matemática e reprodutibilidade total, estabelecemos uma única cadeia determinística de cálculo:

$$\text{PREMISSAS} \longrightarrow \text{MODELO POR PLANO} \longrightarrow \text{DISTRIBUIÇÃO PONDERADA} \longrightarrow \text{100 MIN} \longrightarrow \text{1.000} \longrightarrow \text{10.000} \longrightarrow \text{100.000}$$

---

## 8. Tabela Lógica de Consumo Mensal por Ministério (Reconciliada v5.1)

`[Derived]` (Valores exatos calculados via `docs/analysis/reconcile-cost-model.mjs`)

| Plano Comercial | Membros ($M$) | Músicas ($S$) | MAU | DAU | Sessões / Mês | HTTP Req / Mês | Firestore Reads / Mês | Firestore Writes / Mês | Storage Body | Firestore DB Egress | Vercel REST Egress |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Free** | 10 | 50 | 9 | 3,5 | 112 | **2.148** | **24.720** | 120 | 266 KB | 49,5 MB | 8,8 MB |
| **Lite** | 20 | 100 | 18 | 7,0 | 224 | **4.291** | **83.020** | 220 | 479 KB | 181,0 MB | 17,5 MB |
| **Lite+** | 30 | 150 | 27 | 10,5 | 336 | **6.434** | **175.256** | 310 | 688 KB | 394,6 MB | 26,3 MB |
| **Essential** | 40 | 200 | 36 | 14,0 | 448 | **8.577** | **300.868** | 420 | 903 KB | 690,2 MB | 35,0 MB |
| **Pro** | 100 | 500 | 90 | 35,0 | 1.120 | **21.430** | **1.762.360** | 980 | 2.151 KB | 4.186,3 MB | 87,5 MB |
| **Premium (Comercial)**| 300 | 1.500 | 270 | 105,0 | 3.360 | **63.840** | **15.387.040** | 2.600 | 6.155 KB | 37.168,4 MB | 262,5 MB |
| *Legacy Analysis (1k)* | 200 | 1.000 | 180 | 70,0 | 2.240 | **42.860** | **6.889.200** | 1.950 | 4.255 KB | 16.575,8 MB | 175,0 MB |
| *Enterprise (Stress)*  | 500 | 3.000 | 450 | 175,0 | 5.600 | **107.000** | **50.850.400** | 4.800 | 12.057 KB | 123.470,7 MB | 437,5 MB |

---

## 9. Multiplicador Relativo de Carga de Leituras (Firestore Read Load Multiplier)

`[Derived]`

Tomando a carga de leitura mensal do plano **Free** como baseline (**1.0x**):

$$\text{Firestore Read Load Multiplier} = \frac{\text{Reads}_{\text{Plano}}}{\text{Reads}_{\text{Free}}}$$

```
Free:                    1.0x   ■
Lite:                    3.4x   ■■■
Lite+:                   7.1x   ■■■■■■■
Essential:              12.2x   ■■■■■■■■■■■■
Pro:                    71.3x   ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ (71,3x)
Premium (Comercial):   622.5x   (622,5x mais leituras no banco que o plano Free — 300M / 1.500S)
Legacy Scenario (1k):  278.7x   (278,7x no baseline legado de 200M / 1.000S)
Enterprise Stress (3k):2057.1x  (2.057,1x em cenário de estresse 500M / 3.000S)
```

> **Natureza do Crescimento**: No modelo otimizado, o crescimento de leituras na listagem/navegação normal é estritamente linear $O(1)$ por página via cursor. O crescimento superior nos planos maiores decorre do componente de **busca textual completa** (que varre exatamente $S$ músicas do ministério sob a decisão pré-lançamento de busca flexível em letras e títulos) multiplicado pelo maior volume de sessões gerado por bases maiores de membros.

---

## 10. Simulação de Escala do Negócio (100 a 100.000 Ministérios)

`[Derived]` a partir da distribuição ponderada comercial oficial:
- **60% Free** ($60 \times \text{Free}$)
- **10% Lite** ($10 \times \text{Lite}$)
- **8% Lite+** ($8 \times \text{Lite+}$)
- **12% Essential** ($12 \times \text{Essential}$)
- **7% Pro** ($7 \times \text{Pro}$)
- **3% Premium Comercial** ($3 \times \text{Premium 300/1.500}$)

### 10.1 Cenário Base: 100 Ministérios Ativos
- **Membros Cadastrados**: $60(10) + 10(20) + 8(30) + 12(40) + 7(100) + 3(300) = \mathbf{3.120 \text{ integrantes}}$.
- **MAU Total**: $60(9) + 10(18) + 8(27) + 12(36) + 7(90) + 3(270) = \mathbf{2.808 \text{ usuários ativos/mês}}$.
- **DAU Total**: $3.120 \times 0,35 = \mathbf{1.092 \text{ usuários ativos/dia}}$.
- **Sessões Mensais**: $1.092 \times 16 \times 2 = \mathbf{34.944 \text{ sessões/mês}}$.
- **Invocações HTTP Backend**: **666.864 requisições / mês**.
- **Firestore Reads Mensais**: **65.823.504 leituras / mês** ($\approx 65,82 \text{ Milhões}$).
- **Firestore Writes Mensais**: **31.580 escritas / mês**.
- **Armazenamento de Documentos (Body)**: **68,19 MB**.
- **Firestore DB Egress**: **159,75 GB / mês**.
- **Vercel Bandwidth Total (FOT + FDT)**: **155,76 GB / mês**.

### 10.2 Tabela de Escala Linear Estrita

`[Derived]` (A escala preserva aditividade estrita: 1.000 = $10\times$, 10.000 = $100\times$, 100.000 = $1.000\times$):

| Métrica Agregada | 100 Ministérios | 1.000 Ministérios ($10\times$) | 10.000 Ministérios ($100\times$) | 100.000 Ministérios ($1.000\times$) |
|---|:---:|:---:|:---:|:---:|
| **Membros Cadastrados** | 3.120 | 31.200 | 312.000 | 3.120.000 |
| **MAU Estimado** | 2.808 | 28.080 | 280.800 | 2.808.000 |
| **DAU Estimado** | 1.092 | 10.920 | 109.200 | 1.092.000 |
| **Sessões Mensais** | 34.944 | 349.440 | 3.494.400 | 34.944.000 |
| **Invocações HTTP Backend** | **666.864 / mês** | **6,67 Milhões / mês** | **66,69 Milhões / mês** | **666,86 Milhões / mês** |
| **Firestore Reads Mensais** | **65,82 Milhões / mês**| **658,24 Milhões / mês**| **6,58 Bilhões / mês** | **65,82 Bilhões / mês** |
| **Firestore Writes Mensais**| **31.580 / mês** | **315.800 / mês** | **3,16 Milhões / mês** | **31,58 Milhões / mês** |
| **Armazenamento Estruturado** | 68,19 MB | 681,90 MB | 6,82 GB | 68,19 GB |
| **Firestore DB Egress** | 159,75 GB / mês | 1,60 TB / mês | 15,98 TB / mês | 159,75 TB / mês |
| **Vercel Bandwidth (FOT+FDT)** | 155,76 GB / mês | 1,56 TB / mês | 15,58 TB / mês | 155,76 TB / mês |

---

## 11. Análise Reconciliada de Participação do Plano Free e Pagos

`[Derived]`

Na distribuição de 60% Free e 40% Pagantes (Lite a Premium 300/1.500):

| Segmento Comercial | % Base Organizações | % Reads Firestore | % Invocações HTTP | % Writes Firestore | % DB Egress | % MAU Total |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Plano Free (60 min)** | **60,0%** | **2,25%** | **19,33%** | **22,80%** | **1,86%** | **19,23%** |
| **Planos Pagos (40 min)** | **40,0%** | **97,75%** | **80,67%** | **77,20%** | **98,14%** | **80,77%** |
| *↳ Pro + Premium (10 min)*| *10,0%* | ***88,74%*** | ***51,19%*** | ***47,43%*** | ***88,17%*** | ***51,28%*** |

### Conclusões sobre a Distribuição de Carga:
1. **Participação de Leituras do Free (2,25%)**: O plano Free representa apenas 2,25% de todas as leituras de banco de dados do sistema.
2. **Participação de HTTP (19,33%) e MAU (19,23%) do Free**: Como responde por 60% das organizações, o Free representa cerca de 19% do tráfego web e dos usuários ativos.
3. **Concentração nos Planos Pro e Premium**: Apenas **10% dos ministérios (Pro + Premium Comercial) respondem por 88,7% de todas as leituras de banco de dados** e **88,2% de todo o egress do Firestore**, justificando economicamente as mensalidades de R$ 89,90 e R$ 214,90.*78,33 Milhões / mês**| **783,35 Milhões / mês**| **7,83 Bilhões / mês** | **78,33 Bilhões / mês** |
| **Firestore Writes Mensais**| **29.630 / mês** | **296.300 / mês** | **2,96 Milhões / mês** | **29,63 Milhões / mês** |
| **Armazenamento Estruturado** | 63,39 MB | 633,91 MB | 6,34 GB | 63,39 GB |
| **Bandwidth de API** | 23,52 GB / mês | 235,22 GB / mês | 2,35 TB / mês | 23,52 TB / mês |

---

## 11. Análise Reconciliada de Participação do Plano Free e Pagos

`[Derived]`

Na distribuição de 60% Free e 40% Pagantes (Lite a Premium):

| Segmento Comercial | % Base Organizações | % Reads Firestore | % Invocações HTTP | % Writes Firestore | % Bandwidth API | % MAU Total |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Plano Free (60 min)** | **60,0%** | **3,39%** | **21,31%** | **24,30%** | **9,71%** | **21,28%** |
| **Planos Pagos (40 min)** | **40,0%** | **96,61%** | **78,69%** | **75,70%** | **90,29%** | **78,72%** |
| *↳ Pro + Premium (10 min)*| *10,0%* | ***82,29%*** | ***46,06%*** | ***42,90%*** | ***69,46%*** | ***46,10%*** |

### Conclusões sobre a Distribuição de Carga:
1. **Participação de Leituras do Free (3,39%)**: O plano Free gera uma fração mínima da carga de banco de dados do sistema, pois possui limites rígidos de membros (10) e músicas (50).
2. **Participação de HTTP (21,31%) e MAU (21,28%) do Free**: Como o Free representa 60% dos ministérios, ele responde por cerca de 21% de todas as sessões, requisições HTTP e usuários ativos mensais.
3. **Concentração Crítica nos Planos Pro e Premium**: Apenas **10% dos ministérios (Pro + Premium) respondem por mais de 82% de todas as leituras de banco de dados** e quase **70% de todo o bandwidth da API**.

---

## 12. Ranking dos Maiores Cost Drivers da Arquitetura

`[Derived]` a partir do código

```
┌────┬───────────────────────────────────────────┬────────────────────────────────────────┐
│ Rank│ Componente / Operação                     │ Impacto Assintótico / Evidência        │
├────┼───────────────────────────────────────────┼────────────────────────────────────────┤
│ 1º │ Leitura Integral de Músicas (GET /songs)  │ O(S) por busca e bootstrap (sem pagina)│
│ 2º │ Bootstrap Autenticado Lote Paralelo       │ O(2S + 2M + 3F + 2A + 2C) por login/F5 │
│ 3º │ Firestore Network Egress (Internet Out)   │ O(Egress Bytes) transportando NoSQL doc│
│ 4º │ N+1 de Membros no Dashboard e Listagem    │ O(2M) via enrich em doc users          │
│ 5º │ N+1 de Pastas e Detalhes de Pasta         │ O(F + S_f) por visualização de pastas  │
│ 6º │ Middleware RBAC em Mutações e Leituras    │ 1 a 2 reads fixos em TODA requisição   │
│ 7º │ Chat de Escalas sem Paginação             │ O(L) ao abrir chat de escala           │
│ 8º │ Vercel Serverless Function & Edge         │ Invocations, CPU e Edge Requests       │
│ 9º │ Transações Atômicas de Quota/Usage        │ 2 writes/tx em criação/remoção         │
│ 10º│ Firebase Auth MAU                         │ Risco em caso de upgrade Identity Plat.│
└────┴───────────────────────────────────────────┴────────────────────────────────────────┘
```

---

## 13. Análises Especializadas por Módulo

### 13.1 Avaliação do `ministry_usage` e Contenção de Escrita
- **Tradeoff de Design** `[Observed from code]`: O documento materializado `ministry_usage/{ministryId}` permite validação de quotas em $O(1)$ atômico sem varreduras de coleção.
- **Risco de Contenção e Concorrência** `[Derived]` / `[External technical verification]`:
  - A capacidade de atualização concorrente de um único documento no Cloud Firestore depende da carga, latência de rede e contention de transações. Sob alta concorrência de escritas no mesmo documento, transações concorrentes entram em retry automático.
  - Na rotina normal de um ministério de louvor (cadastros eventuais de músicas ou voluntários), a frequência de escrita em `ministry_usage` é de poucas operações por semana, sendo o risco de colisão **baixo para o uso típico**.
  - **Cenário de Atenção**: Importações em lote (ex: importação de 200 músicas em paralelo via script) ou múltiplos voluntários aceitando convite simultaneamente no mesmo segundo podem gerar contention/retries.

### 13.2 Smart Chords (Cifras Inteligentes)
- **Carga de Servidor e Computação** `[Observed from code]`:
  - Transposição de tom (`rawToVisual`, `visualToRaw`, `transposeChord`) é **100% executada no navegador do usuário** (`web/src/utils/smart_chord.ts`). Zero consumo de CPU no backend.
  - Exportação de PDF é feita inteiramente no cliente via biblioteca CDN `html2pdf.js`. Zero consumo de CPU/servidor ou storage para geração de PDF.
- **Persistência**: Documentos de cifras inteligentes armazenam texto plano com tags de acordes (`[C]`, `[G]`), ocupando entre 1,5 KB e 5 KB por documento. Impacto de armazenamento e leitura baixo.

### 13.3 Chat e Comentários de Escala
- **Ausência de Paginação** `[Observed from code]`: `GET /schedules/:id/comments` retorna todos os comentários da escala (`ScheduleRepository.ts:209`).
- **Comportamento de Escala**: Escalas com equipes ativas (100+ mensagens) passarão a ler 100+ documentos por abertura do modal de chat. Como não há listeners em tempo real (`onSnapshot`) nem polling ativo, o consumo ocorre estritamente sob demanda.

### 13.4 Modelagem de Storage e Índices
`[Derived]` + `[Assumption]`
- **Tamanhos Médios de Documentos (Body Storage)**:
  - `songs`: $\approx 3,5 \text{ KB}$ (título, artista, letra, cifras, links externos).
  - `schedules`: $\approx 4,0 \text{ KB}$ (arrays embutidos de participantes, timeline e cores).
  - `ministry_members`: $\approx 1,2 \text{ KB}$.
  - `schedule_comments`: $\approx 0,5 \text{ KB}$.
  - `folders`, `artists`, `classifications`: $\approx 0,8 \text{ KB}$.
- **Storage de Índices**: Os valores de armazenamento apresentados referem-se ao **tamanho do corpo dos documentos (Body Storage)**. Índices compostos e automáticos do Firestore acrescentam overhead de armazenamento não incluído nessa estimativa básica.

### 13.5 Divergência entre Database Egress e API Bandwidth
`[Derived]` + `[Assumption]`
- **Por que Database Egress $>$ API Bandwidth**:
  - Em rotas como `GET /songs`, o backend Node.js lê **100% dos documentos do Firestore** (ex: 500 músicas $\times 3,5\text{ KB} = 1,75\text{ MB}$ de dados serializados com protobuf via internet do Google Cloud para a Vercel).
  - Após carregar em memória, o backend filtra, extrai apenas os campos necessários da página ativa (10 músicas) e devolve um JSON enxuto ao cliente ($\approx 35\text{ KB}$ de REST Response).
  - Portanto, o **Egress do Firestore é materialmente maior que o Bandwidth de entrega da API**.
- **Modelagem de Sensibilidade de Egress (100 Ministérios)**:
  - **Low Egress**: $\mathbf{105,62\text{ GB / mês}}$ (documentos enxutos, média de 1,5 KB/doc).
  - **Medium Egress (Baseline)**: $\mathbf{211,24\text{ GB / mês}}$ (documentos típicos de 3,0 KB + overhead de protocolo).
  - **High Egress**: $\mathbf{422,48\text{ GB / mês}}$ (documentos extensos de 5,0 KB com letras completas + cifras ricas).

---

## 14. Métricas de Produção Necessárias (`Production Metrics Required`)

Para calibrar as hipóteses (`[Assumption]`) deste modelo com dados reais quando o LouvAIO estiver em produção, deveremos instrumentar:

1. `app.http.requests_per_ministry_day`: Quantidade média de chamadas por ministério ativo.
2. `firestore.reads_per_session`: Leituras reais consumidas em cada sessão de usuário.
3. `firestore.writes_per_ministry_month`: Escritas reais por plano.
4. `app.user.dau_mau_ratio`: Proporção real de engajamento diário vs mensal.
5. `app.user.sessions_per_day`: Média de sessões por integrante ativo.
6. `app.repertoire.average_songs_per_ministry`: Média e percentis P50/P90 de músicas cadastradas.
7. `app.ministry.average_members_per_ministry`: Média de integrantes por ministério.
8. `app.schedules.average_schedules_per_month`: Quantidade de cultos e escalas criadas.
9. `http.response.payload_size_bytes`: Tamanho real transferido por endpoint (P50/P95).
10. `serverless.function_duration_ms`: Duração de computação de cada endpoint.
11. `serverless.cold_start_count`: Frequência de inicializações a frio na Vercel.
12. `app.errors.quota_blocked_count`: Frequência de bloqueios legítimos de quota por plano.

---

## 15. Gatilhos Quantitativos para Revisão Arquitetural (`Architecture Review Thresholds`)

`[Derived]`

Recomenda-se revisitar as decisões arquiteturais quando os seguintes gatilhos operacionais forem atingidos:

| Gatilho / Threshold | Métrica Observada | Ação / Revisão Arquitetural Recomendada |
|---|---|---|
| **Volume de Músicas no Pro/Premium** | $S > 150$ músicas no ministério | Implementar **paginação server-side** (`startAfter`/`limit`) e busca indexada em `GET /songs`. |
| **Leituras por Bootstrap** | $\text{Reads}_{\text{bootstrap}} > 500$ leituras | Substituir carregamento paralelo por **SWR / React Query / Cache em memória** no frontend. |
| **Enriquecimento de Membros** | $M > 40$ integrantes | Desnormalizar `name` e `email` diretamente em `ministry_members` para eliminar o $N+1$ em `users`. |
| **Contagem de Recursos em /counts** | $S+F+A+C > 200$ | Materializar contadores de pastas e artistas em `ministry_usage` para tornar `/counts` uma operação $O(1)$. |
| **Contenção em ministry_usage** | Erros de concorrência transacional $> 0,1\%$ das mutações | Implementar sharding de contadores ou fila de sincronização. |
| **Chat de Escalas Volumoso** | $L > 50$ comentários na escala | Adicionar paginação e limite padrão de 30 mensagens mais recentes em `/comments`. |
| **Custo de Reads / Faturamento** | Custo de banco $> 15\%$ da receita do plano | Introduzir camada de cache intermediário (Edge / Redis / Cloud Run). |

---

## 16. O que NÃO Otimizar Prematuramente

Para preservar a simplicidade e a disciplina de escopo da arquitetura atual, **NÃO devem ser adotadas nesta etapa**:
- Migração de banco para PostgreSQL / Supabase / MongoDB.
- Introdução de instâncias Redis / Memcached.
- Migração de infraestrutura da Vercel para Docker / Kubernetes / Cloud Run.
- Criação de filas assíncronas (BullMQ, SQS, RabbitMQ).
- Background workers para reconciliação de dados.
- Reescrita completa do Express para frameworks de micro-roteamento.

---

## 17. Model Validation

- **Data da Validação**: 2026-08-29.
- **Ambiente de Teste**: Node.js v22 via scripts `docs/analysis/reconcile-cost-model.mjs` e `docs/analysis/calculate-pricing.mjs`.
- **Inconsistências Identificadas e Corrigidas na Rodada Final**:
  1. *Firestore Internet Egress*: Corrigido para a tabela oficial progressiva por faixas marginais ($0,12/GB para 0-1 TB; $0,11/GB para 1-10 TB; $0,08/GB para 10 TB+).
  2. *Vercel Functions Included Allocations*: Incluídas as franquias de 1M invocações, 4 CPU-horas e 360 GB-horas de memória antes da apuração de uso faturável.
  3. *Ordem de Faturamento Vercel Pro*: Aplicada a dedução do crédito mensal de $20 sobre a soma dos usos excedentes faturáveis de infraestrutura.
  4. *Participação do Free e Pro/Premium*: Recalculada sob as perspectivas de custo marginal puro (Free = 4,16%; Pro+Premium = 81,18%) e custo real alocado no cenário (Free = 20,93%; Pro+Premium = 59,80%).
  5. *Status de Regiões e Identity Platform*: Claramente delimitados como UNKNOWN e modelados em cenários isolados.

---

## 18. Modelo de Custo Monetário Reconciliado (`Monetary Cost Model`)

`[Observed Pricing]` + `[Derived]`

**Data da Cotação Oficial**: 2026-08-29  
**Taxa de Câmbio de Referência**: **1 USD = 5,19 BRL** (Mid-market quote em 2026-08-29)  
**Fontes Oficiais**: Google Cloud Firestore Pricing, VPC Network Pricing, Firebase Identity Platform Pricing, Vercel Pricing.

---

### 18.1 Tabela B — Custo Total por Cenário de Escala

#### Cenário A: Região US (`us-central1`) — Auth SEM Identity Platform (Padrão Gratuito) — Baseline Oficial

| Componente de Custo | 100 Ministérios | 1.000 Ministérios | 10.000 Ministérios | 100.000 Ministérios |
|---|:---:|:---:|:---:|:---:|
| **Firestore Reads** | $23,05 (R$ 119,63) | $234,55 (R$ 1.217,34) | $2.349,60 (R$ 12.194,42) | $23.500,03 (R$ 121.965,17) |
| **Firestore Writes** | $0,00 (Franquia) | $0,00 (Franquia) | $2,13 (R$ 11,04) | $26,13 (R$ 135,60) |
| **Firestore Storage (Body)**| $0,00 (Franquia) | $0,00 (Franquia) | $0,94 (R$ 4,86) | $10,96 (R$ 56,90) |
| **Firestore Egress (Internet)**| $24,15 (R$ 125,33) | $231,26 (R$ 1.200,26) | $1.689,92 (R$ 8.770,69) | $16.899,20 (R$ 87.706,85) |
| **Firebase Auth (MAU)** | **$0,00 (Gratuito)** | **$0,00 (Gratuito)** | **$0,00 (Gratuito)** | **$0,00 (Gratuito)** |
| **Vercel Compute (Bruto)**| $0,00 (Franquia) | $14,99 (Bruto) | $187,81 (Bruto) | $1.915,96 (Bruto) |
| **Vercel Fast Origin (FOT)**| $0,81 (Bruto) | $13,51 (Bruto) | $140,54 (Bruto) | $1.410,75 (Bruto) |
| **Vercel Fast Data (FDT)** | $0,00 (Franquia 1TB)| $0,00 (Franquia 1TB)| $202,84 (Bruto) | $3.378,37 (Bruto) |
| **Vercel Edge Requests** | $0,00 (Franquia 10M)| $0,00 (Franquia 10M)| $100,96 (Bruto) | $1.189,55 (Bruto) |
| **Vercel Uso Faturável Total**| $0,81 | $28,51 | $632,15 | $7.894,62 |
| **Vercel Overage Efetivo** | $0,00 (Crédito $20)| $8,51 (R$ 44,18) | $612,15 (R$ 3.177,05) | $7.874,62 (R$ 40.869,29) |
| **Vercel Base Fee (1 seat)**| $20,00 (R$ 103,80) | $20,00 (R$ 103,80) | $20,00 (R$ 103,80) | $20,00 (R$ 103,80) |
| **TOTAL VERCEL** | **$20,00 (R$ 103,80)** | **$28,51 (R$ 147,98)** | **$632,15 (R$ 3.280,85)** | **$7.894,62 (R$ 40.973,09)** |
| **Custo Fixo Total** | **$20,00 (R$ 103,80)** | **$20,00 (R$ 103,80)** | **$20,00 (R$ 103,80)** | **$20,00 (R$ 103,80)** |
| **Custo Variável Total** | **$46,60 (R$ 241,85)** | **$474,32 (R$ 2.461,74)**| **$4.654,74 (R$ 24.158,08)**| **$48.310,95 (R$ 250.733,81)**|
| **CUSTO TOTAL MENSAL (A)** | **$66,60 (R$ 345,68)** | **$494,32 (R$ 2.565,54)**| **$4.674,74 (R$ 24.261,88)**| **$48.330,95 (R$ 250.837,61)**|
| **Custo Médio / Ministério**| **$0,67 (R$ 3,46)** | **$0,49 (R$ 2,57)** | **$0,47 (R$ 2,43)** | **$0,48 (R$ 2,51)** |
| **Custo Médio / MAU** | **$0,026 (R$ 0,136)** | **$0,019 (R$ 0,101)** | **$0,018 (R$ 0,096)** | **$0,019 (R$ 0,099)** |

---

#### Comparativo dos 4 Cenários em Escala

| Cenário de Infraestrutura | 100 Ministérios | 1.000 Ministérios | 10.000 Ministérios | 100.000 Ministérios |
|---|:---:|:---:|:---:|:---:|
| **A. US Firestore + Auth Padrão** | **$67,20 (R$ 348,77)** | **$494,32 (R$ 2.565,54)** | **$4.674,74 (R$ 24.261,88)** | **$48.330,95 (R$ 250.837,61)** |
| **B. US Firestore + Identity Platform** | **$67,20 (R$ 348,77)** | **$494,32 (R$ 2.565,54)** | **$5.657,22 (R$ 29.360,95)** | **$57.667,55 (R$ 299.294,61)** |
| **C. São Paulo + Auth Padrão** | **$84,18 (R$ 436,89)** | **$680,48 (R$ 3.531,70)** | **$6.693,67 (R$ 34.740,13)** | **$64.153,90 (R$ 332.958,72)** |
| **D. São Paulo + Identity Platform** | **$84,18 (R$ 436,89)** | **$680,48 (R$ 3.531,70)** | **$7.676,15 (R$ 39.839,20)** | **$73.490,50 (R$ 381.415,70)** |

---

### 18.2 Tabela C — Custos Unitários por Plano Comercial (Marginal vs. Alocado)

`[Derived]` (Cenário A — US Firestore sem Identity Platform, 100 ministérios):

- **Marginal Resource Cost**: Custo gerado pelo ministério aplicando preços de lista unitários brutos sem dedução de franquias globais de free tier.
- **Scenario Allocated Cost**: Atribuição da fatura REAL do cenário de 100 ministérios ($67,20 / mês), considerando o benefício das franquias compartilhadas e o rateio igualitário do custo fixo de $20 da Vercel (+R$ 1,04/mês por organização).

| Plano Comercial | Membros ($M$) | Músicas ($S$) | Marginal Resource USD | Marginal Resource BRL | Scenario Allocated USD | Scenario Allocated BRL |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Free** | 10 | 50 | **$0,0391** | **R$ 0,20 / mês** | **$0,2323** | **R$ 1,21 / mês** |
| **Lite** | 20 | 100 | **$0,1198** | **R$ 0,62 / mês** | **$0,2991** | **R$ 1,55 / mês** |
| **Lite+** | 30 | 150 | **$0,2447** | **R$ 1,27 / mês** | **$0,4023** | **R$ 2,09 / mês** |
| **Essential** | 40 | 200 | **$0,4255** | **R$ 2,21 / mês** | **$0,5518** | **R$ 2,86 / mês** |
| **Pro** | 100 | 500 | **$2,3950** | **R$ 12,43 / mês** | **$2,1802** | **R$ 11,32 / mês** |
| **Premium (1k)**| 200 | 1.000 | **$9,6626** | **R$ 50,15 / mês** | **$8,1891** | **R$ 42,50 / mês** |
| **Premium (3k)**| 500 | 3.000 | **$73,1016** | **R$ 379,40 / mês**| — | — |

---

### 18.3 Participação de Free vs. Pagantes e Pro/Premium

`[Derived]` (Reconciliado deterministicamente em 100 Ministérios):

1. **Pela Ótica do Consumo Marginal de Recursos (Marginal Resource Share)**:
   - **Plano Free (60 min)**: **4,16% do total** ($2,35 USD de $56,36).
   - **Planos Pagos (40 min)**: **95,84% do total** ($54,01 USD de $56,36).
   - **Pro + Premium (10 min)**: **81,18% do total** ($45,75 USD de $56,36).
2. **Pela Ótica da Fatura Real Alocada (Allocated Invoice Share)**:
   - **Plano Free (60 min)**: **20,93% da fatura** ($13,94 USD / R$ 72,35).
   - **Planos Pagos (40 min)**: **79,07% da fatura** ($52,66 USD / R$ 273,31).
   - **Pro + Premium (10 min)**: **59,80% da fatura** ($39,83 USD / R$ 206,72).

---

### 18.4 Tabela D — Pisos Técnicos de Custo (`Technical Cost Floors`)

`[Derived]` (Guardrails matemáticos baseados no consumo de recursos):

- **Variable/Marginal Floor**: $\text{Custo Marginal Direto} / \text{Target Margin}$ (cobre exclusivamente o consumo direto de recursos).
- **Scenario Allocated Floor**: $\text{Custo Alocado (100 min)} / \text{Target Margin}$ (cobre o custo efetivo real incluindo franquias e rateio fixo).

| Plano Comercial | Meta: 20% Infra (Direct / Alloc) | Meta: 15% Infra (Direct / Alloc) | Meta: 10% Infra (Direct / Alloc) | Meta: 5% Infra (Direct / Alloc) |
|---|:---:|:---:|:---:|:---:|
| **Lite** (20M / 100S) | R$ 2,80 / **R$ 6,60** | R$ 3,73 / **R$ 8,80** | R$ 5,60 / **R$ 13,20** | R$ 11,20 / **R$ 26,40** |
| **Lite+** (30M / 150S) | R$ 5,65 / **R$ 8,05** | R$ 7,53 / **R$ 10,73** | R$ 11,30 / **R$ 16,10** | R$ 22,60 / **R$ 32,20** |
| **Essential** (40M / 200S) | R$ 9,45 / **R$ 9,90** | R$ 12,60 / **R$ 13,20** | R$ 18,90 / **R$ 19,80** | R$ 37,80 / **R$ 39,60** |
| **Pro** (100M / 500S) | R$ 52,05 / **R$ 31,30** | R$ 69,40 / **R$ 41,73** | R$ 104,10 / **R$ 62,60** | R$ 208,20 / **R$ 125,20** |
| **Premium** (300M / 1.5kS) | R$ 440,55 / **R$ 226,05** | R$ 587,40 / **R$ 301,40** | R$ 881,10 / **R$ 452,10** | R$ 1.762,20 / **R$ 904,20** |

---

### 18.5 Tabela E — Custo Marginal do Add-on de +10 Membros

`[Derived]` (Cada +10 membros adiciona 112 sessões mensais):

| Plano Base | Leituras Adicionais | Firestore DB Egress | Vercel REST Egress | Compute (Low / Med / High) | Custo Marginal USD (Med) | Custo Marginal BRL (Med) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Essential** ($S=200$) | 76.496 reads | 171,7 MB | 8,8 MB | $0,0038 / $0,0068 / $0,0122 | **$0,0861 / mês** | **R$ 0,45 / mês** |
| **Pro** ($S=500$) | 177.296 reads | 429,2 MB | 8,8 MB | $0,0038 / $0,0068 / $0,0122 | **$0,1828 / mês** | **R$ 0,95 / mês** |
| **Premium** ($S=1.500$) | 513.296 reads | 1.287,3 MB | 8,8 MB | $0,0038 / $0,0068 / $0,0122 | **$0,5059 / mês** | **R$ 2,63 / mês** |

---

## 19. Parâmetros de Entrada para a Precificação Comercial (`Commercial Pricing Baseline Inputs`)

Esta seção consolida os dados técnicos de entrada para a modelagem comercial oficial:

### 19.1 Tabela de Entradas Técnicas por Plano (Versão 5.1 Reconciliada)

| Plano Comercial | Quota ($M / S$) | MAU Médio | Custo Direto / Marginal (Med) | Custo Alocado (100 min) | Custo Alocado (1.000 min) | Custo Alocado (10.000 min) | Add-on +10 Membros (Custo Marginal) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Free** | 10M / 50S | 9 | **R$ 0,19 / mês** | **R$ 1,13 / mês** | **R$ 0,26 / mês** | **R$ 0,21 / mês** | — |
| **Lite** | 20M / 100S | 18 | **R$ 0,56 / mês** | **R$ 1,32 / mês** | **R$ 0,59 / mês** | **R$ 0,56 / mês** | — |
| **Lite+** | 30M / 150S | 27 | **R$ 1,13 / mês** | **R$ 1,61 / mês** | **R$ 1,09 / mês** | **R$ 1,06 / mês** | — |
| **Essential** | 40M / 200S | 36 | **R$ 1,89 / mês** | **R$ 1,98 / mês** | **R$ 1,77 / mês** | **R$ 1,73 / mês** | **+R$ 0,45 / mês** |
| **Pro** | 100M / 500S | 90 | **R$ 10,41 / mês** | **R$ 6,26 / mês** | **R$ 9,20 / mês** | **R$ 9,31 / mês** | **+R$ 0,95 / mês** |
| **Premium** | 300M / 1.500S | 270 | **R$ 88,11 / mês** | **R$ 45,21 / mês** | **R$ 77,50 / mês** | **R$ 78,51 / mês** | **+R$ 2,63 / mês** |

---

## 20. Comparativo Financeiro de Unit Economics e Escala (Direct vs. Allocated)

`[Derived]` (Valores deterministicamente calculados via `docs/analysis/calculate-pricing.mjs` e `simulate-commercial-pricing.mjs`)

### 20.1 Tabela Consolidada de Unit Economics por Plano

| Plano Comercial | Preço Oficial v1 | Direct Infrastructure Cost | Direct Infrastructure Ratio | Contribution after Direct Modeled Infra | Scenario Allocated Cost (100 min) | Scenario Allocated Ratio | Contribution after Scenario-Allocated Infra |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Lite** (20M / 100S) | R$ 14,90 | **R$ 0,56 / mês** | **3,76%** | **R$ 14,34 / mês** | **R$ 1,32 / mês** | **8,86%** | **R$ 13,58 / mês** |
| **Lite+** (30M / 150S) | R$ 24,90 | **R$ 1,13 / mês** | **4,54%** | **R$ 23,77 / mês** | **R$ 1,61 / mês** | **6,47%** | **R$ 23,29 / mês** |
| **Essential** (40M / 200S) | R$ 34,90 | **R$ 1,89 / mês** | **5,42%** | **R$ 33,01 / mês** | **R$ 1,98 / mês** | **5,67%** | **R$ 32,92 / mês** |
| **Pro** (100M / 500S) | R$ 89,90 | **R$ 10,41 / mês** | **11,58%** | **R$ 79,49 / mês** | **R$ 6,26 / mês** | **6,96%** | **R$ 83,64 / mês** |
| **Premium** (300M / 1.5kS) | R$ 214,90 | **R$ 88,11 / mês** | **41,00%** | **R$ 126,79 / mês** | **R$ 45,21 / mês** | **21,04%** | **R$ 169,69 / mês** |

> **Advertência Terminológica Rigorosa**: As métricas de *Contribution after Direct Modeled Infrastructure* ($\text{Preço} - \text{Direct Infra}$) e *Contribution after Scenario-Allocated Infrastructure* ($\text{Preço} - \text{Allocated Infra}$) refletem **exclusivamente a dedução de custos modelados de computação, banco e rede**. Elas **NÃO representam** lucro líquido, lucro operacional, EBITDA, margem contábil ou margem de contribuição final, pois despesas com gateway de pagamento (cartão/PIX), tributos e impostos, marketing, folha de pagamento e suporte ainda não foram deduzidas.

---

### 20.2 Comparativo de Escala Agregada (100 a 100.000 Ministérios)

`[Derived]` (Cenário A / Medium Compute / Medium Egress com Mix Comercial Oficial incluindo Premium 300/1.500):

| Escala de Ministérios | Métrica de Infraestrutura | Arquitetura Original (Antes — Mix Antigo) | Arquitetura Final Reconciliada (Depois — Mix Oficial) | Variação Global |
|---|---|:---:|:---:|:---:|
| **100 Ministérios** | **Firestore Reads**<br>**Firestore DB Egress**<br>**Vercel Bandwidth**<br>**Custo Total USD**<br>**Custo Total BRL**<br>**Custo Médio / Min** | 78,33 Milhões<br>206,28 GB<br>23,52 GB<br>$67,20 / mês<br>R$ 348,77 / mês<br>**R$ 3,49 / mês** | **65,82 Milhões**<br>**159,75 GB**<br>**155,76 GB**<br>**$57,27 / mês**<br>**R$ 297,22 / mês**<br>**R$ 2,97 / mês** | **-16,0% Reads**<br>**-22,6% DB Egress**<br>—<br>**-14,8% USD**<br>**-14,8% BRL**<br>**-14,8% / min** |
| **1.000 Ministérios** | **Firestore Reads**<br>**Firestore DB Egress**<br>**Vercel Bandwidth**<br>**Custo Total USD**<br>**Custo Total BRL**<br>**Custo Médio / Min** | 783,35 Milhões<br>2.062,81 GB<br>235,22 GB<br>$517,73 / mês<br>R$ 2.687,02 / mês<br>**R$ 2,69 / mês** | **658,24 Milhões**<br>**1.597,53 GB**<br>**1.557,63 GB**<br>**$575,56 / mês**<br>**R$ 2.987,17 / mês**<br>**R$ 2,99 / mês** | **-16,0% Reads**<br>**-22,6% DB Egress**<br>—<br>Mix Oficial (300M/1.5kS)<br>**R$ 2,99 / min** |
| **10.000 Ministérios** | **Firestore Reads**<br>**Firestore DB Egress**<br>**Vercel Bandwidth**<br>**Custo Total USD**<br>**Custo Total BRL**<br>**Custo Médio / Min** | 7,83 Bilhões<br>20.628,13 GB<br>2,35 TB<br>$4.945,86 / mês<br>R$ 25.669,01 / mês<br>**R$ 2,57 / mês** | **6,58 Bilhões**<br>**15.975,31 GB**<br>**15.576,33 GB**<br>**$7.013,92 / mês**<br>**R$ 36.402,27 / mês**<br>**R$ 3,64 / mês** | **-16,0% Reads**<br>**-22,6% DB Egress**<br>—<br>Escala Real com 300M/1.5kS<br>**R$ 3,64 / min** |
| **100.000 Ministérios** | **Firestore Reads**<br>**Firestore DB Egress**<br>**Vercel Bandwidth**<br>**Custo Total USD**<br>**Custo Total BRL**<br>**Custo Médio / Min** | 78,33 Bilhões<br>206.281,25 GB<br>23,52 TB<br>$49.227,15 / mês<br>R$ 255.488,91 / mês<br>**R$ 2,55 / mês** | **65,82 Bilhões**<br>**159.753,13 GB**<br>**155.763,28 GB**<br>**$68.879,77 / mês**<br>**R$ 357.485,99 / mês**<br>**R$ 3,57 / mês** | **-16,0% Reads**<br>**-22,6% DB Egress**<br>—<br>Escala Real com 300M/1.5kS<br>**R$ 3,57 / min** |

---

## 21. Análise de Sensibilidade de Busca do Plano Premium (300 Membros / 1.500 Músicas / R$ 214,90)

`[Derived]` (3.360 sessões/mês em 300 membros ativos; componente não-busca derivado em **R$ 2,82 / mês**):

| Frequência de Busca / Sessão | Buscas / Mês | Reads de Busca / Mês | Custo Busca (BRL) | Custo Não-Busca Direto (BRL) | Custo Total Direto Infra (BRL) | Direct Infra Ratio | Contribution after Direct Modeled Infra |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **1 busca / sessão** | 3.360 | 5.040.000 | R$ 28,43 | R$ 2,82 | **R$ 31,25 / mês** | **14,54%** | **R$ 183,65 / mês** |
| **2 buscas / sessão** | 6.720 | 10.080.000 | R$ 56,86 | R$ 2,82 | **R$ 59,68 / mês** | **27,77%** | **R$ 155,22 / mês** |
| **3 buscas / sessão** (Baseline) | 10.080 | 15.120.000 | R$ 85,28 | R$ 2,82 | **R$ 88,11 / mês** | **41,00%** | **R$ 126,79 / mês** |
| **4 buscas / sessão** | 13.440 | 20.160.000 | R$ 113,71 | R$ 2,82 | **R$ 116,53 / mês** | **54,23%** | **R$ 98,37 / mês** |
| **5 buscas / sessão** | 16.800 | 25.200.000 | R$ 142,14 | R$ 2,82 | **R$ 144,96 / mês** | **67,45%** | **R$ 69,94 / mês** |
| **10 buscas / sessão** | 33.600 | 50.400.000 | R$ 284,28 | R$ 2,82 | **R$ 287,10 / mês** | **133,60%** | **-R$ 72,20 / mês** (Déficit operacional de infra) |

### Diagnóstico de Viabilidade da Busca:
- **Faixa Segura (1 a 3 buscas/sessão)**: A infraestrutura direta consome entre **14,5% e 41,0%** da mensalidade, gerando uma contribuição positiva robusta de **R$ 183,65 a R$ 126,79** por organização Premium.
- **Faixa de Alerta (4 a 5 buscas/sessão)**: A infraestrutura direta ultrapassa 50% da receita do plano, reduzindo a contribuição para menos de R$ 100,00.
- **Faixa Crítica (10 buscas/sessão)**: O custo direto de infraestrutura excede o preço comercial (133,6%), gerando déficit de infra de -R$ 72,20/mês. Isso estabelece o gatilho formal para acionamento de motor de busca externo (Typesense / Strategy D) ou busca por prefixo (Strategy B).

---

## 22. Governança Operacional e Triggers de Revisão da Busca (Search Roadmap Triggers)

1. **Pre-Production Staging Gate**: Medição empírica de latência real sob carga (P50, P95, P99) em bases de 500, 1.500 e 3.000 músicas quando o ambiente de staging com Firestore dedicado estiver ativo.
2. **Search Revision Triggers**:
   - **Latência**: P95 de busca superior a 400ms em produção.
   - **Faturamento**: Componente de leituras de busca ultrapassar 50% do total da fatura do Firestore.
   - **Utilização**: Média de buscas por sessão observada nos logs superior a 4 buscas/sessão no plano Premium.
   - **Aproximação de Quota**: Organizações Premium acumulando mais de 1.200 músicas ativas.
   - **Migração Planejada**: Ativação da **Strategy B (Prefix Search Indexado)** ou **Strategy D (Typesense)** conforme o gatilho atingido.


