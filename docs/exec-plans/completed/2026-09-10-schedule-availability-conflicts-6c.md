# ExecPlan: LouvAIO — Schedule Availability Conflict Detection & Warnings (Phase 6C)

- **Status**: `COMPLETED`
- **Data de Início**: 2026-09-10
- **Data de Conclusão**: 2026-09-10
- **Fase**: `Phase 6C (Schedule Availability Conflict Detection & Warnings)`
- **Escopo**: Implementação canônica do motor de detecção de conflitos entre janelas de Escalas (Schedules) e períodos de Indisponibilidade de Integrantes (MemberUnavailability), suporte a duração de escalas (`duration_minutes`), consulta otimizada e paginada no Cloud Firestore sem falso-negativo por limite de query, normalização autoritativa de IDs de participantes, endpoint administrativo de conferência coletiva (`POST /availability/check-conflicts`) com omissão estrita do motivo (`reason`), cliente API web e integração não-bloqueante na interface de criação/edição de escalas com proteção estrita contra race conditions.

---

## 1. Contexto e Objetivos

Com a Fase 6B homologada, os membros possuem uma interface self-service para registrar indisponibilidades civis no formato `[starts_at, ends_at)` (`YYYY-MM-DDTHH:mm:ss`, sem `Z`).
Na Fase 6C, o sistema permite que administradores e líderes de louvor visualizem alertas de conflito em tempo hábil ao montar ou editar escalas, sem bloquear o salvamento.

### Decisões de Domínio Aprovadas:
1. **Duração da Escala (`duration_minutes` / `durationMinutes`)**:
   - Inteiro positivo: mín 15, máx 1440 minutos (24 horas). Padrão do produto: 120 minutos (2 horas).
   - Novas escalas persistem explicitamente `duration_minutes: 120` se omitido.
   - Escalas legadas existentes sem duração usam fallback não-mutante `LEGACY_SCHEDULE_DURATION_MINUTES = 120`.
2. **Janela Temporal Civil da Escala**:
   - Intervalo semi-aberto `[starts_at, ends_at)` onde `starts_at = YYYY-MM-DDTHH:mm:ss` e `ends_at = starts_at + duration_minutes`.
   - Relógio civil puro: sem conversão UTC, sem sufixo `Z`, sem inferência de timezone.
3. **Regra Canônica de Sobreposição**:
   - `unavailability.starts_at < schedule.ends_at AND unavailability.ends_at > schedule.starts_at`.
   - Adjacência exata de borda (ex: 18:00–19:00 e 19:00–21:00) NÃO é conflito.
4. **Normalização Autoritativa de Identidades**:
   - IDs de participantes heterogêneos (document ID de `ministry_members` ou Firebase Auth `user_id`) são mapeados para IDs canônicos de `ministry_members` no escopo do ministério ativo.
5. **Privacidade Estrita**:
   - Resposta do endpoint coletivo NUNCA inclui o campo `reason` (motivo pessoal).
6. **Alertas Não-Bloqueantes**:
   - Conflitos são estritamente avisos informativos; o botão "Salvar Escala" nunca é desabilitado por conflito ou por falha na consulta de disponibilidade.

---

## 2. Pacotes de Trabalho (Work Packages)

- [x] **WP1: Duração e Modelo de Escalas (`ScheduleRecord`, `ScheduleRepository`, schemas)**
  - Adicionado `duration_minutes` em `ScheduleRecord`.
  - Atualizado `createScheduleSchema` e `updateScheduleSchema` com `durationMinutes` (15..1440, default 120).
  - Persistido `duration_minutes: 120` por padrão em novas escalas.
  - Suportado fallback seguro para escalas legadas.

- [x] **WP2: Motor de Conflitos Puro (`conflict-engine.ts` e testes unitários)**
  - Cálculo de janela civil `[starts_at, ends_at)` para escalas com suporte a virada de meia-noite, virada de mês, virada de ano e anos bissextos.
  - Avaliação de sobreposição de intervalos e cálculo do lookback de 90 dias.
  - Testes unitários puros cobrindo todos os cenários temporais e independência de fuso (`conflict-engine.test.ts` - 24/24 passing).

- [x] **WP3: Normalização de Participantes e Repositório (`AvailabilityRepository.ts`)**
  - Resolução de IDs de participantes (document ID ou user_id) escopada ao ministério.
  - Método `findConflictCandidates` com consulta Firestore bounded pelo lookback de 90 dias e paginação determinística (`starts_at ASC, __name__ ASC`) para eliminar qualquer falso-negativo por limite de página.
  - Declaração do índice composto correspondente em `backend/firestore.indexes.json`.

- [x] **WP4: Serviço, Controller e Rotas (`availability.service.ts`, `availability.controller.ts`, `availability.routes.ts`)**
  - Orquestração de normalização, busca de candidatos, cálculo de sobreposição e omissão do `reason`.
  - Endpoint `POST /api/v1/ministries/:ministryId/availability/check-conflicts` (com alias `/groups/:groupId/...`).
  - RBAC: `authenticate` + `requireMinistryRole('admin')`.
  - Schema de validação Zod (`checkAvailabilityConflictsSchema`).

- [x] **WP5: Cliente API e Tipagens Web (`web/src/types.ts`, `web/src/api.ts`)**
  - Tipagens `ConflictScheduleWindow`, `ParticipantConflictItem`, `AvailabilityConflictResult`, `CheckAvailabilityConflictsPayload`.
  - Método `api.checkAvailabilityConflicts(ministryId, payload)`.
  - Atualização do tipo `ScheduleItem` com `durationMinutes`.

- [x] **WP6: Interface do Usuário (`CreateScheduleModal.tsx`)**
  - Seletor de duração da escala (presets de 1h a 3h e customizado).
  - Consulta com debounce (300ms) ao preencher data, hora, duração e participantes.
  - Proteção contra race condition via token de geração (`conflictGenRef`) e reset na troca de ministério.
  - Exibição visual de alertas nos integrantes conflitantes (sem exibir motivo).
  - Garantia de que o salvamento da escala nunca é bloqueado por conflitos ou por erro na API.

- [x] **WP7: Testes Automatizados e Homologação de Regressão**
  - Testes de backend: duração de escalas, motor de conflito, normalização de IDs, paginação sem falso negativo, RBAC e omissão de motivo.
  - Testes de frontend: renderização de avisos, preservação do botão salvar, debounce e descarte de respostas obsoletas.
  - Suíte completa de testes de backend e frontend green (1509 backend + 205 web passing).
  - Builds TypeScript backend e web green.
  - Verificação de diff (`git diff --check`).
