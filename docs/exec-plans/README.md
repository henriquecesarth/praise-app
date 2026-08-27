# Execution Plans

ExecPlan é um documento vivo para mudanças relevantes. Ele registra objetivo, comportamento atual/desejado, escopo, impacto, passos, testes, validação, riscos e decisões.

## Lifecycle

1. Crie o plano em active/ antes de implementar mudança não trivial.
2. Atualize checkboxes e Progress Notes durante o trabalho.
3. Registre decisões que alteram o plano.
4. Ao concluir, preencha Final Result.
5. Mova o arquivo para completed/.

Não crie planos falsos para preencher diretórios. Tarefas triviais e puramente locais podem não exigir ExecPlan.

## Naming

    YYYY-MM-DD-short-change-name.md

## Template

    # <Feature / Change>

    ## Objective

    ## Context

    ## Current Behavior

    ## Desired Behavior

    ## Scope

    ### In Scope

    ### Out of Scope

    ## Architecture Impact

    ## Implementation Plan

    - [ ] Step 1
    - [ ] Step 2

    ## Files Expected to Change

    ## Tests

    ## Validation

    ## Risks

    ## Decisions

    ## Progress Notes

    ## Final Result

## Relationship to MEMORY.md and ADRs

- ExecPlan: detalhes e progresso de uma mudança.
- MEMORY.md: conhecimento durável e pequeno; não copie o diário do plano.
- ADR: decisão arquitetural durável e suas alternativas.

Um plano concluído pode continuar registrando limitações; não declare sucesso se validações necessárias falharam.
