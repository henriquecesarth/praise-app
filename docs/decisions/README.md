# Architecture Decision Records

Use este diretório para decisões técnicas duráveis que afetem múltiplas áreas, contratos públicos, persistência, segurança, dependências ou operação.

Não crie ADR para uma escolha local óbvia ou para repetir o que o código já demonstra. Trabalho em andamento pertence primeiro a um ExecPlan.

## Naming

    YYYY-MM-DD-short-decision-name.md

## When to Record

- troca/adição de banco, framework ou integração;
- estratégia de autenticação/autorização;
- contrato ou versionamento de API;
- schema/migration do Firestore;
- introdução de testes, CI/CD ou deploy;
- mudança de fronteira de tenant;
- decisão com alternativas relevantes e consequência de longo prazo.

## Template

    # Decision: <title>

    ## Status

    Proposed / Accepted / Superseded

    ## Context

    ## Decision

    ## Alternatives Considered

    ## Consequences

    ## Evidence

Se supersedido, indique o ADR substituto. Nunca inclua secrets ou valores reais de ambiente.

## Existing Decisions

Nenhum ADR formal existia quando o harness foi criado. A arquitetura atual é documentada como estado observado, não retroativamente justificada por ADRs inventados.
