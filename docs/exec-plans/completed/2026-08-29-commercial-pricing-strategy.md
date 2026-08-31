# ExecPlan Concluído: Pesquisa de Mercado e Estratégia de Precificação Comercial (Decision v1)

**Status**: Completed  
**Author**: Antigravity  
**Created**: 2026-08-29  
**Completed**: 2026-08-29  
**Deliverables**:  
- `docs/business/commercial-pricing-strategy.md` (v3.0.0 — Commercial Pricing Decision v1)  
- `docs/analysis/simulate-commercial-pricing.mjs` (v3.0.0 — Script Determinístico de Simulação Comercial)  
- `docs/operations/cost-model.md` (v3.0.0 — Guardrails Técnicos de Infraestrutura)  

---

## 1. Resumo Executivo da Entrega

A estratégia comercial de precificação do **LouvAIO** foi formalmente concluída e alinhada com as decisões aprovadas pelo proprietário do produto, tomando como benchmark primário o **LouveApp** sob o posicionamento de **`Competitive Parity + Product Differentiation`** e o modelo **`Capacity-led Pricing v1`**.

### 1.1 Tabela Oficial de Decisão (`Commercial Pricing Decision v1`)

| Plano | Membros | Músicas | Mensalidade | Anual Oficial (-10%) | Add-ons de Membros |
|---|:---:|:---:|:---:|:---:|:---:|
| **Free** | 10 | 50 | **R$ 0,00** | R$ 0,00 | — |
| **Lite** | 20 | 100 | **R$ 14,90** | **R$ 160,92 / ano** (R$ 13,41/mês eq.) | — |
| **Lite+** | 30 | 150 | **R$ 24,90** | **R$ 268,92 / ano** (R$ 22,41/mês eq.) | — *(Future Simplification Candidate)* |
| **Essential** | 40 | 200 | **R$ 34,90** | **R$ 376,92 / ano** (R$ 31,41/mês eq.) | **+10 por R$ 9,90 / mês** (Máx 4 blocos = 80 membros) |
| **Pro** | 100 | 500 | **R$ 89,90** | **R$ 970,92 / ano** (R$ 80,91/mês eq.) | **+10 por R$ 6,90 / mês** (Máx 10 blocos = 200 membros) |
| **Premium** | 300 | 1.500 | **R$ 214,90** | **R$ 2.320,92 / ano** (R$ 193,41/mês eq.) | — *(NÃO É ILIMITADO — Limite transparente)* |
| **Enterprise**| Custom | Custom | **Sob Consulta**| Negociação | Customizado |

---

## 2. Decisões Comerciais e Metodológicas Registradas

1. **Paridade com Diferenciação de Produto**:
   - Preços calibrados em paridade com o LouveApp (R$ 14,90 vs R$ 14,99; R$ 34,90 vs R$ 34,99; R$ 89,90 vs R$ 89,99; R$ 214,90 vs R$ 214,99).
   - Diferenciação apoiada em UX, PWA, confirmação de escalas, chat e Smart Chords nativo em tempo real no browser.
2. **Capacity-led Pricing v1**:
   - Sem feature gating artificial no lançamento; diferenciação puramente volumétrica.
3. **Economia Intencional de Upgrade nos Add-ons**:
   - Essential (+10 por R$ 9,90) conduz ao Pro (R$ 89,90 por 100 membros).
   - Pro (+10 por R$ 6,90) conduz ao Premium (R$ 214,90 por 300 membros).
4. **Desconto Anual de 10%**:
   - Fórmula: $\text{Mensal} \times 12 \times 0,90$.
5. **Trial**:
   - Free permanente sem cartão de crédito no lançamento; trial de planos pagos mantido como experimento pós-lançamento.
6. **Esclarecimento Arquitetural**:
   - LouvAIO armazena dados estruturados e texto; não é storage pesado de mídia. "Full scan" é leitura de coleção no Firestore a ser otimizada.
7. **Simulação de Receita e Break-Even**:
   - MRR (100 min / 40 pagantes): **R$ 2.041,00 / mês** | Custo Infra: **R$ 345,68 / mês** | Infra/MRR: **16,94%** | Contribuição pós-infra: **R$ 1.695,32 / mês**.
   - MRR (1.000 min / 400 pagantes): **R$ 20.410,00 / mês** | Custo Infra: **R$ 2.565,54 / mês** | Infra/MRR: **12,57%** | Contribuição pós-infra: **R$ 17.844,46 / mês**.
   - MRR (10.000 min / 4.000 pagantes): **R$ 204.100,00 / mês** | Custo Infra: **R$ 24.261,88 / mês** | Infra/MRR: **11,89%** | Contribuição pós-infra: **R$ 179.838,12 / mês**.
   - Break-even técnico: **Apenas 7 clientes pagantes**.

---

## 3. Próxima Fase Técnica Formalmente Registrada

`Pre-Launch Cost & Scalability Optimization`:
- Paginação server-side e filtros indexados em `GET /songs`;
- Otimização do bootstrap autenticado;
- Contadores materializados em `/counts`;
- Eliminação do $N+1$ em `GET /members` e `folders`;
- Paginação no chat de escalas (`schedule_comments`);
- Recálculo determinístico do cost model após as melhorias.

---

## 4. Confirmação de Integridade

- **Nenhum código funcional foi alterado.**
- **Nenhum checkout, gateway de pagamento ou tela de cobrança foi implementada nesta fase.**
- **Nenhuma alteração em runtime ou banco de dados foi realizada.**
- Validações executadas: `node docs/analysis/calculate-pricing.mjs`, `node docs/analysis/simulate-commercial-pricing.mjs` e `git diff --check`.
