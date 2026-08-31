# ExecPlan: LouvAIO — Authentication & Authorization Security Hardening

- **Status**: `COMPLETED`
- **Data de Início**: 2026-08-29
- **Data de Conclusão**: 2026-08-29
- **Fase**: `Authentication & Authorization Security Hardening (Pre-Launch)`
- **Escopo**: Auditoria de segurança e blindagem de ponta a ponta em autenticação, tokens, sessões, autorização, RBAC, isolamento multi-tenant por ministry, IDOR em recursos por ID, convites, administração, proteção contra privilege escalation, mass assignment, validação de entradas, segurança de caches/PWA e tratamento de erros de segurança.

---

## 1. Contexto e Objetivos

O LouvAIO é uma plataforma multi-tenant para ministérios de louvor executada em Express + Firebase (Admin SDK / Firestore / Auth) com cliente PWA em React/Vite.

### Princípio Fundamental de Segurança
> **Authentication answers WHO.**
> **Authorization answers WHAT THIS USER MAY DO TO THIS RESOURCE.**
> Ocultar elementos na interface (frontend hiding) **NÃO** é controle de segurança. O backend é a fronteira mandatória e exclusiva de autorização.

### Metas Atingidas:
1. **Eliminar todos os caminhos de Auth Bypass (P0)**: Corrigido `UserRepository.verifyPassword` para que jamais autentique usuários sem validação criptográfica de credenciais no Identity Toolkit REST API.
2. **Blindar o Isolamento Multi-Tenant e Eliminar IDOR (P0)**: Todas as operações em recursos por ID (`songs`, `folders`, `artists`, `classifications`, `schedules`, `comments`, `liturgies`, `smart_chords`, `teams`, `roles`, `templates`, `members`, `invites`) validam estritamente o pertencimento ao `ministry_id` autorizado do contexto autenticado.
3. **Proteger Rotas Abertas / Smart Chords (P0)**: Adicionado `authenticate` e controle estrito de ownership em `/smart-chords`.
4. **Fechar Inconsistências de Liturgia e Agendamento (P0/P1)**: Corrigido `LiturgyService.updateLiturgy` com atualização real de itens e `ScheduleRepository.updateParticipantConfirmation` com migração para `ministry_members` e rejeição `403` caso o usuário não seja participante (eliminado fallback arbitrário).
5. **Mitigar Privilege Escalation & Mass Assignment (P1)**: Proibida a alteração de senhas/e-mails de terceiros no Firebase Auth via update de membro de ministério; implementada regra de "Last Admin" em rebaixamento, remoção e saída de ministério.
6. **Desativar Vazamento de Diagnóstico em Produção (P1)**: Sanitizado `/api/diag` em ambiente de produção e adicionados security headers OWASP.
7. **Documentação e Matriz de Autorização**: Criados `docs/security/authentication-authorization-audit.md` e `docs/security/authorization-matrix.md`.
8. **Cobertura Abrangente de Testes de Segurança**: Criada suíte automatizada cobrindo acesso não autenticado, tokens inválidos, cross-tenant reads/mutations, RBAC denial, remoção de membros e integridade de tenant (71 testes backend + 23 testes unitários web + 61 testes E2E Playwright passando).

---

## 2. Inventário de Achados de Segurança (Security Findings Matrix)

