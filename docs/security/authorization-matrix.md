# Matriz de Autorização e Isolamento de Recursos — LouvAIO

Data da última atualização: 2026-08-29
Status: Aprovado e Implementado

---

## 1. Princípios Fundamentais

1. **Authentication answers WHO**: Validação criptográfica de identidade via JWT assinado com chave secreta estrita ou Firebase ID Token verificado via Firebase Admin SDK.
2. **Authorization answers WHAT THIS USER MAY DO TO THIS RESOURCE**: A autorização é validada no backend em tempo de execução através de:
   - Verificação de pertencimento ao ministério (`ministry_members`);
   - Verificação de papel RBAC (`admin` vs `member`);
   - Verificação de posse do recurso (IDOR protection — garantir que `resource.ministry_id === requestedMinistryId`);
   - Verificação de estado operacional do plano/subscription (`enforceOperationalAccess`);
   - Proteção de quotas atômicas via transação Firestore (`SubscriptionRepository`).
3. **Frontend Hiding não é Segurança**: Esconder botões ou componentes no cliente é apenas usabilidade; todas as fronteiras de segurança operam no servidor com retorno padronizado (`401 Unauthorized`, `403 Forbidden`, `404 Not Found`).

---

## 2. Matriz de Permissões por Recurso e Rota

