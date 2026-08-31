/**
 * LouvAIO — Script de Simulação de Estratégias Comerciais de Precificação (Versão 3.0 — Decision v1)
 * 
 * Execução: node docs/analysis/simulate-commercial-pricing.mjs
 */

import { calculateScaleCost, calculatePlanDetailedCosts, PRICING_SNAPSHOT } from './calculate-pricing.mjs';

// Preços Oficiais Aprovados — Commercial Pricing Decision v1
export const OFFICIAL_PRICING_DECISION_V1 = {
  name: 'LouvAIO Commercial Pricing Decision v1',
  monthly: {
    free: 0.0,
    lite: 14.90,
    lite_plus: 24.90,
    essential: 34.90,
    pro: 89.90,
    premium: 214.90, // 300 membros / 1.500 músicas
    addonEssential10: 9.90,
    addonPro10: 6.90,
  },
  annualDiscountPct: 0.10, // 10% de desconto oficial no pagamento anual
};

// Benchmark Competitivo Primário: LouveApp [Competitive Benchmark — Owner Supplied]
export const LOUVEAPP_BENCHMARK = [
  { capacity: 20, louveAppPrice: 14.99, louvAIOMatch: 'Lite (20)', louvAIOPrice: 14.90, diff: -0.09 },
  { capacity: 30, louveAppPrice: 24.99, louvAIOMatch: 'Lite+ (30)', louvAIOPrice: 24.90, diff: -0.09 },
  { capacity: 40, louveAppPrice: 34.99, louvAIOMatch: 'Essential (40)', louvAIOPrice: 34.90, diff: -0.09 },
  { capacity: 50, louveAppPrice: 44.99, louvAIOMatch: 'Essential + 1 bloco (50)', louvAIOPrice: 44.80, diff: -0.19 },
  { capacity: 60, louveAppPrice: 54.99, louvAIOMatch: 'Essential + 2 blocos (60)', louvAIOPrice: 54.70, diff: -0.29 },
  { capacity: 70, louveAppPrice: 74.99, louvAIOMatch: 'Essential + 3 blocos (70)', louvAIOPrice: 64.60, diff: -10.39 },
  { capacity: 80, louveAppPrice: null, louvAIOMatch: 'Essential + 4 blocos (80)', louvAIOPrice: 74.50, diff: null },
  { capacity: 100, louveAppPrice: 89.99, louvAIOMatch: 'Pro (100)', louvAIOPrice: 89.90, diff: -0.09 },
  { capacity: 150, louveAppPrice: 124.99, louvAIOMatch: 'Pro + 5 blocos (150)', louvAIOPrice: 124.40, diff: -0.59 },
  { capacity: 200, louveAppPrice: 154.99, louvAIOMatch: 'Pro + 10 blocos (200)', louvAIOPrice: 158.90, diff: 3.91 },
  { capacity: 300, louveAppPrice: 214.99, louvAIOMatch: 'Premium (300)', louvAIOPrice: 214.90, diff: -0.09 },
  { capacity: 500, louveAppPrice: 329.99, louvAIOMatch: 'Enterprise (Sob consulta)', louvAIOPrice: null, diff: null },
  { capacity: 750, louveAppPrice: 449.99, louvAIOMatch: 'Enterprise (Sob consulta)', louvAIOPrice: null, diff: null },
  { capacity: 1000, louveAppPrice: 549.99, louvAIOMatch: 'Enterprise (Sob consulta)', louvAIOPrice: null, diff: null },
];

export const DISTRIBUTION_SCENARIOS = {
  baseline: { free: 0.60, lite: 0.10, lite_plus: 0.08, essential: 0.12, pro: 0.07, premium: 0.03 },
  conservative: { free: 0.80, lite: 0.05, lite_plus: 0.04, essential: 0.06, pro: 0.035, premium: 0.015 },
  strong: { free: 0.40, lite: 0.15, lite_plus: 0.12, essential: 0.18, pro: 0.105, premium: 0.045 },
};

/**
 * Simula faturamento bruto (MRR), custo real de infraestrutura e contribuição após infraestrutura para a Decision v1
 */