| ID | Severidade | Área | Vulnerabilidade / Causa Raiz | Ação de Remediação | Status |
|---|:---:|---|---|---|:---:|
| **SEC-001** | **P0** | Auth | `UserRepository.verifyPassword`: Fallback sem API Key buscava usuário por email e retornava sucesso sem validar senha. | Remover fallback inseguro; exigir validação criptográfica via Identity Toolkit; rejeitar login sem credencial válida. | `RESOLVED` |
| **SEC-002** | **P0** | Smart Chords | `/api/v1/smart-chords`: Rotas sem middleware `authenticate`; controller usa `'anonymous'` e repository faz dump de toda a coleção sem filtrar `user_id`. | Aplicar `authenticate` em todas as rotas de smart chords; filtrar por `user_id` e validar ownership em get/update/delete. | `RESOLVED` |
| **SEC-003** | **P0** | Repertoire IDOR | `RepertoireRepository`: `getSongById`, `updateSong`, `deleteSong`, `getFolderById`, `updateFolder`, `deleteFolder`, `updateArtist`, `deleteArtist` não validavam `ministry_id`. | Exigir `ministryId` em todos os métodos de repositório de repertório e validar que o recurso pertence ao tenant autorizado antes de qualquer leitura ou mutação. | `RESOLVED` |
| **SEC-004** | **P0** | Schedules IDOR | `ScheduleRepository`: `getScheduleById`, `updateSchedule`, `deleteSchedule`, `getCommentsBySchedule`, `addComment` não verificavam `ministry_id`. | Escopar todas as consultas e mutações de escala por `ministry_id` autorizado; rejeitar qualquer ID de escala de outro ministério com 404 seguro. | `RESOLVED` |
| **SEC-005** | **P0** | Schedule Confirmation | `ScheduleRepository.updateParticipantConfirmation`: Usava coleção legada `group_members` e alterava o participante no índice 0 caso o usuário não fosse encontrado. | Usar `ministry_members`; lançar 403 se o usuário não for participante da escala; nunca alterar participante alheio. | `RESOLVED` |
| **SEC-006** | **P0** | Liturgies IDOR & Bug | `LiturgyRepository`: `getLiturgyById`, `deleteLiturgy` sem verificação de `ministry_id`; `LiturgyService.updateLiturgy` chamava `createLiturgy` criando documento duplicado. | Implementar `updateLiturgy` real no repository com validação de `group_id/ministry_id`; escopar `getLiturgyById` e `deleteLiturgy`. | `RESOLVED` |
| **SEC-007** | **P1** | Account Takeover | `MinistryRepository.updateMemberDetails`: Permitia que um admin de ministério alterasse e-mail e senha de uma conta Firebase Auth de usuário real (`!is_manual`). | Bloquear alteração de senha e e-mail global de terceiros no Firebase Auth via update de membro de ministério. | `RESOLVED` |
| **SEC-008** | **P1** | Privilege Escalation | `MinistryRepository.updateMemberDetails` / `updateMemberRole`: Permitia que o último administrador de um ministério fosse rebaixado para `member` ou removido. | Validar regra de "Last Admin": impedir rebaixamento ou remoção do único administrador do ministério. | `RESOLVED` |
| **SEC-009** | **P1** | Information Disclosure | `GET /api/diag`: Rota pública expunha variáveis de ambiente, Project ID do Firebase e default ministry ID. | Ocultar detalhes sensíveis em produção e adicionar security headers HTTP. | `RESOLVED` |
| **SEC-010** | **P1** | JWT Configuration | `config.jwtSecret`: Fallback com segredo padrão não bloqueado em produção. | Validar que em `NODE_ENV === 'production'`, `JWT_SECRET` não pode ser a string default de desenvolvimento. | `RESOLVED` |
| **SEC-011** | **P2** | Token Interoperability | Suporte dual a Firebase ID Token e JWT próprio assinado no middleware `authenticate`. | Suportar verificação de Firebase ID Token via `authAdmin.verifyIdToken(...)` além do JWT da aplicação. | `RESOLVED` |
| **SEC-012** | **P2** | HTTP Security Headers | Ausência de headers básicos de segurança na API Express. | Adicionados headers `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` e `Cross-Origin-Opener-Policy`. | `RESOLVED` |

---

## 3. Validação e Resultados

- **Backend Build (`tsc`)**: Sucesso (0 erros).
- **Backend Tests (`vitest`)**: 71 testes executados e aprovados (incluindo testes de quotas, performance, repertório, RBAC, autenticação e IDOR).
- **Web Build (`vite build`)**: Sucesso (0 erros).
- **Web Tests (`vitest`)**: 23 testes executados e aprovados.
- **Web E2E Tests (`playwright`)**: 61 testes executados e aprovados (11 skipped) cobrindo todos os viewports e temas móveis.