| Domínio / Recurso | Rota / Operação | Autenticação | Papel Mínimo | Tenant Isolation (IDOR) | Regra Operacional / Quota |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Auth** | `POST /api/auth/register` | Pública | Anônimo | N/A | Cria conta Identity Toolkit + Doc Firestore |
| **Auth** | `POST /api/auth/login` | Pública | Anônimo | N/A | Exige senha válida no Identity Toolkit |
| **Auth** | `GET /api/auth/me` | Requerida | Usuário autenticado | Escopo do próprio UID | Retorna perfil e ministérios ativos |
| **Auth** | `POST /api/auth/change-password` | Requerida | Usuário autenticado | Escopo do próprio UID | Altera senha no Firebase Auth |
| **Ministries** | `GET /api/ministries/my-ministries` | Requerida | Usuário autenticado | Ministérios do usuário | Acesso global |
| **Ministries** | `POST /api/ministries` | Requerida | Usuário autenticado | N/A (Novo tenant) | Cria ministério + plano Free |
| **Ministries** | `POST /api/ministries/join` | Requerida | Usuário autenticado | Validação de código | Incrementa membro (quota atômica) |
| **Ministries** | `GET /api/ministries/:id` | Requerida | `member` | Valida `ministry_members` | Leitura de detalhes |
| **Ministries** | `PUT /api/ministries/:id` | Requerida | `admin` | Valida `ministry_members` | `enforceOperationalAccess` |
| **Ministries** | `DELETE /api/ministries/:id` | Requerida | Owner | Valida `owner_user_id` | `remediation` (Permitido em suspensão) |
| **Ministries** | `DELETE /api/ministries/:id/leave` | Requerida | `member` | Valida `ministry_members` | Regra de último admin / não-owner |
| **Members** | `GET /api/ministries/:id/members` | Requerida | `member` | Valida `ministry_members` | Leitura da lista de integrantes |
| **Members** | `POST /api/ministries/:id/members` | Requerida | `admin` | Valida `ministry_members` | Quota atômica de membros |
| **Members** | `PATCH /api/ministries/:id/members/:mId` | Requerida | `admin` | Valida `ministry_members` | Regra do último admin; sem bypass de auth |
| **Members** | `DELETE /api/ministries/:id/members/:mId`| Requerida | `admin` | Valida `ministry_members` | Decrementa quota; regra do último admin |
| **Invites** | `POST /api/ministries/:id/invites` | Requerida | `admin` | Valida `ministry_members` | `enforceOperationalAccess` |
| **Songs** | `GET /api/groups/:id/songs` | Requerida | `member` | Filtro `ministry_id` | Paginação cursor/offset sanitizado |
| **Songs** | `GET /api/groups/:id/songs/:songId` | Requerida | `member` | Valida `song.ministry_id` | 404 se não pertencer ao tenant |
| **Songs** | `POST /api/groups/:id/songs` | Requerida | `admin` | Atribui `ministry_id` | Quota atômica de músicas |
| **Songs** | `PUT /api/groups/:id/songs/:songId` | Requerida | `admin` | Valida `song.ministry_id` | Proteção contra mass assignment |
| **Songs** | `DELETE /api/groups/:id/songs/:songId` | Requerida | `admin` | Valida `song.ministry_id` | Decrementa quota atômica (`remediation`) |
| **Artists** | `GET /api/groups/:id/artists` | Requerida | `member` | Filtro `ministry_id` | Leitura |
| **Artists** | `POST /api/groups/:id/artists` | Requerida | `admin` | Atribui `ministry_id` | `enforceOperationalAccess` |
| **Artists** | `PUT /api/groups/:id/artists/:artistId` | Requerida | `admin` | Valida `artist.ministry_id` | 404 se não pertencer ao tenant |
| **Artists** | `DELETE /api/groups/:id/artists/:artistId` | Requerida | `admin` | Valida `artist.ministry_id` | 404 se não pertencer ao tenant |
| **Classifications** | `GET /api/groups/:id/classifications` | Requerida | `member` | Filtro `ministry_id` | Auto-seed seguro |
| **Classifications** | `POST /api/groups/:id/classifications` | Requerida | `admin` | Atribui `ministry_id` | `enforceOperationalAccess` |
| **Classifications** | `PUT /api/groups/:id/classifications/:cId` | Requerida | `admin` | Valida `classification.ministry_id`| 404 se não pertencer ao tenant |
| **Classifications** | `DELETE /api/groups/:id/classifications/:cId`| Requerida | `admin` | Valida `classification.ministry_id`| 404 se não pertencer ao tenant |
| **Folders** | `GET /api/groups/:id/folders` | Requerida | `member` | Filtro `ministry_id` | Leitura |
| **Folders** | `GET /api/groups/:id/folders/:folderId` | Requerida | `member` | Valida `folder.ministry_id` | 404 se não pertencer ao tenant |
| **Folders** | `POST /api/groups/:id/folders` | Requerida | `admin` | Atribui `ministry_id` | `enforceOperationalAccess` |
| **Folders** | `PUT /api/groups/:id/folders/:folderId` | Requerida | `admin` | Valida `folder.ministry_id` | 404 se não pertencer ao tenant |
| **Folders** | `DELETE /api/groups/:id/folders/:folderId`| Requerida | `admin` | Valida `folder.ministry_id` | 404 se não pertencer ao tenant |
| **Folders** | `POST /api/groups/:id/folders/:fId/songs`| Requerida | `admin` | Valida `folder` E `song` | Ambos devem pertencer ao tenant |
| **Folders** | `DELETE /api/groups/:id/folders/:fId/songs/:sId`| Requerida | `admin` | Valida `folder.ministry_id` | Remove associação |
| **Schedules** | `GET /api/groups/:id/schedules` | Requerida | `member` | Filtro `ministry_id` | Leitura de escalas |
| **Schedules** | `GET /api/groups/:id/schedules/:sId` | Requerida | `member` | Valida `schedule.ministry_id`| 404 se não pertencer ao tenant |
| **Schedules** | `POST /api/groups/:id/schedules` | Requerida | `admin` | Atribui `ministry_id` | `enforceOperationalAccess` |
| **Schedules** | `PUT /api/groups/:id/schedules/:sId` | Requerida | `admin` | Valida `schedule.ministry_id`| Proteção contra mass assignment |
| **Schedules** | `DELETE /api/groups/:id/schedules/:sId` | Requerida | `admin` | Valida `schedule.ministry_id`| Exclui comentários associados |
| **Confirmation** | `PATCH /api/groups/:id/schedules/:sId/confirmation`| Requerida | `member` | Valida `schedule` + `participant` | 403 se usuário não for participante |
| **Comments** | `GET /api/groups/:id/schedules/:sId/comments`| Requerida | `member` | Valida `schedule.ministry_id`| Paginação segura de comentários |
| **Comments** | `POST /api/groups/:id/schedules/:sId/comments`| Requerida | `member` | Valida `schedule.ministry_id`| `enforceOperationalAccess` |
| **Teams** | `GET /api/groups/:id/teams` | Requerida | `member` | Filtro `ministry_id` | Leitura |
| **Teams** | `GET /api/groups/:id/teams/:teamId` | Requerida | `member` | Valida `team.ministry_id` | 404 se não pertencer ao tenant |
| **Teams** | `POST /api/groups/:id/teams` | Requerida | `admin` | Atribui `ministry_id` | `enforceOperationalAccess` |
| **Teams** | `PUT /api/groups/:id/teams/:teamId` | Requerida | `admin` | Valida `team.ministry_id` | 404 se não pertencer ao tenant |
| **Teams** | `DELETE /api/groups/:id/teams/:teamId` | Requerida | `admin` | Valida `team.ministry_id` | 404 se não pertencer ao tenant |
| **Roles** | `GET /api/groups/:id/roles` | Requerida | `member` | Filtro `ministry_id` | Leitura |
| **Roles** | `GET /api/groups/:id/roles/:roleId` | Requerida | `member` | Valida `role.ministry_id` | 404 se não pertencer ao tenant |
| **Roles** | `POST /api/groups/:id/roles` | Requerida | `admin` | Atribui `ministry_id` | `enforceOperationalAccess` |
| **Roles** | `PUT /api/groups/:id/roles/:roleId` | Requerida | `admin` | Valida `role.ministry_id` | 404 se não pertencer ao tenant |
| **Roles** | `DELETE /api/groups/:id/roles/:roleId` | Requerida | `admin` | Valida `role.ministry_id` | 404 se não pertencer ao tenant |
| **Liturgies** | `GET /api/groups/:id/liturgies` | Requerida | `member` | Filtro `group_id` | Leitura com itens aninhados |
| **Liturgies** | `GET /api/groups/:id/liturgies/:lId` | Requerida | `member` | Valida `liturgy.group_id` | 404 se não pertencer ao tenant |
| **Liturgies** | `POST /api/groups/:id/liturgies` | Requerida | `admin` | Atribui `group_id` | `enforceOperationalAccess` |
| **Liturgies** | `PUT /api/groups/:id/liturgies/:lId` | Requerida | `admin` | Valida `liturgy.group_id` | Update real com itens atualizados |
| **Liturgies** | `DELETE /api/groups/:id/liturgies/:lId`| Requerida | `admin` | Valida `liturgy.group_id` | Exclui liturgia e seus itens |
| **Templates** | `GET /api/groups/:id/templates` | Requerida | `member` | Filtro `group_id` | Leitura de roteiros |
| **Templates** | `GET /api/groups/:id/templates/:tId`| Requerida | `member` | Valida `template.group_id` | 404 se não pertencer ao tenant |
| **Templates** | `POST /api/groups/:id/templates` | Requerida | `admin` | Atribui `group_id` | `enforceOperationalAccess` |
| **Templates** | `PUT /api/groups/:id/templates/:tId` | Requerida | `admin` | Valida `template.group_id` | 404 se não pertencer ao tenant |
| **Templates** | `DELETE /api/groups/:id/templates/:tId`| Requerida | `admin` | Valida `template.group_id` | 404 se não pertencer ao tenant |
| **Smart Chords**| `GET /api/smart-chords` | Requerida | Dono (`user_id`) | Filtro `user_id == req.user.id` | Apenas cifras do usuário autenticado |
| **Smart Chords**| `GET /api/smart-chords/:id` | Requerida | Dono (`user_id`) | Valida `sc.user_id == req.user.id`| 404 se não pertencer ao usuário |
| **Smart Chords**| `POST /api/smart-chords` | Requerida | Dono (`user_id`) | Atribui `user_id = req.user.id` | Salva cifra própria |
| **Smart Chords**| `PUT /api/smart-chords/:id` | Requerida | Dono (`user_id`) | Valida `sc.user_id == req.user.id`| 404/403 se não for dono |
| **Smart Chords**| `DELETE /api/smart-chords/:id` | Requerida | Dono (`user_id`) | Valida `sc.user_id == req.user.id`| 404/403 se não for dono |
| **Subscriptions**| `GET /api/subscriptions/plans` | Requerida | Usuário autenticado | Público autenticado | Catálogo oficial de planos e add-ons |
| **Subscriptions**| `GET /api/subscriptions/:id/status`| Requerida | `member` | Valida `ministry_members` | Status, quotas e limites |
| **Subscriptions**| `POST /api/subscriptions/:id/simulate-event`| Requerida | `admin` | Valida `ministry_members` | Simulação restrita em desenvolvimento |

---

## 3. Garantias de Isolamento Multitenant (Anti-IDOR)

1. **Sem Acesso Cruzado por ID**: O conhecimento de um ID (`songId`, `scheduleId`, `folderId`, `liturgyId`, `teamId`, `roleId`) de outro ministério não permite visualização, edição ou exclusão. Todas as operações verificam o pertencimento ao ministério da rota.
2. **Combinações Complexas Protegidas**: Na inclusão de músicas em pastas (`addSongToFolder`), o sistema valida que a pasta pertence ao ministério E a música pertence ao mesmo ministério.
3. **Escopo de Membros**: A confirmação de presença (`updateParticipantConfirmation`) consulta a coleção `ministry_members` correspondente ao ministério da escala e rejeita com 403 se o usuário não for participante da escala, sem modificar participantes aleatórios.
4. **Isolamento de Smart Chords**: Cifras inteligentes não pertencem a ministérios, mas a usuários individuais. As operações são escopadas estritamente por `user_id`, impedindo leitura ou edição de cifras alheias.
