# Decisão Arquitetural: Política V1 de Transições de Assinatura, Pró-rata e Preservação de Período Pago

- **Data de Criação**: 2026-09-01
- **Data de Revisão**: 2026-09-01 (Revisão: *Immediate Upgrade + Proration adicionados à V1 antes da implementação*)
- **Status**: Aceita / Aprovada (APPROVED DOMAIN POLICY — REVISED V1)
- **Contexto**: Definição da política oficial de domínio para transições de plano, alterações de periodicidade (mensal/anual), acréscimo/redução de add-ons, cancelamentos e renovações no LouvAIO SaaS, estabelecendo a separação estrita entre o estado de direito de uso (*entitlement*) e o estado da assinatura no gateway (*provider subscription*), com suporte a **upgrade imediato via pró-rata** e **agendamento para o fim do período já pago** em downgrades e trocas de periodicidade.

---

## 1. Princípios Fundamentais e Separação de Autoridade

### 1.1 Princípio do Período Pago (*Period-Paid Principle*)
> Todo período de assinatura contratado e pago pertence soberanamente ao cliente até o seu `current_period_end`.
> 
> - Não há reembolso automático (*no automatic refund*) decorrente de cancelamento, downgrade, alteração de ciclo ou desistência posterior. O reembolso permanece um fluxo operacional excepcional.
> - O cliente não pode ter seu acesso rebaixado nem perder entitlements contratados antes do término do período já quitado.
> - O cliente nunca deve pagar duas vezes pelo mesmo período de serviço.

### 1.2 Princípio de Upgrade Imediato Proporcional (*Immediate Prorated Upgrade*)
> Quando uma solicitação representa um aumento real de capacidade ou limites (*entitlement upgrade*), o novo plano/add-on entra em vigor **imediatamente após a liquidação financeira do ajuste proporcional (*upgrade adjustment*) referente aos dias restantes do ciclo em andamento**.
> 
> - O cliente **não** paga o novo período integral antecipadamente.
> - O `current_period_end` original **permanece inalterado**.
> - A cobrança integral recorrente do novo plano/ciclo inicia-se somente em `current_period_end`.

### 1.3 Separação de Estados: Provider Subscription vs. LouvAIO Entitlement
> **`ASAAS SUBSCRIPTION STATUS != LOUVAIO ENTITLEMENT STATUS`**
>
> - **LouvAIO Entitlement Status**: Autoridade do LouvAIO sobre limites, quotas e recursos liberados (mantido `ACTIVE` no plano correspondente ao período pago ou ajustado).
> - **Old Provider Subscription**: Objeto de assinatura vigente no gateway. Em agendamentos ou substituições, torna-se `INACTIVE` para impedir renovação concorrente na data de virada.
> - **Upgrade Adjustment Charge**: Cobrança avulsa proporcional liquidada imediatamente para habilitar o upgrade.
> - **Scheduled / Future Provider Subscription**: Objeto de assinatura futura configurado no gateway com `nextDueDate = current_period_end` para a renovação integral futura.
> - **Payment State**: Liquidação financeira confirmada (`PAYMENT_CONFIRMED`) que autoriza a promoção definitiva do entitlement.

---

## 2. Classificação das Transições (Autoridade de Domínio)

A classificação de uma transição como **Upgrade**, **Downgrade** ou **Mudança de Intervalo** é determinada pela comparação das **capacidades/quotas efetivas (*effective entitlements*)** entre o estado de origem e o estado de destino, e **NÃO exclusivamente pelo preço** nem pela contagem isolada de blocos de add-ons:

| Rank | Plano | Membros Base | Músicas Base | Suporta Addons |
| :---: | :--- | :---: | :---: | :---: |
| **0** | `free` | 10 | 50 | Não |
| **1** | `lite` | 20 | 100 | Não |
| **2** | `lite_plus` | 30 | 150 | Não |
| **3** | `essential` | 40 (até 80) | 200 | Sim (até 4 blocos de 10) |
| **4** | `pro` | 100 (até 200) | 500 | Sim (até 10 blocos de 10) |
| **5** | `premium` | 300 | 1500 | Não |

### 2.1 Distinção: Entitlements Efetivos vs. Configuração Contratual
- **Entitlements Efetivos (*Effective Capabilities*)**: Quotas reais de uso (ex: `effectiveMembers`, `effectiveSongs`).
  - No catálogo atual, os planos são estritamente monotônicos nas quotas relevantes.
  - *Exemplo*: `essential + 3 addons` (70 membros, 200 músicas) $\to$ `pro + 0 addons` (100 membros, 500 músicas) é um **UPGRADE integral de entitlement**, pois ambas as quotas aumentam, mesmo que o número de `addonBlocks` contratual caia de 3 para 0.
