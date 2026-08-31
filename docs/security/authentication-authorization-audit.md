# Relatório de Auditoria de Autenticação e Autorização — LouvAIO

Data da Auditoria: 2026-08-29
Escopo: Backend API Express, Repositories Firestore, Middlewares de Segurança, RBAC e Políticas de Tokens

---

## 1. Sumário Executivo

Foi realizada uma auditoria abrangente de segurança em todos os módulos e camadas do Praise App (LouvAIO), cobrindo autenticação, verificação criptográfica de tokens, controle de acesso baseado em papéis (RBAC), prevenção contra Insecure Direct Object References (IDOR), integridade de contas e mitigação de privilégios órfãos.

Todas as vulnerabilidades e brechas identificadas durante a auditoria foram corrigidas e validadas no código.

---

## 2. Vulnerabilidades Identificadas e Correções Aplicadas

### SEC-001: Autenticação Insegura por E-mail sem Senha (Login Fallback Bypass)
- **Gravidade**: Crítica (P0)
- **Causa Raiz**: O método `verifyPassword` em `UserRepository.ts` continha um bloco de fallback que, se a API Key do Identity Toolkit não estivesse configurada ou se houvesse erro de rede, buscava o usuário por e-mail no Firestore e retornava sucesso na autenticação sem verificar a senha.
- **Correção**: O fallback foi integralmente removido. A validação via Identity Toolkit REST API tornou-se obrigatória e estrita. Sem credenciais válidas com verificação criptográfica, o login é rejeitado com `401 Credenciais inválidas`.

### SEC-002: Acesso Anônimo e IDOR em Cifras Inteligentes (`smart_chords`)
- **Gravidade**: Alta (P1)
- **Causa Raiz**: As rotas de `/api/smart-chords` não continham o middleware `authenticate`. O controller utilizava `req.user?.id || 'anonymous'`, e `SmartChordRepository.getSmartChords` executava `db.collection('smart_chords').get()`, despejando cifras de todos os usuários do sistema.
- **Correção**:
  - Adicionado `router.use(authenticate)` em `smart_chord.routes.ts`;
  - `SmartChordRepository.getSmartChords` passou a filtrar estritamente por `where('user_id', '==', userId)`;
  - `getSmartChordById`, `updateSmartChord` e `deleteSmartChord` agora validam a propriedade do documento (`chord.user_id === userId`), retornando `404` caso o registro pertença a outro usuário.

### SEC-003: IDOR e Quebra de Isolamento Multitenant em Repertório (`repertoire`)
- **Gravidade**: Alta (P1)
- **Causa Raiz**: Em `RepertoireRepository.ts`, métodos de leitura e mutação direta por ID (`getSongById`, `updateSong`, `deleteSong`, `getFolderById`, `updateFolder`, `deleteFolder`, `updateArtist`, `deleteArtist`, `updateClassification`, `deleteClassification`) não exigiam nem checavam `ministry_id`. Um usuário autenticado em qualquer ministério poderia alterar ou excluir músicas e pastas de outro ministério informando o respectivo ID.
- **Correção**:
  - Todos os métodos por ID foram refatorados para receber obrigatoriamente `ministryId` e validar `record.ministry_id === ministryId`;
  - Em `addSongToFolder`, foi implementada a dupla validação de que tanto a pasta quanto a música pertencem ao ministério da requisição;
  - Proteção contra mass assignment adicionada em todas as mutações (`delete updateData.id`, `delete updateData.ministry_id`, `delete updateData.user_id`).

### SEC-004: IDOR em Escalas e Comentários (`schedules`)
- **Gravidade**: Alta (P1)
- **Causa Raiz**: `ScheduleRepository.ts` realizava `getScheduleById(id)`, `updateSchedule(id)` e `deleteSchedule(id)` sem checar `schedule.ministry_id === ministryId`. Comentários também eram consultados e inseridos sem checagem de tenant na escala.
- **Correção**:
  - `getScheduleById`, `updateSchedule`, `deleteSchedule`, `getScheduleComments` e `addScheduleComment` agora exigem `ministryId` e validam o pertencimento do recurso ao ministério antes de qualquer operação;
  - Ao excluir uma escala, comentários órfãos associados a ela são limpos transacionalmente.

