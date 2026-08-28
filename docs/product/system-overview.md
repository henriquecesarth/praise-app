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
- transposição;
- edição visual;
- tentativa de associação/criação de música;
- exportação PDF no browser.

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

## Commercial Structure and Plans

A estrutura comercial do LouvAIO compreende 6 planos (`free`, `lite`, `lite_plus`, `essential`, `pro`, `premium`) e modelagem de add-ons de membros em blocos de +10. A cobrança real não está ativa nesta etapa.

Consulte a especificação detalhada em [Estrutura Comercial e Planos](plans-and-limits.md).

## Current Limits

- Avisos do dashboard são dados mock locais.
- Liturgias têm componente, mas não estão acessíveis pela navegação principal.
- Persistência Smart Chords não está alinhada ponta a ponta.
- Não há gateway de pagamento integrado nesta etapa inicial (apenas modelagem de limites).
- Não há mobile nativo no checkout.
- Não há notificações, mensageria ou jobs.
- O backend não possui testes automatizados; o web possui cobertura focal com Vitest/Testing Library e jornadas Playwright mockadas.

Detalhes e riscos: [System status](../system-status.md).

## Product Unknowns

- Integração com gateway de pagamentos real: **A definir em etapa posterior**.
- Requisitos de escala e disponibilidade: **Unknown / Not yet verified**.
- Roadmap e prioridades oficiais adicionais: **Unknown / Not yet verified**.
- Requisitos legais, privacidade e retenção: **Unknown / Not yet verified**.
