# ExecPlan: LouvAIO — Manual Member Availability Management (Phase 6D-2)

- **Status**: [COMPLETED]
- **Data de Início**: 2026-09-10
- **Data de Conclusão**: 2026-09-10
- **Fase**: Phase 6D-2 (Manual Member Availability Management)
- **Escopo**: Implementação de CRUD administrativo delegado de indisponibilidades (`member_unavailabilities`) exclusivamente para integrantes manuais do ministério (`is_manual === true` E `user_id == null`). Inclui separação estrita de Actor (`req.user.id`) e Subject (`member_id`), metadados de auditoria (`management_source = 'admin_manual'`, `created_by_user_id`, `updated_by_user_id`), persistência de `user_id: null`, bloqueio estrito anti-takeover para membros autenticados (`AUTHENTICATED_MEMBER_MUTATION_PROHIBITED` 403), rotas REST canônicas `/members/:memberId`, cliente web em `api.ts`, componente modal `ManualMemberAvailabilityModal.tsx`, integração em `MinistryView.tsx`, compatibilidade com detecção de conflitos (6C) e visão consolidada (6D-1), e zero criação de novos índices no Firestore.

---

## 1. Contexto e Objetivos

O LouvAIO possui autodeclaração self-service de indisponibilidade (Phase 6B), alertas em tempo de escala (Phase 6C) e visão consolidada de leitura para líderes (Phase 6D-1).
Contudo, ministérios frequentemente possuem integrantes manuais (convidados, voluntários sem login, músicos externos) que não possuem conta no app (`user_id == null`).
A Phase 6D-2 permite que administradores gerenciem períodos de indisponibilidade para esses integrantes manuais sem comprometer a fronteira de propriedade dos integrantes autenticados.

### Decisões de Domínio Aprovadas:
1. **Critério Estrito de Elegibilidade Manual**:
   `targetMembership.is_manual === true` E `targetMembership.user_id == null`. Ambos são mandatórios.
2. **Proteção Anti-Takeover de Membros Autenticados**:
   Se o integrante for autenticado (`is_manual !== true` OU `user_id !== null`), mutações administrativas são sumariamente rejeitadas com HTTP 403 `AUTHENTICATED_MEMBER_MUTATION_PROHIBITED`. Administradores NUNCA mutam registros de membros autenticados.
3. **Separação Actor vs Subject**:
   - Subject: `ministry_id = activeMinistry`, `member_id = targetMemberId`, `user_id = null`.
   - Actor: `user_id = req.user.id` (gravado em `created_by_user_id` e `updated_by_user_id`).
   - O ator nunca substitui a titularidade do integrante, e o cliente nunca controla esses campos.
4. **Modelo de Persistência e Auditoria**:
   - `user_id: string | null` (registros manuais gravam `user_id: null`).
   - `management_source: 'admin_manual'`.
   - `created_by_user_id`: imutável após criação.
   - `updated_by_user_id`: atualizado com o UID do admin na alteração.
   - Registros legados/self-service permanecem intactos sem necessidade de migração.
5. **Fronteira de Privacidade do Motivo (Reason)**:
   - Em 6D-2, o motivo é visível para o admin na gestão do membro manual (pois o admin é o operador operacional).
   - Em 6C e 6D-1, o motivo permanece categoricamente omitido.
6. **Zero Novos Índices no Firestore**:
   - Listagens por membro utilizam o índice composto existente de 6B (`ministry_id ASC, member_id ASC, starts_at DESC, __name__ DESC`).
7. **UX e Segurança contra Concorrência**:
   - Modal acessível `ManualMemberAvailabilityModal.tsx` acionado pelo menu de opções do membro manual em `MinistryView.tsx`.
   - Imunidade a alternância de ministério e alternância de membro via generation tokens.

---

## 2. Pacotes de Trabalho

- [x] **WP1: Tipos de Domínio e Repositório (`AvailabilityRepository.ts`, `availability.types.ts`)**
  - Atualizar `MemberUnavailabilityRecord` com `user_id: string | null`, `management_source`, `created_by_user_id`, `updated_by_user_id`.
  - Implementar métodos dedicados no repositório: `createManualUnavailability`, `getManualById`, `updateManualUnavailability`, `deleteManualUnavailability`.
- [x] **WP2: Camada de Serviço e Validações (`availability.service.ts`)**
  - Implementar `resolveEligibleManualMembership(ministryId, memberId)` com fail-closed (404 para not found / cross-tenant, 403 para autenticado).
  - Implementar métodos de CRUD manual com normalização temporal civil idêntica a 6B e derivation server-side de campos de auditoria e titularidade.
- [x] **WP3: Controller e Rotas Express (`availability.controller.ts`, `availability.routes.ts`)**
  - Implementar handlers e rotas `/members/:memberId` e `/members/:memberId/:id` protegidas por `requireMinistryRole('admin')` e validação Zod.
- [x] **WP4: Cliente Web e Tipos (`web/src/types.ts`, `web/src/api.ts`)**
  - Adicionar métodos de API em `api.ts` para CRUD de indisponibilidade de membro manual.
- [x] **WP5: Interface Web (`ManualMemberAvailabilityModal.tsx`, `MinistryView.tsx`)**
  - Criar `ManualMemberAvailabilityModal.tsx` com lista, formulário (dia inteiro / horários), confirmação de exclusão e race-safety.
  - Integrar ação 'Gerenciar indisponibilidade' no menu do membro manual em `MinistryView.tsx`.
- [x] **WP6: Testes Automatizados e Homologação**
  - Testes de backend: elegibilidade, anti-takeover, IDOR, CRUD, auditoria, forge de corpo, compatibilidade 6C e 6D-1.
  - Testes de frontend: renderização de ação, modal, formulário, exclusão, tenant-switch e member-switch.
  - Validação de suítes de regressão completas de backend e web.