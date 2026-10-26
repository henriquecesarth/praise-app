---
aliases:
  - Contexto Atual LouvAIO
  - Estado Operacional
tags:
  - louvaio
  - contexto
  - fontes-de-verdade
type: context
snapshot: 2026-10-26
status: ativo
---

# LouvAIO — Contexto Operacional Compacto e Estado Verdadeiro

> **Vault do Obsidian:** `praise-app/docs` | **Branch Base:** `wip/repertoire-versions-smartchords-20261022` | **Branch R4-M15:** `fix/r4-m15-release-blockers`
> Este documento registra o **estado operacional real** do projeto com base em evidências verificáveis, distinguindo rigorosamente o que foi homologado, o que está corrigido localmente e o que permanece pendente.

---

## 1. Matriz de Status dos Componentes e Milestones

| Componente / Milestone | Status | Evidência / Detalhes Operacionais |
| :--- | :--- | :--- |
| **R4-M11 Android (Monospace Rendering)** | `VALIDATED` | Homologado em build Android e suíte Flutter (`cd mobile && flutter test`, 596 testes PASS). Hotfix de renderização monospace intrinsicamente dimensionada com rolagem horizontal e quebra de palavras validado. |
| **M20 Phase 1 (Smart Chords Import Hub)** | `VALIDATED` | Fase 1 do Import Hub mobile homologada. |
| **R4-M13 (Release Blockers Checkpoint)** | `VALIDATED` (Local) | Preservado no checkpoint Windows (`backup/r4-m14-windows-handoff-20261025`, SHA `8038bf5b1ec8acf0c6ee9e900ed7f3e64d8d3322`). Implementou rejeição de segredo JWT padrão em produção/preview e preservação de omissão de BPM. |
| **R4-M14 (Revisão Independente)** | `VALIDATED` | Identificou 2 bloqueios de regressão na persistência de repertório (Blocker A: aliases históricos de links; Blocker B: limpeza indevida de classificações órfãs em edições não relacionadas). |
| **R4-M15 (Remediação de Bloqueios)** | `VALIDATED` (Local) | Implementado e verificado no commit `3aa3ed6bd363c4ca584f0f68f334a6d1f983b65d`. Cobertura: 64 testes backend de integridade (`repertoire.integrity.test.ts`), 74 testes Web de contrato (`api.bpm-contract.test.tsx`), suíte Web completa (643 PASS), builds Backend/Web PASS. Revisão independente Codex aprovada após ajuste P2. |
| **R4-M15 Integração à WIP** | `PENDING` | Branch `fix/r4-m15-release-blockers` pronta para publicação controlada e Draft PR para `wip/repertoire-versions-smartchords-20261022`. Não integrada nem publicada ainda. |
| **Preview CORS Configuration** | `PENDING` | Origem exata do Web Preview ausente da allowlist configurada. Requer ajuste operacional isolado em variáveis de ambiente de Preview (nunca utilizar wildcard com credenciais). |
| **Verificação Operacional JWT** | `UNKNOWN / PENDING` | Existência da variável `JWT_SECRET` confirmada na configuração, mas o valor seguro injetado nos deploys de preview/produção permanece *Unknown / Not yet verified*. |
| **Build Vercel Backend (`fsPath`)** | `PENDING` | Falha conhecida no adaptador de build do projeto Vercel para a pasta `backend`. Requer intervenção na configuração de infraestrutura do provedor, fora do código de domínio. |
| **Suíte Completa Backend (Zernio)** | `BLOCKED` | 1 teste do módulo Zernio depende de Firebase Emulator local não configurado. Não bloqueia o domínio de repertório/autenticação/faturamento. |
| **Redesign Mobile** | `PENDING` | Mantido em branch separada, desvinculado da atual WIP de repertório e Smart Chords. |

---

## 2. Conhecimento Durável — Decisões e Correções R4-M14 / R4-M15

As falhas detectadas em R4-M14 e sanadas em R4-M15 estabelecem decisões duráveis sobre integridade e persistência:

### A. Compatibilidade de Aliases Históricos de Links
- **Problema:** No modelo legado, links da versão primária do tipo `YouTube`, `MP3` e `Chord` podiam possuir `isCustom: true`, embora alimentassem os campos planos de compatibilidade (`youtube_url`, `audio_url`, `chord_sheet_url`). Ao renomear uma versão ou submeter seus links, o backend reclassificava esses links como externos (`external_links`), apagando os campos planos e desmarcando filtros como `has_youtube`.
- **Decisão:** O `RepertoireRepository.synchronizeLinks` utiliza inferência contextual via `WeakMap`. Se a versão primária for mantida e contiver link com flag `isCustom: true` correspondente ao URL do campo plano legado existente, esse link é preservado na categoria padrão e mantém o campo plano. Links customizados criados deliberadamente via `external_links`, promovidos de versões secundárias ou com `id` próprio customizado permanecem isolados em `external_links`.

### B. Preservação de Classificações Órfãs
- **Problema:** Um documento com classificação legada apagada (`classification_id: "deleted"`) e `versions[0].classificationIds: []` perdia esse valor quando o usuário editava apenas o título ou artista da música na Web. O formulário omitia o `bpm`, mas enviava `classificationIds: []`, interpretado pelo backend como intenção de limpar a classificação para `null`.
- **Decisão:** Diferenciação estrita entre **omissão** e **limpeza explícita**. A Web (`CreateSongModal` e `VersionEditModal`) rastreia se o usuário interagiu com os chips de classificação (`touchedClassificationVersionIds`). Edições que não alteram classificações omitem `classificationIds`/`classification_ids` do payload de patch, preservando o valor pré-existente (`classification_id: "deleted"`).

### C. Semântica de Omissão vs. Limpeza Explícita
- Campo omitido no payload = **preservar valor pré-existente** no documento Firestore.
- Campo enviado com `[]` ou `null` = **limpeza deliberada** solicitada pelo usuário.

### D. Preservação de BPM
- O `bpm` de versões existentes é preservado caso não tenha sido modificado na UI, evitando reset acidental ou sobrescrita por valores padrão.

### E. Integridade de Contratos Web e Backend
- O frontend (`api.ts`, modais e componentes) deve serializar com precisão a intenção do usuário, sem emitir arrays vazios como efeito colateral de formulários não tocados.

### F. Protocolo de Revisão e Regressão
- Nenhuma alteração de persistência em documentos polimórficos ou versionados pode ser considerada concluída sem testes focados de payload serializado (Web) e integridade de persistência (Backend).

---

## 3. Fontes de Verdade e Hierarquia Operacional

A ordem de precedência obrigatória para qualquer agente ou desenvolvedor é:

1. **Código e configuração atuais;**
2. **Testes executáveis verificados;**
3. **`AGENTS.md` e documentos específicos da tarefa em `docs/` (começando por este arquivo);**
4. **Trechos pertinentes de `MEMORY.md` (contexto histórico durável);**
5. **Documentação histórica.**

> [!WARNING]
> Nunca carregar o `MEMORY.md` integralmente por padrão no prompt de contexto. Consulte apenas as seções relacionadas ao escopo da tarefa em execução.

---

## 4. Regras de Integração e Git

- **Base de desenvolvimento:** `wip/repertoire-versions-smartchords-20261022` é a branch ativa de desenvolvimento.
- **Não usar `main` automaticamente:** Qualquer PR derivado do trabalho de repertório/Smart Chords deve ter como alvo a branch WIP, a menos que haja autorização explícita em contrário.
- **Sem ações destrutivas:** Proibidos `git push --force`, reescrita de histórico em branches compartilhadas, merge automático, deploys manuais e escritas em bancos de dados de produção.
- **Isolamento de PRs:** PR #17 (Obsidian / fluxo multiagente) e PR #18 (supervisor experimental) são propostas separadas que não devem ser integradas de forma indiscriminada.
