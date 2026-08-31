# Decisão Oficial de Precificação Comercial e Análise Competitiva de Mercado — LouvAIO

**Data do Snapshot**: 2026-08-29  
**Versão**: 3.0.0 (Commercial Pricing Decision v1 — Fechamento Oficial)  
**Status**: Estratégia Comercial Concluída e Aprovada pelo Proprietário do Produto (Sem alterações funcionais)  
**Documentos Técnicos de Referência**:  
- `docs/operations/cost-model.md` (v3.0.0 — Modelo de Consumo e Guardrails Técnicos)  
- `docs/operations/infrastructure-pricing-snapshot.md` (v3.0.0 — Catálogo de Tarifas Oficiais)  
- `docs/analysis/simulate-commercial-pricing.mjs` (v3.0.0 — Script Determinístico de Simulação Comercial)  
- `docs/analysis/calculate-pricing.mjs` (v3.0.0 — Script de Custos de Infraestrutura)  

---

## 1. Resumo Executivo e Posicionamento Comercial

A precificação comercial do **LouvAIO** (*anteriormente Praise App*) foi oficializada após a conclusão da auditoria técnica de infraestrutura e o alinhamento com o principal benchmark direto no mercado brasileiro (**LouveApp**).

### 1.1 Posicionamento Estratégico: `Competitive Parity + Product Differentiation`
O LouvAIO não adota uma estratégia de *premium pricing* descolada da realidade local nem uma guerra predatória de preços. A estratégia oficial é de **Paridade Competitiva com Diferenciação de Produto**:
- **Preços em paridade direta** com o benchmark nacional de referência (com variação de centavos para redução de atrito de comparação: ex: R$ 14,90 vs R$ 14,99; R$ 34,90 vs R$ 34,99; R$ 89,90 vs R$ 89,99; R$ 214,90 vs R$ 214,99);
- **Competitividade baseada em produto e experiência**: O LouvAIO se diferencia pela arquitetura moderna (PWA instalável, multi-ministry, confirmação de escalas, chat interno e **Smart Chords com transposição inteligente em tempo real** no browser);
- **Modelo `Capacity-led Pricing v1`**: No lançamento, todos os recursos principais da plataforma estão disponíveis em todos os planos, sem *feature gating* artificial (sem travar Smart Chords, chat, templates ou equipes em planos superiores). A diferenciação é estritamente volumétrica (capacidade de integrantes e músicas).

---

## 2. Guardrails Técnicos e Esclarecimento de Armazenamento

`[Derived from cost-model.md]`

### 2.1 Pisos Inegociáveis de Infraestrutura (Custo Marginal Médio)
- **Free (10M / 50S)**: $\mathbf{R\$\ 0,20 / mês}$ (Custo alocado no cenário 100 min: $\text{R\$ } 1,21$).
- **Lite (20M / 100S)**: $\mathbf{R\$\ 0,62 / mês}$ (Custo alocado no cenário 100 min: $\text{R\$ } 1,55$).
- **Lite+ (30M / 150S)**: $\mathbf{R\$\ 1,27 / mês}$ (Custo alocado no cenário 100 min: $\text{R\$ } 2,09$).
- **Essential (40M / 200S)**: $\mathbf{R\$\ 2,21 / mês}$ (Custo alocado no cenário 100 min: $\text{R\$ } 2,86$).
- **Pro (100M / 500S)**: $\mathbf{R\$\ 12,43 / mês}$ (Custo alocado no cenário 100 min: $\text{R\$ } 11,32$).
- **Premium (300M / 1.500S)**: $\approx \mathbf{R\$\ 50,15 / mês}$ (estimado no patamar de 200M/1kS).
- **Add-on Essential (+10)**: $\mathbf{R\$\ 0,55 / mês}$.
- **Add-on Pro (+10)**: $\mathbf{R\$\ 1,25 / mês}$.

