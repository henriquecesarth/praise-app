# Observed Development Conventions

Este documento descreve padrões existentes. Ele não propõe um style guide ideal.

## TypeScript

- strict está ativo em backend e web.
- Backend compila para CommonJS/ES2022 e emite dist/, declarations e source maps.
- Web usa ESNext/bundler, noEmit e flags para unused locals/parameters.
- Imports relativos são o padrão, embora o tsconfig backend declare aliases.
- Ponto e vírgula é comum no backend e na maioria do frontend; main.tsx usa estilo sem ponto e vírgula.
- any aparece em adapters, records flexíveis e componentes complexos.

## Naming

- Classes/interfaces/componentes: PascalCase.
- Funções, métodos, hooks e variáveis: camelCase.
- Constantes globais: UPPER_SNAKE_CASE em alguns arquivos.
- Arquivos backend por feature: singular em feature.controller.ts, feature.service.ts, feature.routes.ts e feature.types.ts.
- Repositories: PascalCaseRepository.ts.
- Firestore e payloads backend: snake_case.
- Tipos/componentes web: camelCase.
- Ministry é o termo ativo. Group permanece como alias de tipo, parâmetro e rota por compatibilidade.

## Backend Structure

Fluxo típico:

    route
    → authenticate / RBAC / validate
    → controller
    → service
    → repository
    → Firestore

Controllers:

- métodos arrow para preservar this ao exportar;
- try/catch por handler;
- helpers BaseController para status/resposta;
- erros enviados ao next.

Services:

- classes com repository injetável por construtor e default concreto;
- métodos finos em várias features;
- não formam uma camada de domínio independente.

Repositories:

- instanciam handles de collection como campos;
- usam ISO string para created_at/updated_at;
- fazem validação e parte das regras;
- ordenam e filtram em memória quando conveniente;
- lançam AppError para not-found/forbidden conhecidos.

## Validation and DTOs

- Schemas Zod ficam em feature.types.ts.
- middleware/validate.ts pode validar body, query ou params e substitui req[source] pelo valor parseado.
- Não existem DTO classes ou mappers backend gerais.
- Controllers de Smart Chords chamam schema.parse diretamente, diferente das outras rotas.

## HTTP Responses

Não há envelope uniforme:

- BaseController.handleSuccess envia data diretamente.
- Repertório envolve vários resultados em { data: value }.
- Lista paginada de músicas usa { data, total, page, limit, totalPages }.
- Erro esperado usa { error: { message, details } }.
- DELETE pode responder 204 ou um objeto de mensagem conforme feature.

Ao alterar um endpoint, examine o mapper correspondente em web/src/api.ts.

## Authentication and Authorization

- Bearer JWT é extraído no middleware authenticate.
- AuthenticatedRequest adiciona user.id/email.
- RBAC consulta o ministry no repository a cada request.
- Admin/member controla escrita/leitura em rotas.
- Algumas features também aplicam requireActiveSubscription.
- A UI oculta controles de admin, mas isso não é segurança.

Existem riscos confirmados; consulte docs/system-status.md antes de reutilizar esses padrões.

## Frontend

- Componentes funcionais React 18 e hooks.
- App.tsx mantém a maior parte do estado global; não há Context/Redux/Zustand.
- Navegação visual continua baseada no estado de App.tsx, sincronizado com React Router por web/src/routing.ts.
- api.ts centraliza fetch, token e mappers.
- Componentes chamam api.ts e mantêm loading/error/modal local.
- Feedback usa toasts em App ou callbacks showToast.
- Confirmações destrutivas frequentemente usam window.confirm.
- Tema e sessão/PWA usam localStorage.
- CSS global usa custom properties, classes de feature e media queries; alguns componentes usam style inline.

## Data Mapping

- map*FromApi converte campos persistidos para modelos de UI.
- Música possui formato novo de versions e campos retrocompatíveis planos.
- DEFAULT_MINISTRY_ID é fallback para métodos antigos que não recebem tenant.
- Ao mudar modelos, verifique types.ts, api.ts, formulário, visualização e repository juntos.

## Errors and Logging

- Backend: console.log/warn/error e AppError.
- Frontend: try/catch, Error.message, console.warn/error e toast.
- Não há logger estruturado, correlation ID, métricas ou tracing.
- Não há política explícita de retry.

## Dependency Injection

Injeção existe apenas por parâmetros de construtor com default em services/controllers. Não há container DI. Repositories e middleware normalmente são singletons de módulo.

## Nullability

Campos Firestore opcionais são frequentemente armazenados como null; tipos web tendem a usar undefined. Mappers fazem essa adaptação parcialmente.

## Testing Convention

O web usa Vitest/Testing Library com arquivos `*.test.ts(x)` co-localizados e Playwright em `web/e2e/`. Jornadas de browser interceptam a API e não podem escrever em serviços reais. O backend ainda não possui convenção/suíte de testes. Veja testing.md.

## Comments and Language

Comentários e mensagens de usuário estão predominantemente em português. Identificadores técnicos estão em inglês. Preserve o idioma e o estilo da área tocada.
