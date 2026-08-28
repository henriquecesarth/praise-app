# Decisão Arquitetural: Estrutura Comercial de Planos e Add-ons de Membros

- **Data**: 2026-08-28
- **Status**: Aceita
- **Contexto**: Definição da matriz comercial do LouvAIO composta por seis planos e suporte arquitetural a add-ons de capacidade de membros sem cobrança real inicial.

## Decisão

1. **Definição dos Planos**:
   - `free`: 10 membros base, 50 músicas, sem add-on;
   - `lite`: 20 membros base, 100 músicas, sem add-on;
   - `lite_plus`: 30 membros base, 150 músicas, sem add-on (exibido como **Lite+** na UI);
   - `essential`: 40 membros base, 200 músicas, permite add-on de membros;
   - `pro`: 100 membros base, 500 músicas, permite add-on de membros;
   - `premium`: membros ilimitados, músicas ilimitadas.

2. **Regras de Add-on de Membros**:
   - Cada bloco de add-on adiciona **+10 membros** à capacidade do ministério;
   - A quantidade máxima de blocos adicionais não é fixa no código e sim configurável por plano;
   - Tetos iniciais provisórios:
     - `essential`: até 4 blocos adicionais (limite de até 80 membros);
     - `pro`: até 10 blocos adicionais (limite de até 200 membros);
   - Não haverá cobrança real nesta etapa inicial (apenas modelagem de dados e regras de cálculo de capacidade).

3. **Centralização de Configuração**:
   - Todos os limites e tetos devem ser mantidos centralizados em módulo de configuração para permitir alteração dinâmica sem refatorações estruturais.

## Consequências

- Modelo de limites claro e escalável para futura integração de gateways de pagamento;
- Identificador técnico `lite_plus` padronizado para compatibilidade em bancos de dados e APIs;
- Capacidade de membros calculada parametricamente por `membros_base + (blocos_adicionais * 10)`.