### 2.2 Esclarecimento Arquitetural: Full Repertoire Scan vs. Heavy Storage
É fundamental registrar a natureza técnica do consumo do LouvAIO:
- **O LouvAIO armazena dados estruturados, texto, metadados e links**: Títulos, letras, cifras cifradas em notação de texto e links externos (YouTube, Spotify, Cifra Club, Google Drive). O LouvAIO **NÃO é uma plataforma de armazenamento pesado de mídia (PDFs, vídeos, áudios multitrack)**.
- **Smart Chords**: Utiliza texto estruturado com renderização client-side pura, transpondo acordes matematicamente no dispositivo do músico sem transferir arquivos pesados.
- **O que significa `Full Repertoire Scan`**: Refere-se exclusivamente a consultas de banco (`GET /songs`) onde o backend lê múltiplos documentos JSON/NoSQL do Firestore para filtrar/paginar em memória. Trata-se de um gargalo de **leituras e rede do banco**, e não de custos de *file storage*.

---

## 3. Tabela Oficial: Commercial Pricing Decision v1

`[Commercial Pricing Decision v1]`

Abaixo está a estrutura oficial de planos e preços aprovada para o LouvAIO:

| Plano | Membros do Louvor | Músicas | Mensalidade | Regra Anual (10% OFF) | Anual Calculado | Mensal Equivalente | Add-ons de Membros |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Free** | **10** | **50** | **R$ 0,00** | — | **R$ 0,00** | R$ 0,00 | Não permite |
| **Lite** | **20** | **100** | **R$ 14,90** | -10% anual | **R$ 160,92 / ano** | R$ 13,41 / mês | Não permite |
| **Lite+** | **30** | **150** | **R$ 24,90** | -10% anual | **R$ 268,92 / ano** | R$ 22,41 / mês | Não permite |
| **Essential** | **40** | **200** | **R$ 34,90** | -10% anual | **R$ 376,92 / ano** | R$ 31,41 / mês | **+10 por R$ 9,90 / mês** (Máx 4 blocos) |
| **Pro** | **100** | **500** | **R$ 89,90** | -10% anual | **R$ 970,92 / ano** | R$ 80,91 / mês | **+10 por R$ 6,90 / mês** (Máx 10 blocos) |
| **Premium** | **300** | **1.500** | **R$ 214,90** | -10% anual | **R$ 2.320,92 / ano** | R$ 193,41 / mês | Não permite |
| **Enterprise / Redes** | **Custom** | **Custom** | **Sob Consulta** | Negociação | **Sob Consulta** | Sob Consulta | Customizado |

---

## 4. Detalhamento Estratégico por Plano

### 4.1 Plano Free (10 membros / 50 músicas — R$ 0,00)
- **Papel**: Motor de aquisição (*Product-Led Growth*), experimentação e retenção definitiva de pequenas bandas, pontos de pregação e equipes iniciantes.
- **Sustentabilidade**: Custo marginal de **R$ 0,20 / mês**. 60 igrejas Free consomem apenas R$ 12,18/mês de recursos diretos, sendo subsidiadas confortavelmente pela base pagante.

### 4.2 Plano Lite (20 membros / 100 músicas — R$ 14,90 / mês)
- **Papel**: Porta de entrada para igrejas locais com 1 equipe de louvor consolidada.
- **Paridade**: Posicionado em paridade exata com o plano de 20 membros do LouveApp (R$ 14,99).

### 4.3 Plano Lite+ (30 membros / 150 músicas — R$ 24,90 / mês)
- **Decisão de Lançamento**: Mantido no catálogo para atender igrejas com 2 equipes de louvor ou louvor + técnica.
- **Classificação**: `Future Simplification Candidate`. O plano será monitorado pós-lançamento. Caso as métricas indiquem baixa conversão ou migração direta de Lite para Essential, poderá ser consolidado em versões futuras sem prejuízo a clientes legados.

### 4.4 Plano Essential (40 membros / 200 músicas — R$ 34,90 / mês) — Plano-Âncora
- **Papel**: Principal recomendação comercial (*Hero Plan*) para igrejas médias padrão.
- **Flexibilidade**: Permite até 4 blocos de add-ons de +10 membros (atingindo até 80 voluntários).
- **Margem Técnica**: Custo marginal de R$ 2,21 $\implies$ infraestrutura representa apenas **6,33% da mensalidade**.

