# Agent Operating Manual

## 1. Project Mission

LouvAIO (anteriormente Praise App) é uma aplicação web e PWA para organizar ministérios de louvor. O sistema cobre autenticação, ministérios e integrantes, funções, equipes, escalas, repertório, liturgias, modelos de roteiro, edição de cifras inteligentes, planos, quotas, concessões cortesia e faturamento SaaS recorrente via gateway Asaas. O produto é uma SPA instalável que consome uma API REST Express com dados no Firebase Firestore.

## 2. Sources of Truth

Use esta precedência:

1. código e configuração atuais;
2. testes executáveis;
3. AGENTS.md e MEMORY.md;
4. documentos específicos em docs/;
5. documentação histórica.

Se o código contradizer um documento, confirme o comportamento no código, atualize a documentação atingida e não preserve a afirmação obsoleta. Use exatamente Unknown / Not yet verified quando não houver evidência suficiente. Nunca registre valores de .env, tokens, senhas, chaves privadas ou credenciais.

## 3. Repository Map

- backend/: API Express. Contém configuração, middleware, features e repositories. Regras HTTP, persistência e faturamento pertencem aqui; UI não pertence.
- backend/src/features/: módulos por capacidade:
  - auth/, ministries/, repertoire/, schedules/, liturgies/, smart_chords/, teams/, roles/, classifications/, templates/
  - subscriptions/: gestão de quotas, ciclos de vida de assinaturas, planos de cortesia e accessMode.
  - billing/: integração de pagamentos com provedores (Asaas), checkouts hospedados, webhooks idempotentes, histórico e BillingReconcilerWorker.
- backend/src/repositories/: acesso direto ao Firestore e mapeamento de documentos. Consultas e comandos de persistência pertencem aqui.
- backend/src/middleware/: autenticação, RBAC, validação Zod, enforcement de quotas e tratamento global de erro.
- backend/src/lib/: inicialização de integrações. firebase.ts é a integração ativa; supabase.ts é um stub obsoleto.
- web/: SPA React/Vite e PWA. UI, estado de tela e adaptação do contrato HTTP pertencem aqui.
- web/src/api.ts: única camada centralizada de chamadas HTTP e conversão snake_case/camelCase.
- web/src/components/: telas, modais e componentes visuais (incluindo tela de planos e faturamento).
- web/src/utils/: transformação de cifras e datas comerciais.
- docs/: documentação operacional e arquitetural.
- docs/exec-plans/active/: planos vivos de mudanças relevantes.
- docs/exec-plans/completed/: planos encerrados, preservados como histórico de execução.

Não existem atualmente mobile/, supabase/, Docker, CI/CD ou migrations. O backend possui suíte de testes Vitest em `backend/src/`. O web possui testes co-localizados em `web/src/` e jornadas E2E em `web/e2e/`.

## 4. Architecture Rules

Regras observadas, não aspiracionais:

- O frontend chama a API por web/src/api.ts; componentes não usam Firebase diretamente.
- A API é organizada principalmente como route → middleware → controller → service → repository → Firestore.
- Controllers traduzem Request/Response e propagam erros ao middleware global.
- Services orquestram repositories e entidades de domínio; repositories acessam o Firestore diretamente.
- Repositories importam o cliente Firebase diretamente e conhecem nomes de coleções.
- Entradas de várias rotas usam schemas Zod antes do controller.
- Recursos de ministério são identificados por ministryId; aliases groupId permanecem em vários pontos por compatibilidade.
- Autorização de tela no frontend é apenas apresentação. A API continua sendo a fronteira efetiva de autorização e aplicação de quotas.
- Separação de autoridade no faturamento: o gateway de pagamento (Asaas) é a autoridade sobre o estado financeiro; o LouvAIO (SubscriptionService) é a autoridade sobre o direito de uso e quotas de produto.
- Transições de plano usam a coleção `billing_plan_changes` para isolamento de intenção sem sobrescrever a assinatura ativa vigente até a confirmação financeira.
- Preservação estrita de dados: downgrades, inadimplência e cancelamentos nunca apagam dados de ministérios, membros, músicas ou escalas. O sistema aplica carência (`grace`) e modo restrito (`restricted_over_limit`).
- A resposta HTTP não possui envelope único: repertório frequentemente usa { data: ... }, enquanto outros módulos retornam o objeto/array diretamente. Preserve o contrato observado em mudanças localizadas.
- Não trate Clean Architecture, DDD ou outra arquitetura idealizada como padrão adotado.

Consulte docs/system-status.md antes de trabalhar em autenticação, RBAC, liturgias, Smart Chords, faturamento ou aliases groups: há inconsistências catalogadas.

## 5. Coding Conventions