export function simulateDecisionMRR(scaleMultiplier = 1, distKey = 'baseline') {
  const prices = OFFICIAL_PRICING_DECISION_V1.monthly;
  const dist = DISTRIBUTION_SCENARIOS[distKey];
  const scale = scaleMultiplier * 100;

  // Custo de infraestrutura obtido deterministicamente de calculate-pricing.mjs
  const infra = calculateScaleCost(scaleMultiplier, 'usCentral1', false, 'medium', 'medium');
  const planCosts = calculatePlanDetailedCosts(scaleMultiplier, 'usCentral1', false, 'medium', 'medium');

  let mrr = 0;
  let paidCount = 0;
  const breakdown = {};

  for (const [planKey, weight] of Object.entries(dist)) {
    const price = prices[planKey] || 0;
    const planCount = weight * scale;
    const planMRR = price * planCount;
    mrr += planMRR;
    if (price > 0) paidCount += planCount;

    const directCostBRL = planCosts[planKey]?.marginalResourceBRL || 0;
    const allocatedCostBRL = planCosts[planKey]?.scenarioAllocatedBRL || 0;
    const directRatioPct = price > 0 ? Number(((directCostBRL / price) * 100).toFixed(2)) : 0;
    const allocatedRatioPct = price > 0 ? Number(((allocatedCostBRL / price) * 100).toFixed(2)) : 0;
    const contributionAfterDirectBRL = price > 0 ? Number((price - directCostBRL).toFixed(2)) : 0;
    const contributionAfterAllocatedBRL = price > 0 ? Number((price - allocatedCostBRL).toFixed(2)) : 0;

    breakdown[planKey] = {
      count: planCount,
      price,
      mrr: Number(planMRR.toFixed(2)),
      directCostBRL,
      directRatioPct,
      contributionAfterDirectBRL,
      allocatedCostBRL,
      allocatedRatioPct,
      contributionAfterAllocatedBRL,
    };
  }

  const infraCostBRL = infra.totalCostBRL;
  const allocatedInfraToMRRPct = Number(((infraCostBRL / mrr) * 100).toFixed(2));
  const contributionAfterAllocatedInfraBRL = Number((mrr - infraCostBRL).toFixed(2));
  const paidARPA = paidCount > 0 ? Number((mrr / paidCount).toFixed(2)) : 0;

  return {
    strategy: OFFICIAL_PRICING_DECISION_V1.name,
    scale,
    distribution: distKey,
    paidCount,
    freeCount: scale - paidCount,
    paidARPA,
    mrr: Number(mrr.toFixed(2)),
    infraCostBRL: Number(infraCostBRL.toFixed(2)),
    allocatedInfraToMRRPct,
    contributionAfterAllocatedInfraBRL,
    breakdown,
  };
}

/**
 * Calcula break-even técnico de infraestrutura para Decision v1
 */
export function calculateDecisionBreakEven() {
  const prices = OFFICIAL_PRICING_DECISION_V1.monthly;
  const scale100InfraBRL = calculateScaleCost(1, 'usCentral1', false, 'medium', 'medium').totalCostBRL; // R$ 345.68

  const dist = DISTRIBUTION_SCENARIOS.baseline;
  let paidWeightsSum = 0;
  let weightedPaidPrice = 0;

  for (const [planKey, weight] of Object.entries(dist)) {
    if (planKey !== 'free') {
      const price = prices[planKey === 'premium_1k' ? 'premium' : planKey] || 0;
      weightedPaidPrice += price * weight;
      paidWeightsSum += weight;
    }
  }
  const avgPaidTicket = weightedPaidPrice / paidWeightsSum;
  const breakEvenCustomers = Math.ceil(scale100InfraBRL / avgPaidTicket);

  return {
    scale100InfraBRL: Number(scale100InfraBRL.toFixed(2)),
    avgPaidTicket: Number(avgPaidTicket.toFixed(2)),
    breakEvenCustomers,
  };
}

/**
 * Tabela de preços anuais calculados com 10% de desconto
 */
export function calculateAnnualPrices() {
  const p = OFFICIAL_PRICING_DECISION_V1.monthly;
  const disc = OFFICIAL_PRICING_DECISION_V1.annualDiscountPct;
  const calc = (monthly) => Number((monthly * 12 * (1 - disc)).toFixed(2));

  return {
    free: { monthly: p.free, annual: 0.0, monthlyEquivalent: 0.0 },
    lite: { monthly: p.lite, annual: calc(p.lite), monthlyEquivalent: Number((calc(p.lite) / 12).toFixed(2)) },
    lite_plus: { monthly: p.lite_plus, annual: calc(p.lite_plus), monthlyEquivalent: Number((calc(p.lite_plus) / 12).toFixed(2)) },
    essential: { monthly: p.essential, annual: calc(p.essential), monthlyEquivalent: Number((calc(p.essential) / 12).toFixed(2)) },
    pro: { monthly: p.pro, annual: calc(p.pro), monthlyEquivalent: Number((calc(p.pro) / 12).toFixed(2)) },
    premium: { monthly: p.premium, annual: calc(p.premium), monthlyEquivalent: Number((calc(p.premium) / 12).toFixed(2)) },
    addonEssential10: { monthly: p.addonEssential10, annual: calc(p.addonEssential10), monthlyEquivalent: Number((calc(p.addonEssential10) / 12).toFixed(2)) },
    addonPro10: { monthly: p.addonPro10, annual: calc(p.addonPro10), monthlyEquivalent: Number((calc(p.addonPro10) / 12).toFixed(2)) },
  };
}