### 4.5 Plano Pro (100 membros / 500 músicas — R$ 89,90 / mês)
- **Papel**: Atendimento a congregações de grande porte com múltiplos cultos e bandas.
- **Flexibilidade**: Permite até 10 blocos de add-ons de +10 membros (atingindo até 200 voluntários).
- **Margem Técnica**: Custo marginal de R$ 12,43 $\implies$ infraestrutura representa **13,83% da mensalidade**.

### 4.6 Plano Premium (300 membros / 1.500 músicas — R$ 214,90 / mês)
- **IMPORTANTE — Desmistificação do Ilimitado**: O plano Premium **NÃO É ILIMITADO**. O limite de 300 membros e 1.500 músicas elimina integralmente os riscos de cauda alta (*high-use tenant risk*) modelados na fase anterior.
- **Revisão Futura**: `Premium capacity may be revisited after pre-launch query optimization and production telemetry`. Após a otimização de consultas (`GET /songs`), a capacidade poderá ser ampliada futuramente sem elevação de preço.

### 4.7 Enterprise / Redes (Acima de 300 membros / 1.500 músicas — Sob Consulta)
- **Papel**: Atendimento comercial customizado para megaigrejas e redes denominacionais. Não cria plano ou automação no backend nesta fase.

---

## 5. Estrutura e Economia de Add-ons (+10 Membros)

`[Commercial Pricing Decision v1]`

A precificação de blocos de capacidade segue o princípio de **Economia Intencional de Upgrade (`Intentional Upgrade Economics`)**:

```
┌────────────────────────────────────────┬────────────────────────────────────────┐
│ Add-on no Essential (Máx 4 blocos)     │ Add-on no Pro (Máx 10 blocos)          │
├────────────────────────────────────────┼────────────────────────────────────────┤
│ Preço: R$ 9,90 / mês por +10 membros   │ Preço: R$ 6,90 / mês por +10 membros   │
│ - Essential Base (40): R$ 34,90        │ - Pro Base (100): R$ 89,90             │
│ - Essential + 1 bloco (50): R$ 44,80   │ - Pro + 1 bloco (110): R$ 96,80        │
│ - Essential + 2 blocos (60): R$ 54,70  │ - Pro + 2 blocos (120): R$ 103,70      │
│ - Essential + 3 blocos (70): R$ 64,60  │ - Pro + 3 blocos (130): R$ 110,60      │
│ - Essential + 4 blocos (80): R$ 74,50  │ - Pro + 4 blocos (140): R$ 117,50      │
│ ↳ Salto para Pro 100: R$ 89,90 (+R$15) │ - Pro + 5 blocos (150): R$ 124,40      │
│                                        │ - Pro + 10 blocos (200): R$ 158,90     │
│                                        │ ↳ Salto para Premium 300: R$ 214,90    │
└────────────────────────────────────────┴────────────────────────────────────────┘
```

- **Racional**: O add-on possui valores diferentes intencionalmente. No Essential (R$ 9,90), uma igreja com 80 voluntários paga R$ 74,50; ao necessitar de 90 a 100 voluntários, o salto para o Pro (R$ 89,90 por 100 membros + 500 músicas) é suave e economicamente atrativo.
- **Planos sem Add-on**: Free, Lite, Lite+ e Premium não aceitam add-ons.

---

## 6. Regra do Plano Anual e Decisão de Trial

`[Commercial Pricing Decision v1]`

### 6.1 Desconto Anual Oficial: 10% OFF
- **Fórmula Matemática**: $\text{Preço Anual} = \text{Preço Mensal} \times 12 \times 0,90$.
- **Tabela Anual**:
  - *Lite*: $\text{R\$ } 14,90 \times 12 \times 0,90 = \mathbf{R\$\ 160,92 / \text{ano}}$ (R$ 13,41/mês eq.).
  - *Lite+*: $\text{R\$ } 24,90 \times 12 \times 0,90 = \mathbf{R\$\ 268,92 / \text{ano}}$ (R$ 22,41/mês eq.).
  - *Essential*: $\text{R\$ } 34,90 \times 12 \times 0,90 = \mathbf{R\$\ 376,92 / \text{ano}}$ (R$ 31,41/mês eq.).
  - *Pro*: $\text{R\$ } 89,90 \times 12 \times 0,90 = \mathbf{R\$\ 970,92 / \text{ano}}$ (R$ 80,91/mês eq.).
  - *Premium*: $\text{R\$ } 214,90 \times 12 \times 0,90 = \mathbf{R\$\ 2.320,92 / \text{ano}}$ (R$ 193,41/mês eq.).
  - *Add-on Essential (+10)*: $\text{R\$ } 9,90 \times 12 \times 0,90 = \mathbf{R\$\ 106,92 / \text{ano}}$.
  - *Add-on Pro (+10)*: $\text{R\$ } 6,90 \times 12 \times 0,90 = \mathbf{R\$\ 74,52 / \text{ano}}$.

