---
aliases:
  - Protocolo Multiagente Permanente V2
  - Multi-agent Workflow
tags:
  - louvaio
  - agentes
  - workflow
  - protocolo
type: runbook
status: ativo
---

# LouvAIO — Protocolo Multiagente Permanente V2

## 1. Princípio Fundamental e Objetivo

O objetivo deste protocolo é entregar **software funcional, correto e validado no menor tempo total possível**, com máxima economia de esforço e sem retrabalho.

> [!IMPORTANT]
> **Não criar frameworks, supervisores, scripts de automação ou configurações experimentais adicionais.**
> O paralelismo deve ser aplicado exclusivamente onde houver ganhos práticos reais. Tarefas simples devem ser executadas diretamente pelo agente ativo sem coordenação desnecessária.

---

## 2. Hierarquia de Modelos

A colaboração entre modelos segue uma divisão estrita de papéis:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      Argon High (Estratégia)                           │
│  - Decisões arquiteturais complexas e contratos compartilhados         │
│  - Segurança multi-tenant crítica e integridade de persistência        │
│  - Resolução de bloqueios profundos e desambiguação técnica            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (Delegação e contratos congelados)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 Gemini Flash (Implementação e Execução)                │
│  - Exploração do código, endpoints, componentes Web e Mobile           │
│  - Implementação de testes automatizados e correções de bugs           │
│  - Documentação operacional e execução direta de validações            │
│  - Preferir Gemini Flash 3.8 High quando disponível no ambiente        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (Diff estável / Commit local)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Codex (Revisão Independente)                       │
│  - Auditoria de segurança, autenticação e isolamento multi-tenant      │
│  - Compatibilidade de contratos de API e integridade de persistência   │
│  - Detecção de regressões, confiabilidade dos testes e concorrência    │
└────────────────────────────────────────────────────────────────────────┘
```

### Argon High — Arquiteto e Coordenador Estratégico
- **Atribuições:** Arquitetura de sistemas, decisões técnicas difíceis, definição de contratos compartilhados entre Backend, Web e Mobile, segurança multi-tenant crítica e resolução de bloqueios que superem a capacidade dos workers.
- **Disciplina:** O Argon não deve realizar trabalho braçal ou operacional rotineiro quando puder delegar com segurança; tampouco deve ser acionado para tarefas triviais.

### Gemini Flash — Implementação e Execução Rápida
- **Atribuições:** Modelo preferencial para investigar código, implementar endpoints e componentes delimitados, escrever testes unitários e de integração, corrigir bugs, atualizar documentação e rodar validações.
- **Variante:** Quando disponível no runtime, preferir a variante `Gemini Flash 3.8 High`. Nunca afirmar uma variante ou nível de raciocínio (thinking level) não explicitamente exposto pelo runtime.

### Codex — Revisão Independente de Mudanças de Código
- **Atribuições:** Revisão independente e estrita de diffs ou commits estáveis. Foca em:
  - Segurança, autenticação, anti-IDOR e RBAC;
  - Integridade de dados e regras de persistência Firestore;
  - Compatibilidade de contratos de API e paridade Web/Mobile;
  - Prevenção de regressões e suficiência da cobertura de testes;
  - Concorrência e isolamento entre ministérios.
- **Disciplina de Revisão:** A revisão deve fornecer evidências concretas, arquivos e linhas afetados. **Não realizar uma revisão extensa com Gemini imediatamente antes de uma revisão Codex equivalente** para evitar desperdício de contexto e tempo.

### Regras de Delegação e Eficiência
- Delegar a subagentes apenas quando houver **ganho real de produtividade ou isolamento**.
- Limite máximo recomendado de **2 workers de implementação concorrentes**.
- **Propriedade estrita de arquivos:** Exatamente um escritor por arquivo. Se dois módulos precisam tocar o mesmo arquivo, eles devem ser sequenciados.
- Investigações paralelas devem ser somente de leitura (`read-only`).
- Não criar worktrees Git automaticamente sem necessidade justificada.
- Não delegar tarefas triviais que possam ser concluídas de imediato no fluxo ativo.
- Nunca declarar delegação bem-sucedida sem evidência real de conclusão.

---

## 3. Política de Testes e Validação

Todo worker deve executar as validações cabíveis ao seu escopo e registrar os resultados reais.

### Antes de executar suítes de teste:
1. **Identificar dependências externas:** Verificar se o teste requer rede, Firebase Emulator ou serviços locais.
2. **Ambiente e variáveis:** Garantir que dependências obrigatórias estejam presentes antes de invocar comandos amplos.
3. **Priorizar testes direcionados:** Durante a implementação, rodar testes focados no arquivo ou funcionalidade modificada.
4. **Timeouts razoáveis:** Estabelecer limite de tempo razoável para processos de teste.
5. **Captura de logs e códigos de saída:** Registrar exit codes e mensagens de erro reais.
6. **Sem polling indefinido:** Nunca aguardar processos em loop ativo infinito. Encerrar graciosamente processos travados.
7. **Mudanças exclusivamente documentais:** **Não reexecutar suítes completas de código** quando a tarefa consistir unicamente em documentação, notas ou planos sem impacto sobre código executável.
8. **Código alterado após revisão:** Se o código for alterado para sanar apontamentos de revisão, os testes pertinentes devem ser executados novamente.

### Classificação Estrita de Resultados
- `PASS`: O teste executou até o fim e passou com sucesso comprovado por log.
- `FAIL`: O teste falhou, com erro ou asserção quebrada visível no log.
- `NOT_EXECUTED`: O teste não foi executado (por exemplo, por desnecessidade em mudanças documentais).
- `BLOCKED`: O teste não pôde rodar por impedimento externo (ex: ausência de Firebase Emulator ou credencial de teste).

---

## 4. Fluxo Padrão de Implementação (8 Etapas)

```
[1. Discovery] ➔ [2. Planejamento] ➔ [3. Delegação] ➔ [4. Implementação]
       │
       ▼
