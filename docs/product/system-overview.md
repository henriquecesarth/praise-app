# Product System Overview

## Purpose

LouvAIO (anteriormente Praise App) apoia a organização diária de ministérios de louvor em uma aplicação web instalável (PWA). O código atual concentra gestão de pessoas, repertório musical, planejamento de escalas, edição de cifras inteligentes e preparação de conteúdo musical.

## Identifiable Actors

### User

Pessoa autenticada por e-mail/senha.

### Ministry admin

Proprietário ou integrante com papel admin. A UI oferece criação/edição/exclusão de recursos e gestão de integrantes.

### Ministry member

Integrante com acesso principalmente de leitura e ações próprias, como confirmação em escala e comentários.

Funções musicais como Ministro, Vocalista, Violão e Bateria são classificações de participação separadas do papel de autorização admin/member.

## Confirmed Capabilities

### Account and ministries

- signup/login;
- listar e alternar ministérios;
- criar, renomear, excluir ou sair;
- entrar por código PR-*;
- gerar convite;
- listar, adicionar manualmente, editar e remover integrantes;
- promover/rebaixar admin/member.

### Ministry configuration

- funções musicais;
- equipes com integrantes;
- classificações de música;
- modelos reutilizáveis de roteiro de escala.

### Repertoire

- músicas com artista, classificação, tom, BPM, duração, letras/notas e links;
- versões de música no modelo da UI;
- artistas;
- pastas e associação de músicas;
- busca e filtros.

### Schedules

- próximas/anteriores;
- participantes e funções;
- músicas e roteiro/timeline;
- visibilidade, confirmação, paleta e vestuário;
- detalhe, edição, exclusão;
- confirmação de presença e comentários.

### Smart Chords

- edição de cifras por marcação entre colchetes;
- transposição e campo harmônico;
- edição visual e inline;
- associação persistida com músicas do repertório e criação automática;
- persistência completa no Firestore com isolamento por usuário (user_id);
- exportação PDF no browser.

### Dashboard announcements

- avisos com título, conteúdo, autor e indicador de importância;
- persistência no Firestore (`ministry_announcements`) com escopo estrito por ministério (`ministry_id`);
- RBAC integrado: integrantes com papel `member` possuem acesso somente leitura; administradores (`admin`) possuem CRUD completo;
- interface com carregamento, erro com retry sem colisão com empty state e modais acessíveis com proteção contra duplo envio;
- ordenação decrescente por data e limites de consulta seguros.

### Member Unavailability Self-Service

- gestão self-service de períodos de indisponibilidade (bloqueios) do próprio integrante logado;
- persistência no Firestore (`member_unavailabilities`) com isolamento multi-tenant (`ministry_id`), derivação autoritativa de identidade (`user_id` e `member_id`) e anti-IDOR fail-closed com HTTP 404;
- modelo temporal civil wall-clock (`YYYY-MM-DDTHH:mm:ss`, sem conversão UTC ou sufixo Z) com intervalos semi-abertos `[starts_at, ends_at)` e limite contínuo máximo de 90 dias;
- interface com listagem paginada estável, modais acessíveis para dia inteiro e horários parciais, proteção contra duplo clique e imunidade a race conditions na alternância de ministério.

### Schedule Availability Conflicts

- detecção de conflitos entre escalas e períodos de indisponibilidade declarados pelos integrantes;
- suporte a duração de escalas (`duration_minutes` / `durationMinutes`) de 15 a 1440 minutos com padrão de 120 minutos (2 horas) e fallback retrocompatível não-mutante para escalas legadas;
- motor de cálculo temporal puramente civil em intervalos semi-abertos `[starts_at, ends_at)`;
- endpoint administrativo (`POST /api/v1/ministries/:ministryId/availability/check-conflicts`) com RBAC estrito (`admin`);
- normalização autoritativa de identidades de participantes (document ID e `user_id` do Firebase Auth) no escopo do ministério ativo;
- consulta otimizada e paginada no Firestore com lookback de 90 dias prevenindo falso-negativos por limites de página;
- regra estrita de privacidade: motivo pessoal (`reason`) é categoricamente omitido das respostas de conferência coletiva;
- integração na interface de criação e edição de escalas como avisos informativos não-bloqueantes: o salvamento da escala nunca é bloqueado por conflito ou erro de verificação;
- proteção de concorrência com token de geração descartando respostas defasadas na alternância de entradas ou ministérios.