### 6.2 Decisão de Trial no Lançamento: Sem Trial de Plano Pago
- **Estratégia**: **Free permanente sem necessidade de cartão de crédito**.
- **Classificação**: `Paid Plan Trial = Post-launch Experiment Candidate`.
- **Racional**: O plano Free já cumpre o papel de experimentação. Evita-se no lançamento a complexidade de expiração de trial, estados extras de billing, regras de grace period e risco de fricção de perda de acesso após 14 dias.

---

## 7. Benchmark Competitivo Primário: LouveApp vs. LouvAIO

`[Competitive Benchmark — Owner Supplied]`

Abaixo está o comparativo direto de preços entre o LouveApp e o LouvAIO:

| Capacidade de Voluntários | LouveApp Benchmark | LouvAIO Decision v1 | Configuração LouvAIO | Diferença LouvAIO vs LouveApp |
|:---:|:---:|:---:|:---:|:---:|
| **20 membros** | R$ 14,99 / mês | **R$ 14,90 / mês** | Lite (20 membros) | **-R$ 0,09** (Praticamente igual) |
| **30 membros** | R$ 24,99 / mês | **R$ 24,90 / mês** | Lite+ (30 membros) | **-R$ 0,09** (Praticamente igual) |
| **40 membros** | R$ 34,99 / mês | **R$ 34,90 / mês** | Essential (40 membros) | **-R$ 0,09** (Praticamente igual) |
| **50 membros** | R$ 44,99 / mês | **R$ 44,80 / mês** | Essential + 1 bloco | **-R$ 0,19** (Praticamente igual) |
| **60 membros** | R$ 54,99 / mês | **R$ 54,70 / mês** | Essential + 2 blocos | **-R$ 0,29** (Praticamente igual) |
| **70 membros** | R$ 74,99 / mês | **R$ 64,60 / mês** | Essential + 3 blocos | **-R$ 10,39 (LouvAIO mais vantajoso)** |
| **80 membros** | *Sem tier direto* | **R$ 74,50 / mês** | Essential + 4 blocos | *Exclusivo LouvAIO* |
| **100 membros** | R$ 89,99 / mês | **R$ 89,90 / mês** | Pro (100 membros) | **-R$ 0,09** (Praticamente igual) |
| **150 membros** | R$ 124,99 / mês | **R$ 124,40 / mês** | Pro + 5 blocos | **-R$ 0,59** (Praticamente igual) |
| **200 membros** | R$ 154,99 / mês | **R$ 158,90 / mês** | Pro + 10 blocos | **+R$ 3,91 (LouveApp ligeiramente menor)** |
| **300 membros** | R$ 214,99 / mês | **R$ 214,90 / mês** | Premium (300 membros) | **-R$ 0,09** (Praticamente igual) |
| **500 membros** | R$ 329,99 / mês | Sob Consulta | Enterprise | Sob negociação |
| **750 membros** | R$ 449,99 / mês | Sob Consulta | Enterprise | Sob negociação |
| **1.000 membros** | R$ 549,99 / mês | Sob Consulta | Enterprise | Sob negociação |

---

## 8. Simulação de Receita e Margens (MRR)

`[Derived from simulate-commercial-pricing.mjs]` (Sincronizado deterministicamente com o custo de infraestrutura de `calculate-pricing.mjs`):

### 8.1 Cenário-Base de Distribuição `[Assumption — Commercial Mix]`
Considerando a hipótese de distribuição de base: 60% Free, 10% Lite, 8% Lite+, 12% Essential, 7% Pro, 3% Premium:

