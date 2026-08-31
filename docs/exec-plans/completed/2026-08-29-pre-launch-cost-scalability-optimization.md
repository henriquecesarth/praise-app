# ExecPlan: Otimização e Hardening Pré-Lançamento de Custos e Escalabilidade (Pre-Launch Cost & Scalability Optimization)

**Status**: Completed  
**Author**: Antigravity  
**Created**: 2026-08-29  
**Completed**: 2026-08-29 (Extensão de Hardening Final Concluída)  
**Technical Baseline**: `docs/operations/cost-model.md` (v3.2.0), `docs/operations/pre-launch-performance-baseline.md` (v3.0.0), `firebase.json` e `backend/firestore.indexes.json`  

---

## 1. Resumo Executivo das Entregas e Hardening Arquitetural

Nesta frente de otimização pré-lançamento, foram implementadas e formalmente verificadas as seguintes soluções arquiteturais no backend e frontend:

1. **Substituição Definitiva de Offset por Cursor-Based Pagination (`GET /songs`)**:
   - Eliminado o uso de `.offset()` (que faturava a leitura de todos os documentos pulados no Firestore).
   - Implementado cursor opaco baseado em timestamp e ID (`startAfter(updated_at, doc_id)`) com ordenação composta estável (`updated_at DESC, __name__ DESC`).
   - Validação de segurança anti-injeção no cursor: rejeita tokens pertencentes a outro ministério (`CROSS_TENANT_CURSOR_REJECTED`) e garante scoping autoritativo no Firestore (`where ministry_id == authorizedMinistryId`).
   - Diferenciação precisa de métricas de faturamento: Page Size (20), Documentos Buscados (até 21 via `limit + 1`), Document Reads (21 em páginas intermediárias / $\le 20$ na última página), 0 Index Entry Reads e $O(1)$ custo assintótico por página.
2. **Projeção Enxuta `SongSummary` + Firestore `query.select(...)` (Caso B)**:
   - A listagem geral `GET /songs` utiliza `query.select(...)` diretamente no Firestore para transferir apenas campos de cabeçalho e metadados, omitindo `lyrics`, cifras e notas longas tanto no tráfego Firestore $\to$ Vercel (-90%) quanto no tráfego Vercel $\to$ Browser (-90%).
   - A entidade integral é recuperada estritamente no detalhe `GET /songs/:songId` sem `.select()`.
3. **Derivação Exata das Agregações `count().get()`**:
   - `RepertoireRepository.getCounts`: Executa 4 agregações `.count().get()`, faturadas oficialmente a 1 read por lote de até 1.000 entradas de índice por agregação (Total: 4 a 6 reads por requisição).
4. **Clarificação Formal de Billed Reads vs. RPCs no `db.getAll()`**:
   - `MinistryRepository.getMinistryMembers` e `RepertoireRepository.getFolders`: Reduz round-trips de $N$ para 1 chamada RPC via `db.getAll()`, documentando formalmente no modelo de custos que o Firestore ainda fatura $M$ document reads.
5. **Comentários de Escalas (`GET /schedules/:id/comments`) com Suporte a Histórico Completo**:
   - Limite inicial das 50 mensagens mais recentes com ordenação indexada e inversão cronológica no retorno.
   - Suporte a `olderCursor` para paginação de mensagens anteriores sem full collection scans.
6. **Declaração Formal de Índices e Configuração Versionada no `firebase.json`**:
   - Criados `firebase.json` (raiz) e `backend/firebase.json` apontando deterministicamente para `firestore.indexes.json`.
   - Em `NODE_ENV === 'production'`, queries sem índice não executam fallback silencioso para varredura em memória; lançam erro observável `INDEX_REQUIRED_OR_QUERY_ERROR`.
7. **Auditoria de Bootstrap Autenticado no Frontend (`App.tsx`)**:
   - A navegação inicial para o Dashboard carrega apenas contadores, classificações e escalas do ministério.
   - Coleções de repertório (músicas, pastas, artistas) são carregadas sob demanda ao acessar as abas correspondentes.
8. **Modelagem Formal de Busca Textual (Search Decision 1 Aprovada)**:
   - Registrada a decisão: **Strategy A (Full Scan Bounded com Debounce de 300ms)** adotada no pré-lançamento.
   - Justificativa: No plano Premium (1.500 músicas / R$ 214,90), o custo mensal de 3 buscas/sessão é de R$ 15,69 (7,3% da mensalidade), garantindo margem bruta de 92,7% e latência de ~150ms. Roadmap pós-lançamento estabelecido para Strategy B (prefixo) ou Strategy D (Typesense).

---

## 2. Status dos Milestones

- [x] **Milestone 1: Baseline e Query Map**
  - Mapeamento detalhado em `docs/operations/pre-launch-performance-baseline.md`.
- [x] **Milestone 2: Paginação por Cursor e Projeção `SongSummary` com `.select()`**
  - Substituição de `.offset()` por `startAfter` estável, DTO `SongSummary` e projeção server-side.
- [x] **Milestone 3: Agregações `count().get()` e Bootstrap Sob Demanda**
  - Contadores com agregação exata e lazy-loading de rotas em `App.tsx`.
- [x] **Milestone 4: Batch Lookups via `db.getAll()`**
  - Eliminação de N+1 em membros e pastas.
- [x] **Milestone 5: Comentários de Escalas com `olderCursor`**
  - Histórico paginado e ordenação cronológica.
- [x] **Milestone 6: Declaração de Índices (`firestore.indexes.json` + `firebase.json`) e Remoção de Fallback Silencioso**
  - Índices compostos versionados e erro estruturado em produção.
- [x] **Milestone 7: Recálculo do Modelo de Custos e Scripts Determinísticos**
  - `reconcile-cost-model.mjs`, `calculate-pricing.mjs` e `simulate-commercial-pricing.mjs` atualizados com matemática exata.
- [x] **Milestone 8: Validação Integral de Testes e Fechamento**
  - **Vitest Backend**: 56 testes passando (100%).
  - **Vitest Web**: 23 testes passando (100%).
  - **Playwright E2E**: 61 testes passando (100% dos executáveis em 12 projetos mobile/desktop light e dark), 11 skipped (offline fallback).
  - **Builds**: Backend (`tsc`) e Web (`vite build` + `pwa`) finalizados com código 0.
