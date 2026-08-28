# Estrutura Comercial e Planos LouvAIO

Definição oficial dos planos de assinatura, limites base e add-ons de membros do **LouvAIO**.

---

## 1. Tabela de Planos

| Plano | Identificador Técnico | Membros Base | Músicas | Add-on de Membros |
| :--- | :--- | :--- | :--- | :--- |
| **Free** | `free` | 10 | 50 | Não |
| **Lite** | `lite` | 20 | 100 | Não |
| **Lite+** | `lite_plus` | 30 | 150 | Não |
| **Essential** | `essential` | 40 | 200 | Sim (blocos de +10) |
| **Pro** | `pro` | 100 | 500 | Sim (blocos de +10) |
| **Premium** | `premium` | Ilimitado | Ilimitado | Desnecessário |

> [!NOTE]
> O identificador técnico para **Lite+** é `lite_plus`. O nome de apresentação exibido ao usuário é **Lite+**.

---

## 2. Modelagem de Add-ons de Membros

- **Status da Cobrança**: Os add-ons serão modelados no sistema e esquema de dados desde já, mas **ainda NÃO haverá cobrança real** nesta etapa.
- **Tamanho do Bloco**: Cada bloco adicional acrescenta **+10 membros**.
- **Configuração de Tetos**: A quantidade máxima de blocos adicionais é **configurável por plano** (centralizada em configuração/tabela de limites, não hardcoded nas regras de negócio).

### Configuração Inicial Provisória de Tetos:

| Plano | Membros Base | Máximo de Blocos Adicionais | Capacidade Máxima com Add-ons |
| :--- | :--- | :--- | :--- |
| **Essential** | 40 | Até 4 blocos (+40) | **80 membros** |
| **Pro** | 100 | Até 10 blocos (+100) | **200 membros** |

---

## 3. Diretrizes de Arquitetura e Implementação

1. **Centralização de Limites**: As definições de planos, limites base e tetos de blocos devem ficar centralizadas em um módulo de configuração único (ex.: `plans.config.ts`), permitindo ajustes futuros sem alteração estrutural no código.
2. **Cálculo de Capacidade de Membros**:
   $$\text{Capacidade Total} = \text{Membros Base} + (\text{Quantidade de Blocos Contratados} \times 10)$$
   respeitando:
   $$0 \le \text{Quantidade de Blocos} \le \text{Máximo de Blocos Permitidos pelo Plano}$$
3. **Validação de Inclusão**: Inclusões manuais de integrantes ou entradas por código de convite (`PR-*`) devem consultar a capacidade total calculada do ministério.