| Escala de Ministérios | MRR Bruto | Custo Real de Infraestrutura | Peso da Infra / MRR | Contribuição após Infraestrutura | ARPA Pagante Médio |
|---|:---:|:---:|:---:|:---:|:---:|
| **100 Ministérios** (40 Pagantes / 60 Free) | **R$ 2.041,00 / mês** | **R$ 345,68 / mês** | **16,94%** | **R$ 1.695,32 / mês** | **R$ 51,03 / mês** |
| **1.000 Ministérios** (400 Pagantes / 600 Free) | **R$ 20.410,00 / mês** | **R$ 2.565,54 / mês** | **12,57%** | **R$ 17.844,46 / mês** | **R$ 51,02 / mês** |
| **10.000 Ministérios** (4.000 Pagantes / 6.000 Free)| **R$ 204.100,00 / mês** | **R$ 24.261,88 / mês** | **11,89%** | **R$ 179.838,12 / mês** | **R$ 51,02 / mês** |

*(Nota: O termo **Contribuição após Infraestrutura** reflete o faturamento bruto deduzido dos servidores/banco, não devendo ser confundido com lucro líquido ou margem empresarial).*

### 8.2 Break-even Técnico de Infraestrutura
- **Custo total de infraestrutura em 100 ministérios**: R$ 345,68 / mês.
- **Tíquete médio pagante (ARPA)**: R$ 51,02 / mês.
- **Break-even**: $\lceil \text{R\$ 345,68} / \text{R\$ 51,02} \rceil = \mathbf{7 \text{ clientes pagantes}}$.
- *(Apenas 7 congregações pagantes cobrem 100% da infraestrutura de 100 ministérios ativos).*

---

## 9. Custos Empresariais Ausentes (Não-Infraestrutura)

Para planejamento financeiro, os seguintes custos não-técnicos deverão ser deduzidos da receita bruta:
1. **Taxas de Gateway de Pagamento**: Pix (0,99% a 1,99%), Cartão de Crédito (2,99% a 4,99% + taxa fixa por transação), Boletos bancários.
2. **Tributação**: Simples Nacional ou regime aplicável conforme constituição da empresa.
3. **Contabilidade e Jurídico**: Mensalidade contábil e consultoria para LGPD/Termos de Uso.
4. **Ferramentas Operacionais**: Domínios, e-mails transacionais (Resend/SendGrid) e observabilidade.
5. **Marketing e Suporte**: Tráfego pago e custos de suporte humano.

---

## 10. Temas de Roadmap Futuro

`[Future Roadmap & Investigations]`

### 10.1 Multi-ministry Organization Subscription
- **Situação Atual**: Cada `Ministry` possui sua própria `Subscription` isolada.
- **Investigação Futura**: Modelar a entidade `Organization` / `Church` que administra múltiplos ministérios sob um pacote compartilhado de capacidade.

### 10.2 Integração com WhatsApp (`High-Priority Item`)
- **Situação Atual**: Notificações in-app e chat interno por escala.
- **Roadmap**: Como o LouveApp possui notificações via WhatsApp, a integração com a API do WhatsApp é prioritária para o roadmap de engajamento pós-lançamento.

---

## 11. Decision Log Definitivo