[5. Integração & Testes] ➔ [6. Revisão Independente] ➔ [7. Documentação] ➔ [8. Entrega]
```

### Etapa 1 — Discovery
- A tarefa é recebida diretamente pelo chat ou por canal explícito (GitHub Issues são **opcionais**, não obrigatórias).
- Confirmar branch-base (geralmente branch WIP, e.g. `wip/repertoire-versions-smartchords-20261022`), estado do código, funcionalidade afetada, contratos e critérios de aceite.

### Etapa 2 — Planejamento
- Tarefas simples recebem um resumo breve de plano.
- Tarefas complexas recebem um ExecPlan estruturado em `docs/exec-plans/active/`.
- Não produzir planos extensos para ajustes pontuais.

### Etapa 3 — Delegação
- Decompor apenas subtarefas genuinamente independentes.
- Escolher o modelo adequado à complexidade (Flash para execução, Argon para arquitetura complexa).
- Dar autonomia ao worker para investigar, implementar e testar seu escopo.

### Etapa 4 — Implementação
- Respeitar a posse exclusiva de arquivos.
- Contratos compartilhados (API/tipos) devem ser congelados antes do trabalho paralelo entre Backend, Web e Mobile.

### Etapa 5 — Integração e Testes
- Consolidar as alterações na branch de trabalho.
- Executar os testes direcionados pertinentes e verificar a integridade da persistência e contratos.

### Etapa 6 — Revisão Independente
- Codex revisa o diff ou commit estável.
- Apontamentos de gravidade real (P1/P2) devem ser corrigidos pelo worker responsável.
- Se houver alteração de código, revalidar os testes afetados.

### Etapa 7 — Documentação
- Atualizar a base de conhecimento no Obsidian (`praise-app/docs`), mantendo `docs/00-PAINEL.md` e `docs/01-CONTEXTO-ATUAL.md` em sincronia com os fatos.
- Registrar decisões duráveis em `MEMORY.md` apenas de forma concisa.
- Mover ExecPlans concluídos para `docs/exec-plans/completed/`.

### Etapa 8 — Entrega
- Relatar objetivamente commits, testes executados, revisões, riscos, estado da funcionalidade e próximos passos.

---

## 5. Papéis de Agentes LouvAIO (.agents/agents/)

O repositório mantém seis papéis canônicos de agentes:

1. `product-architect`: Arquiteto de produto e domínio. Atua na descoberta técnica, modelagem de dados, separação de módulos e desenho de contratos compartilhados antes da implementação.
2. `feature-engineer`: Especialista em implementação de funcionalidades de produto (Backend Express, Web React/Vite, regras multi-tenant, Firestore e testes).
3. `feature-reviewer`: Revisor independente somente-leitura de funcionalidades de produto. Foca em isolamento multi-tenant, RBAC, anti-IDOR, segurança de APIs e cobertura de testes.
4. `billing-engineer`: Especialista na implementação do módulo de faturamento (Billing Transition V1, gateway Asaas, planos, quotas recorrentes e máquinas de estado financeiras).
5. `billing-reviewer`: Revisor independente do módulo financeiro. Foca em segurança financeira, concorrência, idempotência de webhooks, estados de grace e estanqueidade de tenants.
6. `sandbox-auditor`: Especialista em homologação em Sandbox de provedores de pagamento (Asaas). Realiza testes de prova de conceito e validação de contratos externos.

---

## 6. O Obsidian como Base de Conhecimento Central

- O diretório `praise-app/docs` constitui o vault oficial do Obsidian para a equipe.
- O código-fonte no Git permanece a fonte primária de verdade da lógica do software; o Obsidian organiza o conhecimento acumulado, diagramas, contratos e decisões duráveis.
- A navegação parte de `[[00-PAINEL]]` e `[[01-CONTEXTO-ATUAL]]`.
- Pastas de configuração do Obsidian (`docs/.obsidian/`) permanecem ignoradas pelo Git (`.gitignore`) para isolar preferências visuais pessoais de cada operador.

---

## 7. Guardrails e Limites Operacionais Estritos

> [!CAUTION]
> Os seguintes limites são intransponíveis para qualquer agente autônomo sem autorização explícita:
>
> 1. **Nenhum `git push` ou criação de PR sem autorização explícita humana.** Quando autorizado, preparar comandos e Draft PR.
> 2. **Nunca utilizar `main` como base de PR automaticamente** quando o trabalho for derivado de uma branch WIP (e.g. `wip/repertoire-versions-smartchords-20261022`).
> 3. **Nunca realizar merge automático** de branches ou PRs.
> 4. **Nunca realizar deploy automático** em ambientes de Preview ou Produção (Vercel, Firebase Hosting, lojas de apps).
> 5. **Nunca escrever no Firebase Firestore de produção** nem acessar credenciais ativas.
> 6. **Nunca expor chaves privadas, tokens ou senhas** em logs, commits ou documentação.