- **Configuração Contratual (*Contract Configuration*)**: Tupla (`planId`, `addonBlocks`, `billingInterval`) usada para precificação e faturamento.
- **Regra de Classificação**:
  - **Upgrade**: Qualquer aumento em quotas efetivas ($\text{members}_{\text{target}} \ge \text{members}_{\text{current}} \land \text{songs}_{\text{target}} \ge \text{songs}_{\text{current}}$, com pelo menos um $>$) com $\Delta P > 0$.
  - **Downgrade**: Qualquer redução em quotas efetivas.
  - **Same-Plan Interval Change**: Quotas efetivas idênticas com alteração apenas em `billingInterval`.

---

## 3. Matriz Oficial de Transições V1

| Tipo de Transição | Vigência do Entitlement | Cobrança Imediata | Cobrança Futura em `current_period_end` |
| :--- | :--- | :--- | :--- |
| **`Free -> Paid`** | Imediata | Preço integral do primeiro ciclo | Renovação integral periódica |
| **`Upgrade de Plano (Mesmo Ciclo)`** | **Imediata** (após `PAYMENT_CONFIRMED`) | **Ajuste Pró-rata** ($\Delta P \times \text{Fração Restante}$) | Preço integral do novo plano |
| **`Downgrade de Plano`** | Em `current_period_end` | **Nenhuma** | Preço integral do plano menor |
| **`Monthly -> Annual (Mesmo Plano)`** | Em `current_period_end` | **Nenhuma** | Preço anual integral com desconto |
| **`Annual -> Monthly (Mesmo Plano)`** | Em `current_period_end` | **Nenhuma** | Preço mensal integral |
| **`Aumento de Addon (Addon Increase)`** | **Imediata** (após `PAYMENT_CONFIRMED`) | **Ajuste Pró-rata** ($\Delta P_{\text{addon}} \times \text{Fração Restante}$) | Preço recorrente com novos blocos |
| **`Redução de Addon (Addon Decrease)`** | Em `current_period_end` | **Nenhuma** | Preço recorrente com blocos reduzidos |
| **`Cancelamento (cancel_at_period_end)`**| Em `current_period_end` ($\to \text{Free}$) | **Nenhuma** | Nenhuma (assinatura não renova) |

---

## 4. Algoritmo Determinístico de Pró-rata V1

### 4.1 Fronteira e Contagem de Dias Comerciais
- O fuso horário de referência é estritamente **`America/Sao_Paulo`** (`BILLING_TIMEZONE`).
- O período de faturamento é considerado no intervalo semiaberto:
  $$[\text{current\_period\_start}, \text{current\_period\_end})$$
- A contagem de dias utiliza datas civis comerciais ($YYYY-MM-DD$), evitando distorções de milissegundos UTC ou horários de verão.

### 4.2 Fórmula de Cálculo com Preço Total Incluindo Add-ons Ativos
Seja:
- $D_{\text{total}} = \text{commercial\_days}(\text{current\_period\_start}, \text{current\_period\_end})$
- $D_{\text{remaining}} = \text{commercial\_days}(\text{upgrade\_date}, \text{current\_period\_end})$
- $F_{\text{remaining}} = \frac{D_{\text{remaining}}}{D_{\text{total}}}$

A base de cálculo da diferença de preço utiliza **estritamente os totais contratuais no CICLO ATUAL**:
$$\text{source\_cycle\_total} = \text{source\_base\_price} + (\text{current\_addon\_blocks} \times \text{source\_addon\_unit\_price})$$
$$\text{target\_cycle\_total} = \text{target\_base\_price} + (\text{target\_addon\_blocks} \times \text{target\_addon\_unit\_price})$$
$$\Delta P_{\text{current\_cycle}} = \text{target\_cycle\_total} - \text{source\_cycle\_total}$$

O valor cobrado imediatamente é:
$$\text{Upgrade Adjustment (cents)} = \text{round}\left( \Delta P_{\text{current\_cycle}} \times \frac{D_{\text{remaining}}}{D_{\text{total}}} \right)$$
*(Apenas deltas positivos $\Delta P_{\text{current\_cycle}} > 0$ geram cobrança de ajuste proporcional).*