- TypeScript estrito em backend e web.
- Backend usa nomes de arquivo feature.controller.ts, feature.service.ts, feature.routes.ts e feature.types.ts.
- Classes são PascalCase; funções, variáveis e métodos são camelCase.
- Dados persistidos usam majoritariamente snake_case; a UI usa camelCase.
- Código assíncrono usa async/await e captura erros nos controllers.
- Erros esperados da API usam AppError; o errorHandler produz { error: { message, details } }.
- Dependências de service/repository usam parâmetros de construtor com instância padrão.
- Schemas Zod ficam junto da feature.
- O frontend usa componentes funcionais e hooks; não há biblioteca de estado global. React Router sincroniza módulos e detalhes com URLs estáveis.
- Estilos são centralizados principalmente em web/src/index.css, com tokens em web/src/styles/louvaio-brand.css e estilos inline.
- Não há formatter configurado. Preserve o estilo do arquivo tocado.
- Há uso de any em contratos flexíveis. Não amplie isso sem necessidade, mas não refatore incidentalmente.

Mais detalhes: docs/development/conventions.md.

## 6. Change Protocol

Antes de alteração significativa:

1. Leia AGENTS.md e MEMORY.md.
2. Consulte docs/system-status.md e os documentos da área.
3. Inspecione o código afetado e suas referências com rg.
4. Identifique contratos frontend/backend e coleções Firestore atingidos.
5. Verifique scripts e validações existentes.
6. Crie ou atualize um ExecPlan em docs/exec-plans/active/ quando a tarefa não for trivial.
7. Implemente a menor mudança necessária.
8. Execute as validações aplicáveis.
9. Revise git diff e confirme ausência de mudanças acidentais.
10. Atualize documentação e MEMORY.md apenas quando surgir conhecimento durável.
11. Ao concluir um ExecPlan, finalize seu resultado e mova-o para completed/.

## 7. Scope Discipline

- Não refatore código fora da tarefa.
- Não troque ou atualize bibliotecas sem necessidade explícita.
- Não altere arquitetura incidentalmente.
- Não introduza abstrações especulativas.
- Prefira mudanças pequenas, reversíveis e verificáveis.
- Preserve comportamento salvo quando a tarefa pedir mudança de comportamento.
- Não remova código aparentemente não usado sem verificar referências e rotas.
- Não altere contratos públicos sem avaliar consumidores.
- Não corrija automaticamente itens de docs/system-status.md; inclua-os no escopo e plano de uma tarefa própria.
- Não trate conteúdo antigo de README/GEMINI como verdade quando contradito pelo código.
- Não invente infraestrutura, testes ou comandos ausentes.

## 8. Testing and Validation Requirements

Instalação reproduzível, quando necessária:

    cd backend
    npm ci

    cd ../web
    npm ci

Validação disponível:

    cd backend
    npm run build
    npm test

    cd ../web
    npm run build
    npm test
    npm run test:e2e

Validação de integridade do repositório:

    git diff --check
    git status
    git diff --stat

Estado atual:

- backend usa Vitest para testes unitários e de integração de quotas, billing, concorrência, idempotência, segurança anti-IDOR, RBAC e repositórios.
- web usa Vitest/Testing Library para unidades/componentes e Playwright para E2E com mocks locais.
- web não tem script de lint configurado.
- backend declara npm run lint, mas não inclui dependência/configuração ESLint; o comando não é uma validação operacional até isso ser configurado explicitamente.
- não existem comandos de format, migrations, Docker ou CI.

Não crie testes ou configuração de lint apenas para satisfazer o protocolo de outra tarefa. Para novo comportamento web ou backend, estenda a cobertura existente no nível apropriado e mantenha qualquer escrita E2E isolada por mocks/fixtures.

## 9. Definition of Done

Uma tarefa termina somente quando, conforme aplicável:

- o escopo solicitado está implementado;
- ambos os builds relevantes passam, ou falhas preexistentes estão reproduzidas e claramente registradas;
- testes novos e existentes passam, quando houver infraestrutura de testes;
- lint/format passam, quando a ferramenta estiver configurada;
- contratos e riscos afetados foram avaliados;
- documentação relevante foi atualizada;
- ExecPlan foi atualizado e arquivado se concluído;
- MEMORY.md contém apenas novas decisões duráveis;
- git diff não mostra mudanças acidentais nem secrets.

## 10. Agent Communication

O relatório final deve informar:

- o que foi feito;
- arquivos criados e modificados;
- decisões tomadas;
- validações executadas e resultados reais;
- limitações e Unknown / Not yet verified;
- riscos restantes;
- próximo passo natural, quando houver.

Nunca declare teste, lint, build, integração externa ou comportamento como validado sem executar ou inspecionar a evidência correspondente.
