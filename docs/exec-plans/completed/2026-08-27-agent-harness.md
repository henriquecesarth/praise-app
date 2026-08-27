# Agent-ready repository harness

## Objective

Criar documentação e contexto operacional fiel ao código atual, sem alterar comportamento.

## Context

README.md e GEMINI.md descreviam Mobile/Flutter e Supabase, mas o checkout contém somente backend Express/Firebase e web React/Vite.

## Current Behavior

O projeto não possuía AGENTS.md, MEMORY.md, estrutura docs/ nem protocolo de ExecPlans.

## Desired Behavior

Agentes futuros devem compreender missão, arquitetura, fluxos, integrações, comandos, lacunas e riscos sem redescobrir todo o repositório.

## Scope

### In Scope

- reconhecimento completo do repositório;
- documentação raiz e docs/;
- matriz estruturada do estado conhecido;
- protocolo de decisões e ExecPlans;
- validação dos comandos existentes.

### Out of Scope

- qualquer alteração funcional;
- correção de bugs ou contratos;
- criação de testes, lint, CI/CD, Docker, migrations ou .env.example.

## Architecture Impact

Nenhum impacto de runtime. Somente arquivos Markdown e marcadores de diretório.

## Implementation Plan

- [x] Inventariar código, configuração, dependências, rotas e integrações.
- [x] Comparar documentação anterior com a implementação.
- [x] Criar AGENTS.md, MEMORY.md e documentação em docs/.
- [x] Atualizar README.md e substituir o contexto obsoleto de GEMINI.md.
- [x] Executar builds e validações disponíveis.
- [x] Revisar referências e git diff.
- [x] Registrar resultado e mover o plano para completed/.

## Files Expected to Change

README.md, GEMINI.md, AGENTS.md, MEMORY.md e arquivos Markdown sob docs/.

## Tests

Não serão criados. Não existe infraestrutura de testes no repositório.

## Validation

- backend: npm run build;
- backend: npm run lint, para confirmar o estado declarado;
- web: npm run build;
- inspeção de links/caminhos;
- git diff e git status.

## Risks

- Documentar uma intenção histórica como comportamento atual.
- Expor configuração sensível.
- Omitir inconsistências por confiar em nomes de módulos sem seguir suas rotas e repositories.

## Decisions

- Código/configuração atual são a fonte primária.
- Fatos incertos recebem Unknown / Not yet verified.
- Problemas serão catalogados, não corrigidos.
- Este plano é real e será arquivado ao concluir o harness.

## Progress Notes

- 2026-08-27: inventário confirmou dois pacotes npm, Firebase/Firestore ativo e ausência de testes/infraestrutura.
- 2026-08-27: inconsistências de autorização, liturgias, Smart Chords e aliases foram confirmadas por inspeção estática.
- 2026-08-27: backend npm run build passou.
- 2026-08-27: web npm run build foi bloqueado inicialmente por spawn EPERM no sandbox; repetido com permissão para o subprocesso esbuild, passou com 1.532 módulos transformados.
- 2026-08-27: backend npm run lint falhou porque eslint não está instalado/configurado, confirmando GAP-002.
- 2026-08-27: links relativos, trailing whitespace, atribuições sensíveis e diff de código/configuração funcional passaram nas verificações.

## Final Result

Harness completo. Foram criados manual operacional, memória durável, documentação de arquitetura/desenvolvimento/produto, matriz estruturada de estado, governança de ADRs e ciclo de ExecPlans. README/GEMINI antigos foram corrigidos. Nenhum arquivo de runtime, dependência ou configuração funcional foi modificado.

Validation summary:

- Backend build: PASS.
- Web build: PASS.
- Backend lint: NOT OPERATIONAL — eslint ausente.
- Backend tests: NOT AVAILABLE.
- Web tests: NOT AVAILABLE.
- E2E/external integration: NOT RUN — exigiria ambiente Firebase conhecido.
- Markdown links and path references: PASS.
- Sensitive assignment scan: PASS.
- Functional/configuration diff: PASS (empty).