### 4.3 Exemplo Mensal → Mensal com Add-ons
- Plano Atual: *Essential Mensal (R$ 34,90)* + 3 Add-ons (3 * R$ 9,90 = R$ 29,70) $\to \text{Total Origem: R\$ 64,60}$ (6460 cents).
- Plano Alvo: *Pro Mensal (R$ 89,90)* + 0 Add-ons $\to \text{Total Destino: R\$ 89,90}$ (8990 cents).
- Delta do Ciclo Mensal: $8990 - 6460 = 2530\text{ cents}$ (R$ 25,30).
- Fração Restante: $15 / 30 = 0,50$ (50% restante).
- **Ajuste Pró-rata Imediato**: $\text{round}(2530 \times 0,50) = 1265\text{ cents} = \text{R\$ } 12,65$.
- **Resultado**: Cobrança imediata de R$ 12,65. Após `PAYMENT_CONFIRMED`, Pro (100 membros, 500 músicas) liberado imediatamente. Em `current_period_end`, renovação Pro por R$ 89,90.

### 4.4 Exemplo Anual → Anual
- Plano Atual: *Essential Anual* (R$ 376,92 / ano)
- Plano Alvo: *Pro Anual* (R$ 970,92 / ano)
- Fração Restante: Ex. $120 / 365 \approx 0,328767$ (baseada em dias comerciais exatos).
- Diferença do Ciclo Anual: $\text{R\$ } 970,92 - \text{R\$ } 376,92 = \text{R\$ } 594,00$ (59400 cents).
- **Ajuste Pró-rata Imediato**: $\text{round}(59400 \times 0,328767) = 19529\text{ centavos} = \text{R\$ } 195,29$.
- **Resultado**: Cobrança de R$ 195,29. Pro liberado imediatamente até a data de renovação anual original.

---

## 5. Transições Híbridas (Plano e Periodicidade Simultâneos)

Nas transições onde **o plano e o ciclo de faturamento mudam simultaneamente**, o LouvAIO decompõe a operação em duas dimensões independentes:

### 5.1 Caso Híbrido 1: Upgrade de Plano + Mudança Mensal → Anual
*Exemplo: Essential Mensal → Pro Anual em 20/09 (ciclo 05/09 a 05/10)*
1. **Dimensão Entitlement (Upgrade Imediato)**:
   - O pró-rata imediato compara os preços na **periodicidade atual (Mensal)**:
     $$\Delta P = \text{Pro Mensal (R\$ 89,90)} - \text{Essential Mensal (R\$ 34,90)} = \text{R\$ } 55,00$$
   - Ajuste proporcional (50% restante): **R$ 27,50**.
   - Após `PAYMENT_CONFIRMED`: Entitlement do **Pro entra imediatamente**.
2. **Dimensão Periodicidade (Ciclo Anual Futuro)**:
   - A assinatura Pro Anual (R$ 970,92) fica **agendada para iniciar em `05/10`**.
   - O valor integral anual **não** é cobrado antecipadamente em 20/09.

### 5.2 Caso Híbrido 2: Upgrade de Plano + Mudança Anual → Mensal
*Exemplo: Essential Anual → Pro Mensal (restando 120 dias de um período de 365 dias)*
1. **Dimensão Entitlement (Upgrade Imediato)**:
   - O pró-rata compara os preços na **periodicidade atual (Anual)**:
     $$\Delta P = \text{Pro Anual (R\$ 970,92)} - \text{Essential Anual (R\$ 376,92)} = \text{R\$ } 594,00$$
   - Fração de dias: $120 / 365 \approx 0,328767$ (cálculo estritamente baseado em dias comerciais civis no fuso `America/Sao_Paulo`).
   - Ajuste proporcional imediato: $\text{R\$ } 195,29$.
   - Após `PAYMENT_CONFIRMED`: Entitlement do **Pro entra imediatamente**.
2. **Dimensão Periodicidade (Ciclo Mensal Futuro)**:
   - A recorrência Pro Mensal (R$ 89,90/mês) inicia-se apenas no término do período anual.

### 5.3 Caso Híbrido 3: Downgrade de Plano + Mudança de Ciclo
*Exemplo: Pro Mensal → Essential Anual*
- Como o entitlement diminui (Pro $\to$ Essential), **não há mudança imediata nem pró-rata**.
- Toda a configuração (Essential Anual) fica **agendada para `current_period_end`**.
- O cliente permanece com Pro até o fim do mês pago.

