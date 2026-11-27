# LouvAIO — regras dos agentes

## Escopo e contexto
- LouvAIO: API Express/Firestore em `backend/`, SPA/PWA React/Vite em `web/`, cliente Flutter em `mobile/`; CI em `.github/workflows/`.
- Precedência: código/configuração → testes executáveis → estas regras e documentos da tarefa → trechos pertinentes de MEMORY.md → histórico.
- Leia estas regras uma vez por sessão. Consulte `docs/development/CURRENT_PROJECT_STATE.md`, `docs/system-status.md` e documentos da área somente quando pertinentes.
- Nunca carregue MEMORY.md, o repositório ou diretórios inteiros por padrão. Localize com `rg --files <diretório>` e busque com `rg -n -m 8 --max-columns 200 --max-columns-preview '<tema>' <arquivos>`; depois leia apenas o trecho necessário (ex.: 40–80 linhas). Amplie a busca somente se faltar evidência.
- Não releia conteúdo já disponível nem imprima arquivos/linhas extensos sem necessidade. MEMORY.md contém decisões duráveis, não o status da execução.
- Evidência insuficiente: use exatamente **Unknown / Not yet verified**. Não registre valores de .env, tokens, senhas, chaves ou credenciais.

## Arquitetura e segurança
- Web chama a API por `web/src/api.ts`; componentes não acessam Firebase. API: route → middleware → controller → service → repository → Firestore; repositories acessam o cliente Firebase.
- Backend aplica autenticação, RBAC, anti-IDOR, quotas e isolamento por usuário/ministério; autorização visual não concede acesso. Derive ownership da sessão, nunca de autoridade enviada pelo cliente.
- `ministryId` é canônico; preserve aliases `groupId` observados. Preserve contratos HTTP locais (não há envelope único) e avalie consumidores antes de alterá-los.
- Preserve TypeScript estrito, Zod junto à feature, AppError e `{ error: { message, details } }`, convenções snake_case/camelCase e estilo dos arquivos. Não amplie any nem refatore incidentalmente.
- Smart Chords pertencem ao autor (user_id): `/api/v1/smart-chords*` é privado e cifra sem vínculo não é compartilhada. Vínculo `active` de admin/owner ativo publica a cifra para leitura pelos membros daquele ministério, música e versão, somente via `GET /api/v1/ministries/:ministryId/songs/:songId/my-smart-chords` (inclui legado `song_id` de admin em música de versão única); pendentes só para admin, e criar/alterar/remover vínculo exige admin. Importação gera preview sem escrita; persistência e vínculo exigem confirmação. Descarte respostas de sessões/ministérios obsoletos.
- Asaas é autoridade financeira; SubscriptionService governa direito de uso/quotas. Transições usam `billing_plan_changes` sem substituir assinatura vigente antes da confirmação financeira.
- Preserve idempotência, concorrência, datas efetivas e evidências financeiras; fatos incertos de provedor exigem fail-closed. Downgrade, inadimplência e cancelamento nunca apagam dados: aplicar grace/restrição.
- Não introduza arquitetura idealizada, dependências, infraestrutura, migrações ou abstrações sem necessidade autorizada. Não corrija itens de system-status fora do escopo.

## Git e execução
- Antes de editar: confira status, branch e HEAD; preserve commits, arquivos modificados e não rastreados. A branch de trabalho está registrada em `docs/development/CURRENT_PROJECT_STATE.md`; não troque a branch atual nem assuma main.
- Não faça reset, clean, checkout destrutivo, reescrita de histórico ou force push. Commit somente quando autorizado; push, PR, merge, deploy e escritas externas/produção exigem autorização explícita separada.
- Inspecione referências/contratos afetados e faça a menor mudança verificável. Um escritor por arquivo; worktree somente se necessário. Atualize/crie ExecPlan apenas para mudanças relevantes, sem planejamento extenso em ajustes pontuais; arquive quando realmente concluído.
- Não acesse credenciais ativas, fabrique evidência de provedor ou escreva em Firestore de produção.

## Validação e entrega
- Documentação/configuração apenas: valide configuração e diff; **não execute testes/builds de produto**.
- Código: testes direcionados primeiro, com timeout e dependências externas verificadas; mocks/fixtures isolam escritas E2E. Execute builds/testes pertinentes e amplie somente se risco/falha justificar. Após correção de código revisado, revalide o trecho afetado.
- Comandos disponíveis: backend `npm run build` / `npm test`; web idem e `npm run test:e2e`; mobile `flutter analyze` / `flutter test`. Confirme scripts atuais antes de usar. Web não tem lint; lint backend não é operacional sem configuração/dependência. Não crie lint/testes só para cumprir protocolo.
- Sem polling indefinido. Resultados: PASS, FAIL, NOT_EXECUTED ou BLOCKED, com evidência real; nunca declare execução externa, build ou homologação sem comprovação.
- Ao terminar: `git diff --check`, status e diff/stat; confira escopo/secrets e relate mudanças, arquivos, validações, limitações e próximo passo, quando houver. Atualize documentação atingida; MEMORY.md somente para nova decisão durável.

## Agentes e sessões
- Claude Code é a ferramenta principal. Gemini é usado só quando o responsável pedir; nenhuma tarefa depende dele.
- Subagentes em `.claude/agents/`: `feature-reviewer`, `billing-reviewer` e `sandbox-auditor`. Planejamento e implementação ficam na sessão principal.
- Mudanças de código relevantes passam por revisor separado, em contexto próprio e somente leitura, antes do commit. Relatório vazio não é aprovação.
- Delegue apenas trabalho independente e útil; não simule agentes nem crie supervisor externo.
- Mantenha a sessão para a mesma tarefa; abra outra para trabalho independente. Ao encerrar um marco, atualize `docs/development/CURRENT_PROJECT_STATE.md`.