### Administrative Consolidated Availability View

- visualização consolidada administrativa de períodos de indisponibilidade de integrantes do ministério (Phase 6D-1);
- escopo estritamente de leitura para planejamento de escalas com RBAC exclusivo para administradores (`admin`);
- validação temporal rigorosa para janelas de planejamento civil de até 90 dias inclusivos (`from` e `to` em `YYYY-MM-DD`);
- busca no Firestore bounded por lookback de 90 dias e algoritmo de varredura contínua contra páginas falsamente vazias geradas pelo filtro residual de overlap;
- teto de segurança contra custos abusivos e DoS de 1000 candidatos por requisição (`AVAILABILITY_QUERY_TOO_LARGE`);
- token de continuação (cursor) bound ao contexto da requisição (`ministry_id`, `windowStart`, `windowEndExclusive`, `memberId`);
- enriquecimento em lote de nomes de integrantes via `db.getAll` com guarda multi-tenant;
- privacidade absoluta: o motivo (`reason`) e metadados internos de usuário são omitidos das respostas da API e da interface administrativa;
- interface `AdminAvailabilityView` integrada à área de ministério sob "Planejamento de Escalas" com presets rápidos (7d, 15d, 30d, mês atual), seletor customizado, dropdown de integrante, touch targets >= 44px e proteção contra race conditions.

### PWA

- manifest instalável;
- prompt de instalação;
- service worker versionado com fallback offline;
- precache somente do shell/assets estáticos, sem cache runtime de API.

## Main User Flow

    criar conta ou entrar
    → escolher/criar/ingressar em ministério
    → dashboard
    → gerenciar repertório, escalas ou configurações
    → alternar ministério conforme membership

## Important Concepts

- **Ministry**: tenant principal e agrupador de dados.
- **Role admin/member**: permissão do tenant.
- **Musical role**: função executada por um integrante.
- **Team**: conjunto reutilizável de integrantes.
- **Schedule**: culto/evento com participantes, músicas e timeline.
- **Schedule template**: modelo de itens de roteiro.
- **Song/version**: repertório e variantes de execução.
- **Folder**: agrupamento de músicas.
- **Liturgy**: ordem de culto separada do modelo de escala.
- **Smart Chord**: cifra editável e transponível.
- **Announcement**: aviso ou comunicado interno da equipe vinculado a um ministério.
- **Member Unavailability**: registro de indisponibilidade (bloqueio) autodeclarado do integrante no ministério.

## Commercial Structure and Plans

A estrutura comercial do LouvAIO compreende 6 planos (`free`, `lite`, `lite_plus`, `essential`, `pro`, `premium`) e modelagem de add-ons de membros em blocos de +10. A cobrança real não está ativa nesta etapa.

Consulte a especificação detalhada em [Estrutura Comercial e Planos](plans-and-limits.md).

## Current Limits

- Avisos do dashboard são persistidos por ministério no Firestore sob `ministry_announcements`.
- Liturgias acessíveis via rota canônica /liturgias, sidebar desktop e cartão Ministério no mobile.
- Não há gateway de pagamento integrado nesta etapa inicial (apenas modelagem de limites).
- Não há mobile nativo no checkout.
- Não há notificações, mensageria ou jobs.
- O backend e o web possuem cobertura de testes automatizados com Vitest/Testing Library e jornadas Playwright mockadas.

Detalhes e riscos: [System status](../system-status.md).

## Product Unknowns

- Integração com gateway de pagamentos real: **A definir em etapa posterior**.
- Requisitos de escala e disponibilidade: **Unknown / Not yet verified**.
- Roadmap e prioridades oficiais adicionais: **Unknown / Not yet verified**.
- Requisitos legais, privacidade e retenção: **Unknown / Not yet verified**.