### SEC-005: Bypass de Confirmação de Presença e Alteração Indevida de Participante
- **Gravidade**: Alta (P1)
- **Causa Raiz**: Em `updateParticipantConfirmation`, o backend consultava a coleção legada `group_members` em vez de `ministry_members`. Se o usuário autenticado não fosse encontrado na lista de participantes, o código selecionava o participante de índice 0 (`participants[0]`) e marcava presença no lugar dele.
- **Correção**:
  - Migrado para consulta estrita em `ministry_members`;
  - Removido o fallback de índice 0. Caso o usuário não faça parte da escala como participante, uma exceção `403 Você não está listado como participante desta escala.` é gerada imediatamente.

### SEC-006: Duplicação de Liturgias e Falta de Tenant Scope
- **Gravidade**: Média (P2)
- **Causa Raiz**: `LiturgyService.updateLiturgy` chamava `createLiturgy`, gerando novos documentos em vez de atualizar o existente. Além disso, `getLiturgyById` e `deleteLiturgy` não validavam `group_id`.
- **Correção**:
  - Implementado `updateLiturgy` real em `LiturgyRepository.ts` que atualiza os campos da liturgia e sincroniza os itens em `liturgy_items`;
  - Validação estrita de `liturgy.group_id === groupId` em leitura, edição e exclusão.

### SEC-007: Account Takeover via Edição de Integrantes
- **Gravidade**: Alta (P1)
- **Causa Raiz**: Em `MinistryRepository.updateMemberDetails`, se um administrador de ministério alterasse o e-mail ou a senha de um integrante registrado, o backend invocava `authAdmin.updateUser(userId, { email, password })`, permitindo que o administrador tomasse posse da conta global do usuário no Firebase Auth.
- **Correção**:
  - Bloqueada a alteração de senhas e e-mails de terceiros no Firebase Auth via rotas de ministério;
  - Contas reais (`!memberData.is_manual`) têm apenas seus metadados locais de ministério atualizados; alterações de credenciais exigem fluxo autenticado do próprio usuário via `/api/auth/change-password`.

### SEC-008: Ausência da Regra do Último Administrador (Orphaned Ministries)
- **Gravidade**: Média (P2)
- **Causa Raiz**: Administradores podiam ser rebaixados para `member` ou removidos do ministério mesmo quando eram o único administrador restante, deixando o ministério sem gestão administrativa.
- **Correção**:
  - Implementada checagem atômica da contagem de administradores em `updateMemberDetails`, `removeMember` e `leaveMinistry`. O último administrador não pode ser removido, rebaixado ou sair sem antes promover outro integrante a `admin`.

### SEC-009: Vazamento de Informações Sensíveis em `/api/diag` e Headers HTTP Ausentes
- **Gravidade**: Baixa (P3)
- **Causa Raiz**: `/api/diag` expunha `projectId` do Firebase e `defaultMinistryId`. A aplicação não incluía headers de segurança HTTP (OWASP Secure Headers).
- **Correção**:
  - Em ambiente de produção (`NODE_ENV === 'production'`), `/api/diag` foi sanitizado para expor apenas `{ status: 'ok', timestamp }`;
  - Adicionados middlewares de segurança no Express: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin` e CORS configurável via `CORS_ORIGIN`.

### SEC-010: JWT Secret Fraco em Produção
- **Gravidade**: Crítica (P0)
- **Causa Raiz**: O fallback para `unified-secret-key-for-jwt-tokens-change-in-production` era aceito indistintamente em qualquer ambiente.
- **Correção**: Validação Zod em `unifiedConfig.ts` agora rejeita a inicialização do servidor com erro fatal se `JWT_SECRET` for mantido no valor default quando `NODE_ENV === 'production'`.

### SEC-011: Validação Unificada e Assíncrona de Tokens
- **Gravidade**: Média (P2)
- **Causa Raiz**: O middleware `authenticate` tentava apenas verificar JWTs locais com `jwt.verify`, rejeitando ou aceitando tokens sem suporte consistente a Firebase ID Tokens emitidos pelo client SDK.
- **Correção**: `UserRepository.verifyToken` implementado com suporte dual robusto: verifica primeiro se o token é um JWT assinado pelo backend e, alternativamente, valida como Firebase ID Token via `authAdmin.verifyIdToken(...)`.

---

## 3. Conclusão da Auditoria

O sistema LouvAIO encontra-se com todas as rotas e repositórios protegidos por autenticação criptográfica, isolamento multitenant estrito, RBAC robusto e validação de quotas em transações Firestore.