/**
 * Progressão de Add-ons do Essential e do Pro
 */
export function getAddonProgressions() {
  const essentialBase = OFFICIAL_PRICING_DECISION_V1.monthly.essential;
  const proBase = OFFICIAL_PRICING_DECISION_V1.monthly.pro;
  const addEss = OFFICIAL_PRICING_DECISION_V1.monthly.addonEssential10;
  const addPro = OFFICIAL_PRICING_DECISION_V1.monthly.addonPro10;

  const essentialProgression = [
    { members: 40, price: essentialBase, label: 'Essential Base (40)' },
    { members: 50, price: Number((essentialBase + 1 * addEss).toFixed(2)), label: 'Essential + 1 bloco (50)' },
    { members: 60, price: Number((essentialBase + 2 * addEss).toFixed(2)), label: 'Essential + 2 blocos (60)' },
    { members: 70, price: Number((essentialBase + 3 * addEss).toFixed(2)), label: 'Essential + 3 blocos (70)' },
    { members: 80, price: Number((essentialBase + 4 * addEss).toFixed(2)), label: 'Essential + 4 blocos (80 — Máx)' },
  ];

  const proProgression = [
    { members: 100, price: proBase, label: 'Pro Base (100)' },
    { members: 110, price: Number((proBase + 1 * addPro).toFixed(2)), label: 'Pro + 1 bloco (110)' },
    { members: 120, price: Number((proBase + 2 * addPro).toFixed(2)), label: 'Pro + 2 blocos (120)' },
    { members: 130, price: Number((proBase + 3 * addPro).toFixed(2)), label: 'Pro + 3 blocos (130)' },
    { members: 140, price: Number((proBase + 4 * addPro).toFixed(2)), label: 'Pro + 4 blocos (140)' },
    { members: 150, price: Number((proBase + 5 * addPro).toFixed(2)), label: 'Pro + 5 blocos (150)' },
    { members: 160, price: Number((proBase + 6 * addPro).toFixed(2)), label: 'Pro + 6 blocos (160)' },
    { members: 170, price: Number((proBase + 7 * addPro).toFixed(2)), label: 'Pro + 7 blocos (170)' },
    { members: 180, price: Number((proBase + 8 * addPro).toFixed(2)), label: 'Pro + 8 blocos (180)' },
    { members: 190, price: Number((proBase + 9 * addPro).toFixed(2)), label: 'Pro + 9 blocos (190)' },
    { members: 200, price: Number((proBase + 10 * addPro).toFixed(2)), label: 'Pro + 10 blocos (200 — Máx)' },
  ];

  return { essentialProgression, proProgression };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== LOUVAIO COMMERCIAL PRICING DECISION v1 ===');
  console.log('\n--- SIMULAÇÃO DE MRR (Cenário Baseline: 60% Free / 40% Pagantes) ---');
  [1, 10, 100].forEach(mult => {
    const res = simulateDecisionMRR(mult, 'baseline');
    console.log(`Scale ${res.scale.toString().padStart(6)}: MRR = R$ ${res.mrr.toFixed(2).padStart(9)} | Infra = R$ ${res.infraCostBRL.toFixed(2).padStart(8)} | Infra/MRR = ${res.infraToMRRPct.toFixed(2)}% | Contrib = R$ ${res.contributionAfterInfraBRL.toFixed(2).padStart(9)} | Paid ARPA = R$ ${res.paidARPA.toFixed(2)}`);
  });

  console.log('\n--- BREAK-EVEN TÉCNICO ---', calculateDecisionBreakEven());
  console.log('\n--- PREÇOS ANUAIS OFICIAIS (10% OFF) ---', calculateAnnualPrices());
  console.log('\n--- BENCHMARK LOUVEAPP VS LOUVAIO ---');
  console.table(LOUVEAPP_BENCHMARK);
}