### 5.4 Política de Transições Mistas de Capacidade (*Future-Proof Rule*)
- Caso surjam planos onde uma capability aumente e outra diminua, a regra de domínio estabelece:
  - Capacidades que aumentam entram em vigor imediatamente após confirmação do ajuste pró-rata.
  - Capacidades que diminuem permanecem ativas até `current_period_end` (preservando o período pago).

---

## 6. Price Lock na Solicitação (`requested_at`)

Para blindar o cliente contra reajustes de catálogo posteriores ao agendamento/solicitação:
- **`price_locked_at`**: Timestamp ISO da solicitação.
- **`current_cycle_source_price_cents`**: Preço do plano atual no ciclo vigente.
- **`current_cycle_target_price_cents`**: Preço do plano alvo no ciclo vigente (base do pró-rata).
- **`prorated_adjustment_cents`**: Valor exato do ajuste proporcional travado.
- **`target_recurring_price_cents`**: Preço integral travado para a renovação futura em `current_period_end`.
- **`currency`**: `'BRL'`.

---

## 7. Regras de Exceção, Carência e Falhas

### 7.1 Gate Temporal e Confirmação de Ajuste
- O novo entitlement de upgrade só é ativado após evento financeiro `PAYMENT_CONFIRMED` com validação de `amount == prorated_adjustment_cents`.
- Checkouts abertos ou cobranças `PENDING` **não** promovem o entitlement.
- Se o pagamento do ajuste falhar ou for cancelado: o entitlement atual permanece inalterado até `current_period_end`, sem perda de acesso e sem cobrança indevida.

### 7.2 Regra Universal de Carência (*Grace Period*)
> Durante o período de carência (7 dias) na virada de ciclo em `current_period_end`, o LouvAIO preserva temporariamente os **entitlements que estavam ativos imediatamente antes de `current_period_end`**.
> 
> *Exemplo*: Se um ministério realizou upgrade de Essential para Pro com ajuste pago em 20/09 e a renovação de Pro falhar em 05/10, o Grace mantém Pro (e não Essential). Se a carência expirar sem pagamento, transita para `restricted_over_limit`.

### 7.4 Jornada de Dois Checkouts: Arquitetura Recurrence-First (Scheduled Renewal + Optional Early Activation)
Caso o fluxo de upgrade imediato sem token PCI sensível exija duas interações:
1. **Checkout 1 (Hosted RECURRENT)**: O usuário autoriza a renovação futura no novo plano (ex: Pro) para `current_period_end`.
   - Constitui uma autorização formal e soberana de **Scheduled Upgrade**.
   - A assinatura antiga passa para `INACTIVE` e suas faturas pendentes futuras são canceladas após o **Target Ready Gate**.
2. **Checkout 2 (Hosted DETACHED - Opcional)**: Oferta de **Antecipação Imediata de Acesso (*Early Activation*)** pelo restante do ciclo corrente:
   - Se pago (`PAYMENT_CONFIRMED`): O entitlement Pro é ativado imediatamente até `current_period_end`.
   - Se ignorado/abandonado: O entitlement atual (Essential) permanece ativo até `current_period_end`, e o plano Pro entra em vigor normalmente na virada do ciclo na renovação já autorizada.
3. **Eliminação do Risco de Reversão Inesperada**: Diferente do modelo adjustment-first (onde a recusa do segundo checkout reverteria o usuário de Pro para Essential após o ciclo), o modelo recurrence-first garante previsibilidade comercial absoluta.
4. **Diferenciação de Carência (*Grace Period*)**:
   - Se o ajuste foi pago: Pro estava ativo antes da virada; em caso de falha na cobrança em `current_period_end`, o Grace mantém Pro.
   - Se o ajuste não foi pago: Essential estava ativo antes da virada; em caso de falha na cobrança em `current_period_end`, o Grace mantém Essential.

---

## 8. Status da Decisão e Próximos Passos de Homologação

- **Política V1 Aprovada**: Esta revisão formaliza o upgrade imediato com pró-rata e agendamento para `current_period_end` em downgrades/intervalos.
- **Phase 0A (Future Hosted Checkout)**: **PASS (Homologada em Sandbox)** para o agendamento de cobranças em data futura (`nextDueDate`).
- **Phase 0B (Immediate Upgrade Proration Spike)**: **Progressiva**. Phase 0B.1 focada exclusivamente no Hosted Checkout DETACHED de ajuste e na investigação da disponibilidade de `creditCardToken` reutilizável.
