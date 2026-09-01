# Estrutura Comercial e Planos LouvAIO

Definição oficial dos planos de assinatura, limites base, preços e add-ons de membros do **LouvAIO**.

> [!IMPORTANT]
> **Fonte Única da Verdade Técnica**: O arquivo [`backend/src/config/plans.config.ts`](file:///Users/henrique/Documents/code%20projects/praise-app/praise-app/backend/src/config/plans.config.ts) é a autoridade normativa para identificadores técnicos, preços em centavos, limites base e fórmulas de cálculo.

---

## 1. Tabela de Planos e Capacidades

| Plano | Identificador Técnico | Membros Base | Músicas | Preço Mensal | Preço Anual (10% OFF) | Add-on de Membros |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Free** | `free` | 10 | 50 | R$ 0,00 | R$ 0,00 | Não permite |
| **Lite** | `lite` | 20 | 100 | R$ 14,90 | R$ 160,92 | Não permite |
| **Lite+** | `lite_plus` | 30 | 150 | R$ 24,90 | R$ 268,92 | Não permite |
| **Essential** | `essential` | 40 | 200 | R$ 34,90 | R$ 376,92 | Sim (blocos de +10, máx 4) |
| **Pro** | `pro` | 100 | 500 | R$ 89,90 | R$ 970,92 | Sim (blocos de +10, máx 10) |
| **Premium** | `premium` | 300 | 1.500 | R$ 214,90 | R$ 2.320,92 | Não necessita |

> [!NOTE]
> O identificador técnico para **Lite+** é `lite_plus`. O nome de apresentação exibido ao usuário é **Lite+**.

---

## 2. Modelagem de Add-ons de Membros

- **Tamanho do Bloco**: Cada bloco adicional acrescenta **+10 membros**.
- **Cobrança Real**: Add-ons são faturados recorrentemente junto ao plano via gateway Asaas.
- **Preço dos Blocos**:
  - **Essential**: R$ 9,90/mês (`990` centavos) ou R$ 106,92/ano (`10692` centavos) por bloco de +10 membros.
  - **Pro**: R$ 6,90/mês (`690` centavos) ou R$ 74,52/ano (`7452` centavos) por bloco de +10 membros.
- **Configuração de Tetos**:

| Plano | Membros Base | Máximo de Blocos Adicionais | Capacidade Máxima com Add-ons |
| :--- | :--- | :--- | :--- |
| **Essential** | 40 | Até 4 blocos (+40) | **80 membros** |
| **Pro** | 100 | Até 10 blocos (+100) | **200 membros** |

---

## 3. Diretrizes de Arquitetura e Implementação

1. **Centralização de Limites**: As definições de planos, limites base e tetos de blocos estão centralizadas em `plans.config.ts`.
2. **Cálculo de Capacidade de Membros**:
   $$\text{Capacidade Total} = \text{Membros Base} + (\text{Quantidade de Blocos Contratados} \times 10)$$
   respeitando:
   $$0 \le \text{Quantidade de Blocos} \le \text{Máximo de Blocos Permitidos pelo Plano}$$
3. **Validação de Inclusão no Backend**: O middleware `requireQuota('members')` e `requireQuota('songs')` garante o cumprimento das quotas no momento da criação.
4. **Preservação de Dados**: Downgrades e cancelamentos nunca removem integrantes ou músicas, aplicando `accessMode = 'grace'` (7 dias) e em seguida `restricted_over_limit`.