```
┌───────────────────────────────────────────────┬────────────────────────────────────────────────────────┐
│ Item Estratégico                              │ Status e Decisão Oficial                               │
├───────────────────────────────────────────────┼────────────────────────────────────────────────────────┤
│ Preço do Plano Free                           │ DECIDIDO: R$ 0,00 (10 membros / 50 músicas)            │
│ Preço do Plano Lite                           │ DECIDIDO: R$ 14,90 / mês (20 membros / 100 músicas)    │
│ Preço do Plano Lite+                          │ DECIDIDO: R$ 24,90 / mês (30 membros / 150 músicas)    │
│ Manutenção do Lite+                           │ DECIDIDO: Mantido (Future Simplification Candidate)    │
│ Preço do Plano Essential                      │ DECIDIDO: R$ 34,90 / mês (40 membros / 200 músicas)    │
│ Preço do Plano Pro                            │ DECIDIDO: R$ 89,90 / mês (100 membros / 500 músicas)   │
│ Preço e Limites do Premium                    │ DECIDIDO: R$ 214,90 / mês (300 membros / 1.500 músicas)│
│ Premissa de Ilimitado no Premium              │ DECIDIDO: NÃO É ILIMITADO (Teto em 300M / 1.500S)      │
│ Estratégia Enterprise                         │ DECIDIDO: Sob Consulta / Contact Sales (>300M)         │
│ Add-on Essential                              │ DECIDIDO: +10 membros por R$ 9,90 / mês (Máx 4 blocos) │
│ Add-on Pro                                    │ DECIDIDO: +10 membros por R$ 6,90 / mês (Máx 10 blocos)│
│ Regra de Desconto Anual                       │ DECIDIDO: 10% de desconto oficial                      │
│ Trial de Planos Pagos no Lançamento           │ DECIDIDO: SEM TRIAL (Free permanente sem cartão)       │
│ Modelo de Diferenciação                       │ DECIDIDO: Capacity-led Pricing v1 (Sem feature gating) │
│ ───────────────────────────────────────────── │ ────────────────────────────────────────────────────── │
│ Feature Gating Comercial Avançado             │ FUTURE: Avaliar após tração inicial                    │
│ Trial Experiment Pós-lançamento               │ FUTURE: Testar com base em Free → Paid conversion      │
│ Ampliação de Quota do Premium                 │ FUTURE: Reavaliar após otimizações de query            │
│ Assinatura Compartilhada Multi-ministry       │ FUTURE: Investigação arquitetural de Organization      │
│ Integração com WhatsApp                       │ FUTURE: Item prioritário de roadmap pós-lançamento     │
│ Campanhas Promocionais e Cupons               │ FUTURE: Definir na fase de Go-to-Market                │
└───────────────────────────────────────────────┴────────────────────────────────────────────────────────┘
```

---

## 12. Métricas Pós-Lançamento a Monitorar

1. `conversion.free_to_paid_rate`: Taxa geral de conversão da base Free.
2. `subscription.plan_mix`: Proporção real de adesão por plano (Lite vs Lite+ vs Essential vs Pro vs Premium).
3. `expansion.addon_attach_rate`: Frequência de compra de blocos de add-ons no Essential e Pro.
4. `upgrade.path_velocity`: Velocidade de migração entre planos ($Lite \rightarrow Lite+ \rightarrow Essential \rightarrow Pro$).
5. `business.mrr_and_arpa`: Evolução do faturamento mensal e tíquete médio por assinante.
6. `technical.reads_per_session`: Leituras reais de banco por sessão em produção.
7. `technical.egress_per_plan`: Volume de transferência por plano.

---

## 13. Backlog da Próxima Frente Técnica: `Pre-Launch Cost & Scalability Optimization`

A próxima fase técnica do projeto será dedicada à **Otimização Pré-Lançamento de Custos e Escalabilidade**, focando nos gargalos comprovados no código:

1. **`GET /songs`**:
   - Implementar paginação server-side com `startAfter`/`limit`.
   - Adicionar filtros e busca indexada para eliminar o carregamento integral de coleções grandes em memória.
2. **Bootstrap Autenticado**:
   - Otimizar o carregamento de ministério e dados do usuário no login, eliminando chamadas repetidas ou redundantes.
3. **Contagem de Recursos (`/counts`)**:
   - Eliminar varreduras completas de coleções para simples contagem, aproveitando contadores materializados em `ministry_usage`.
4. **Enriquecimento de Integrantes (`GET /members`)**:
   - Eliminar o padrão $N+1$ de consultas na coleção `users` desnormalizando campos básicos em `ministry_members`.
5. **Pastas de Repertório (`folders`)**:
   - Otimizar a associação de músicas em pastas eliminando queries $N+1$.
6. **Chat de Escalas (`schedule_comments`)**:
   - Adicionar paginação e limite padrão de mensagens recentes.
7. **Recálculo do Cost Model**:
   - Rodar novamente o modelo de custos após as otimizações para verificar a redução real de reads e egress.
