# LouvAIO — Handoff para Agentes de IA (`AI_AGENT_HANDOFF.md`)

Este documento permite que o **Codex** (agente principal) ou o **Gemini / Antigravity** (ferramenta opcional) assuma imediatamente o desenvolvimento no novo computador, **sem necessidade de reler históricos de conversa anteriores**.

---

## 1. Contexto Rápido e Localização das Regras

- **Regras Obrigatórias do Repositório:** Leia `AGENTS.md` (na raiz) uma única vez no início da sessão. Caso esteja no Gemini, consulte também `GEMINI.md`.
- **Política Multi-Agente:** `docs/development/multi-agent-workflow.md`.
- **Configurações Nativas de Agentes:**
  - `.codex/config.toml` e `.codex/agents/*.toml` (para Codex CLI).
  - `.agents/agents/*/agent.md` (definições canônicas dos 6 papéis: `product-architect`, `feature-engineer`, `feature-reviewer`, `billing-engineer`, `billing-reviewer`, `sandbox-auditor`).
- **Estado Atual Detalhado:** `docs/development/CURRENT_PROJECT_STATE.md`.
- **Setup da Máquina:** `docs/development/NEW_COMPUTER_SETUP.md`.

---

## 2. Arquitetura Essencial do LouvAIO

- **Monorepo em 3 camadas:**
  - `backend/`: API Express + TypeScript estrito + Zod + Firestore (`route → middleware → controller → service → repository → Firestore`).
  - `web/`: SPA/PWA React 19 + Vite + Tailwind CSS v4. Toda comunicação HTTP passa por `web/src/api.ts`; componentes nunca acessam o cliente Firebase diretamente.
  - `mobile/`: Cliente Flutter (`mobile/lib/features/`) com Riverpod.
- **Invariantes de Domínio e Segurança:**
  - `ministryId` é o identificador canônico de tenant (preservando aliases `groupId` existentes).
  - Ownership e permissões são sempre derivados da sessão autenticada no backend (anti-IDOR).
  - **Smart Chords (`Cifras Inteligentes`)** são pessoais por `user_id`; vincular uma cifra a uma música do repertório do ministério **não** compartilha a cifra privada com outros usuários.
  - **Asaas** é a autoridade financeira; `SubscriptionService` governa quotas e direito de uso (fail-closed em incerteza de provedor).

---

## 3. Checkpoints e Linha de Base na Branch `handoff/louvaio-workstation-migration`

Esta branch consolida de forma limpa e auditada:
1. **M20 R16 Web/Backend:** `29d09f1b2cf1d94aa8f5e84d77f906a6a88ae6f8`
2. **M20 Android Production:** `11b57976b56130d79ecbe032f8b442358fc8f796`
3. **Integração M20 C16:** `4e4690eb2d0032c485a571c81c0a2a2f2e06e9b0`
4. **M21 Exercícios Vocais (Web + Android + 14 samples FreePats Upright Piano KW):** `f3aed6cdb487f965985f2cfcce5d89d414af5e3b` + evidências R4 (`docs/exec-plans/evidence/m21-2/`)
5. **Design D1 (Auditoria + Design System v1.0 + Protótipos):** `dfe3b96120dff6d61da4e112f15241296bf6d940` (`docs/design/`)
6. **Design D2-A (Fundação do Design System v1.0 + Leitor Musical Dedicado com Rolagem Automática):** Implementado em `web/src/` e validado em `docs/exec-plans/2026-11-06-d2-a-design-system-reader.md` e `docs/exec-plans/evidence/d2-a/`.

---

## 4. Restrições de Segurança e Governança

> [!IMPORTANT]
> - O repositório `henriquecesarth/praise-app` é **PÚBLICO**. Jamais faça commit ou push de `.env`, tokens, chaves privadas, keystores ou dados pessoais reais.
> - Não faça push, PR, merge, deploy (Vercel/Firebase) ou publicação na Google Play sem autorização explícita do proprietário para a etapa específica.
> - Não modifique a branch `main` nem os PRs `#21`, `#22` ou `#23`.
> - Na Web, `web/src/config/publish-guard.ts` exige `npx vite build --mode test` para builds locais fora do ambiente Vercel publicado.

---

## 5. Decisões Arquiteturais e Visuais Obrigatórias (D1 / D2-A)

- **Marca:** `LouvAIO` (nunca adicionar "2.0"). Paleta oficial: Verde Profundo (`#0F2A1F`), Terracota (`#B85A3C` / `#AE5235`) e Creme (`#F5EFE6`).
- **Cifras Inteligentes (`SmartChordsWorkspace`):**
  - Ao abrir uma cifra salva na biblioteca (`SmartChordsLibrary`), ela abre diretamente no **Leitor Musical Dedicado (`workspaceMode = 'read'`)**.
  - Ao clicar em `Criar Cifra`, abre no **Editor (`workspaceMode = 'edit'`)**.
  - `Editar` e `Visualizar` são modos estritamente exclusivos (`data-workspace-mode="read" | "edit"`). Nunca renderizar editor e preview lado a lado visíveis simultaneamente.
  - A rolagem automática (`SmartChordReader.tsx`) opera sobre o container real renderizado (`data-testid="reading-sheet-scroll"`), sincroniza com rolagem manual, pausa automaticamente quando a aba/tela fica inativa (`visibilitychange`, `blur`, `isActive=false`) e respeita `prefers-reduced-motion: reduce`.
  - Preservar 100% do alinhamento caractere a caractere (`rawToVisual` / `visualToRaw`), edição inline de acordes na sílaba, tablaturas, progressões de compassos e exportação PDF A4.

---

## 6. Próxima Implementação

1. **Integração Seletiva P1–P8 (Smart Chords):**
   Inspecionar e integrar seletivamente as melhorias de parser/notação musical e testes das branches remotas:
   - `origin/parallel/regression-musical-20261107` (`fd4abf27`)
   - `origin/parallel/smart-chords-notation-20261107` (`6267adf1`)
   - `origin/parallel/smart-chords-notation-p3-20261107` (`604c3ef2`)
   - `origin/parallel/smart-chords-p4-p6-20261107` (`3e8e2cfc`)
   - `origin/parallel/smart-chords-p7-p8-20261107` (`1bac4f55`)
   **Regra de ouro:** Preservar a implementação visual do **D2-A** (`SmartChordReader.tsx`, `SmartChordToolbar.tsx`, `SmartChordsLibrary.tsx`, `SmartChordEditor.tsx`, `workspace.css`) como referência para o leitor e editor visual.
2. **Fase D2-B (após aprovação do proprietário):**
   Implementar o redesign da Biblioteca de Repertório e tela de detalhes/versões da música seguindo `docs/design/D1_Especificacao_Repertorio_e_Cifras.md` e `docs/design/LouvAIO_Design_System_v1_0.md`.

---

## 7. Prompt Curto de Retomada (Copiar e Colar no Novo Computador)

```text
Leia AGENTS.md, docs/development/CURRENT_PROJECT_STATE.md e docs/development/AI_AGENT_HANDOFF.md.
Estamos no novo computador na branch handoff/louvaio-workstation-migration (que já contém M20 R16, M21 Vocal, D1 e D2-A validados).
Verifique git status e aguarde minha instrução para iniciar a integração seletiva das branches paralelas P1–P8 do Smart Chords (preservando o D2-A como referência para o leitor e editor visual) ou avançar para a etapa D2-B.
```
