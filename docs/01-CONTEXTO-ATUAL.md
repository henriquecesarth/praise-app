---
tags:
  - louvaio
  - contexto
type: context
snapshot: 2026-10-26
status: atualizar-com-evidencias
---

# LouvAIO — Contexto operacional compacto

## Verificado na branch `wip/repertoire-versions-smartchords-20261022`

- **Produto:** LouvAIO, solução para ministérios de louvor.
- **Web:** React/Vite e PWA; chamadas HTTP em `web/src/api.ts`.
- **Backend:** Express, Firestore, autenticação e regras multi-tenant.
- **Mobile:** Flutter em `mobile/`, testes em `mobile/test/`.
- **CI:** workflows em `.github/workflows/`, incluindo Android/Flutter.
- **Agentes:** definições Antigravity em `.agents/agents/` e configurações Codex em `.codex/agents/`.
- **Regras:** `AGENTS.md` para arquitetura e limites, `GEMINI.md` para fluxo de agente, `docs/system-status.md` para inconsistências.
- **Histórico:** `MEMORY.md` existe e é extenso; ler exclusivamente seções relevantes, pois não é a fonte primária de status.

## Frentes relevantes

- Repertório, versões e vínculos com Smart Chords.
- Paridade entre Web e Mobile.
- Segurança de tenant, permissões e preservação dos contratos.
- Validação no Android (Flutter, testes, APK, hardware quando aplicável).
- Fluxos SaaS de assinatura e pagamentos (especialistas próprios).

## Branches e PRs

- `main` é a referência de produção Web no snapshot verificado; não significa que incorpora todas as mudanças WIP.
- `wip/repertoire-versions-smartchords-20261022` possui trabalho ainda não necessariamente integrado a `main`.
- Um PR de desenvolvimento dependente dessa WIP **não deve ter `main` como base automaticamente**.
- Consulte `git branch -vv`, `gh pr list` e os workflows para verificar o estado **atual** antes de toda tarefa.

## Verificação obrigatória de contexto

1. Confirme checkout, HEAD e working tree.
2. Leia `AGENTS.md`, plano ativo relevante e docs da área.
3. Inspecione código e testes relevantes.
4. Compare documentação com comportamento executável.
5. Classifique incertezas como **Unknown / Not yet verified**, não como concluído.

**Atualização:** a cada mudança durável de arquitetura, contrato ou milestone, atualizar apenas os links e fatos pertinentes aqui. Logs temporários de agentes devem ficar no PR/Issue, não neste resumo.
