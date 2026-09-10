# ExecPlan: LouvAIO — Administrative Consolidated Availability View (Phase 6D-1)

- **Status**: [COMPLETED]
- **Data de Início**: 2026-09-10
- **Data de Conclusão**: 2026-09-10
- **Fase**: Phase 6D-1 (Administrative Consolidated Availability View)
- **Escopo**: Implementação da visualização administrativa consolidada de indisponibilidade de integrantes para planejamento de escalas. Escopo estritamente READ-ONLY. Cobre novo composite index no Firestore, rota canônica GET /api/v1/ministries/:ministryId/availability (e alias groups), RBAC (admin), validação de intervalo civil de até 90 dias, lookback de 90 dias com algoritmo de paginação segura contra falsos vazios pós-filtro de overlap, enriquecimento em lote de nomes dos integrantes sem vazamento cross-tenant, omissão absoluta do campo reason, cliente web em api.ts e interface responsiva AdminAvailabilityView.tsx com presets temporais e imunidade a race conditions.

---

## 1. Contexto e Objetivos

O LouvAIO possui autodeclaração self-service de indisponibilidade (Phase 6B) e alertas em tempo de escala (Phase 6C).
A Phase 6D-1 entrega ao líder/administrador a visibilidade consolidada do ministério para responder:
"Quais integrantes estão indisponíveis neste período de planejamento?"

### Decisões de Domínio Aprovadas:
1. **Privacidade Absoluta**: O campo reason (motivo pessoal) é estritamente omitido da resposta da API e da UI consolidada.
2. **Janela de Planejamento**: Máximo de 90 dias civis inclusivos (from e to no formato YYYY-MM-DD). Intervalo interno semi-aberto [fromT00:00:00, (to+1)T00:00:00).
3. **Paginação com Filtro Residual**: Consulta candidatos no Firestore com lookback de 90 dias e pagina continuamente até preencher o limite solicitado ou exaurir os registros, evitando páginas vazias intermediárias.
4. **Teto de Segurança**: Varredura máxima de 1000 candidatos por requisição para prevenir DoS/custo abusivo, falhando com AVAILABILITY_QUERY_TOO_LARGE.
5. **Cursor Context-Bound**: Token de continuação vinculado a ministryId, janela temporal e filtro de membro.
6. **Enriquecimento sem N+1**: Busca em lote de nomes em ministry_members e users com validação estrita de tenant.
7. **Estritamente Read-Only**: Zero ações de criação, edição ou exclusão (reservadas para Phase 6D-2).

---

## 2. Pacotes de Trabalho Concluídos

- [x] **WP1: Índice Firestore e Tipos de Domínio**
  - Adicionado composite index em `backend/firestore.indexes.json` (`member_unavailabilities`: `ministry_id ASC, starts_at ASC, __name__ ASC`).
  - Definidos schemas Zod e DTOs em `availability.types.ts`.

- [x] **WP2: Repositório e Algoritmo de Paginação (`AvailabilityRepository.ts`)**
  - Implementado método `listConsolidated` com paginação contínua e filtro residual de sobreposição.
  - Implementado encode/decode de cursor com contexto estrito.
  - Aplicado teto de segurança de 1000 candidatos (`AVAILABILITY_QUERY_TOO_LARGE`).

- [x] **WP3: Serviço, Enriquecimento e Controller (`availability.service.ts`, `availability.controller.ts`, `availability.routes.ts`)**
  - Normalização e validação de período (`to - from <= 90 dias`, `INVALID_DATE_RANGE`, `MAX_PLANNING_WINDOW_EXCEEDED`).
  - Validação de isolamento do integrante quando `memberId` fornecido (`MEMBER_NOT_FOUND` fail-closed 404).
  - Enriquecimento de nomes em lote com guarda multi-tenant via `db.getAll`.
  - Rota `GET /availability` com `requireMinistryRole('admin')` e alias seguro `groups`.

- [x] **WP4: Cliente API e Tipagens Web (`web/src/types.ts`, `web/src/api.ts`)**
  - Tipos `ConsolidatedAvailabilityItem` e `ConsolidatedAvailabilityResponse` sem `reason`.
  - Método `api.getConsolidatedAvailability`.

- [x] **WP5: Componente de Interface (`AdminAvailabilityView.tsx` e `MinistryView.tsx`)**
  - Sub-página administrativa `AdminAvailabilityView` com estados: loading, error/retry, empty, query-too-large e loaded.
  - Presets (7d, 15d, 30d, mês atual) e intervalo personalizado até 90 dias.
  - Filtro opcional por integrante e botão "Carregar mais".
  - Entrada no card de administração em `MinistryView`.
  - Proteção contra race conditions via geração de requisição.

- [x] **WP6: Testes Automatizados e Homologação**
  - Testes unitários e de integração de backend (`availability.admin.feature.test.ts` e `availability-time.test.ts`).
  - Testes de frontend (`AdminAvailabilityView.test.tsx`).
  - Validação de não-regressão de 6B e 6C: 42 test files no backend (1569/1569 passando) e 18 test files no web (218/218 passando).
  - Builds de produção de backend e web verdes (`tsc`, `vite build`).

---

## 3. Evidências Finais
- Backend Build: `tsc` exit code 0.
- Backend Tests: 42 arquivos, 1569 testes aprovados (0 falhas).
- Web Build: `tsc && vite build` exit code 0.
- Web Tests: 18 arquivos, 218 testes aprovados (0 falhas).
