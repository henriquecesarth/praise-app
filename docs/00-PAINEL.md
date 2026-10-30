---
aliases:
  - Painel LouvAIO
  - Dashboard
tags:
  - louvaio
  - dashboard
  - obsidian
type: dashboard
status: ativo
---

# LouvAIO — Painel da Base de Conhecimento

> **Vault do Obsidian:** `praise-app/docs`.
> O repositório Git é a fonte de verdade do código. Este painel centraliza a navegação técnica, histórico de decisões, contratos e contexto do projeto.

---

## 📌 Ponto de Partida e Status Vivo

- [[01-CONTEXTO-ATUAL|Contexto Operacional Compacto (Estado Verdadeiro)]] — Status verificado de builds, testes, releases e handoffs.
- [[exec-plans/evidence/2026-10-30-m20-c9b-checkpoint|M20-C9B — Checkpoint e migração entre computadores]] — Homologação staging, recuperação da WIP e pendência PDF ainda aberta.
- [[system-status|Matriz de Status do Sistema]] — Inconsistências catalogadas e histórico de módulos.
- [[development/multi-agent-workflow|Protocolo Multiagente Permanente V2]] — Codex nativo, Sol para orquestração/revisão e Luna para workers; políticas de teste e limites.
- [[development/github-ai-handoff|Handoff de IA, GitHub e Antigravity]] — Integração operacional entre ferramentas e canais.

---

## 🎵 Repertório, Versões e Smart Chords

- [[handoffs/2026-10-25-r4-m14-windows|R4-M14 / R4-M15 — Correção de Bloqueios e Compatibilidade de Repertório]]
- [[handovers/2026-10-22-repertoire-wip|WIP de Repertório e Versões (Handoff Histórico)]]
- [[exec-plans/active/2026-10-20-mobile-m20-smart-chords-import-hub|ExecPlan Ativo — M20 Mobile Smart Chords Import Hub]]
- [[exec-plans/completed/2026-10-25-r4-m13-release-blockers|ExecPlan Concluído — R4-M13 Release Blockers]]
- [[exec-plans/completed/2026-10-25-r4-m11-monospace-rendering|ExecPlan Concluído — R4-M11 Monospace Rendering]]
- [[exec-plans/completed/2026-10-25-r4-m10-reader-layout|ExecPlan Concluído — R4-M10 Reader Layout]]
- [[exec-plans/completed/2026-10-16-mobile-m19-smart-chords-repertoire-relinking|ExecPlan Concluído — M19 Smart Chords Repertoire Relinking]]

---

## 🏛️ Arquitetura e Contratos Compartilhados

- [[architecture/overview|Visão Geral da Arquitetura]]
- [[architecture/project-structure|Estrutura de Pastas e Módulos]]
- [[architecture/runtime-flow|Fluxo de Execução da Aplicação]]
- [[architecture/integrations|Integrações Externas]]
- [[architecture/billing-transition-v1-technical-design|Desenho Técnico da Transição de Faturamento V1]]
- [[security/authorization-matrix|Matriz de Permissões e RBAC]]
- [[security/authentication-authorization-audit|Auditoria de Autenticação e Segurança]]

---

## 💻 Web e 📱 Mobile

- [[mobile/architecture|Arquitetura Mobile (Flutter Android-first)]]
- [[mobile/release|Processo de Release e Distribuição Mobile]]
- [[mobile/rel2-verification|Verificação Operacional Mobile Rel2]]
- [[development/conventions|Convenções de Código (TypeScript, Express, React)]]

---

## 💳 Negócio, Planos e Faturamento SaaS

- [[product/plans-and-limits|Planos, Quotas e Limites de Uso]]
- [[product/system-overview|Visão Funcional do Sistema LouvAIO]]
- [[decisions/2026-09-01-billing-transition-policy-v1|Política de Transição de Faturamento V1]]
- [[decisions/2026-08-28-commercial-plans-and-addons|Planos Comerciais e Add-ons]]
- [[operations/billing-architecture|Arquitetura de Faturamento Asaas]]
- [[operations/asaas-sandbox-homologation|Homologação em Sandbox do Asaas]]
- [[operations/cost-model|Modelo de Custos e Projeções]]

---

## 🧪 Desenvolvimento, Testes e Validação

- [[development/testing|Guia de Testes (Vitest, Playwright, Flutter)]]
- [[development/validation|Critérios e Protocolos de Validação]]
- [[development/billing-sandbox-bootstrap|Ambiente de Testes do Sandbox de Cobrança]]
- [[development/getting-started|Guia de Configuração do Ambiente]]

---

## 📋 Planos de Execução (ExecPlans)

- **Ativos:**
  - [[exec-plans/active/2026-10-20-mobile-m20-smart-chords-import-hub|M20 — Smart Chords Import Hub (Mobile)]]
  - [[exec-plans/active/2026-09-18-provider-polymorphic-identity-claim-verification|Verificação Polimórfica de Identidade]]
- **Histórico Completo:**
  - Consultar pasta `docs/exec-plans/completed/`.

---

## ⚠️ Pendências e Bloqueios Confirmados

| Item | Status | Observações |
| --- | --- | --- |
| **Blocker A (Historical Aliases)** | VALIDATED | Resolvido e integrado na WIP via PR #20 (commit `9f4f0bb`). |
| **Blocker B (Orphan Classifications)** | VALIDATED | Resolvido e integrado na WIP via PR #20 (commit `9f4f0bb`). |
| **R4-M15 Integração na WIP** | INTEGRATED | Integrado à WIP `wip/repertoire-versions-smartchords-20261022` via PR #20 (`9f4f0bb`). |
| **Preview CORS** | PENDING | Allowlist exata da origem Web Preview pendente de configuração operacional (não usar wildcard). |
| **JWT Operational Check** | UNKNOWN / PENDING | Chave JWT em preview/produção deve ser confirmada operacionalmente sem expor segredos. |
| **Vercel Backend Build** | PENDING | Falha de infraestrutura do adaptador `fsPath` no deploy da Vercel. |
| **Suíte completa Backend (Zernio)** | BLOCKED | 1 teste requer Firebase Emulator indisponível no ambiente local. |
| **Redesign Mobile** | PENDING | Mantido isolado para não introduzir instabilidade na WIP de repertório. |

---

## 🔗 Links Relevantes do GitHub

- [Repositório Principal (`henriquecesarth/praise-app`)](https://github.com/henriquecesarth/praise-app)
- [Branch de Desenvolvimento (`wip/repertoire-versions-smartchords-20261022`)](https://github.com/henriquecesarth/praise-app/tree/wip/repertoire-versions-smartchords-20261022)
- [Issues Abertas](https://github.com/henriquecesarth/praise-app/issues)
- [Pull Requests](https://github.com/henriquecesarth/praise-app/pulls)
- [GitHub Actions Workflows](https://github.com/henriquecesarth/praise-app/actions)
