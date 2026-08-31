/**
 * LouvAIO — Script de Precificação Monetária de Infraestrutura (Versão 3.0 Final Reconciliada)
 * 
 * Execução: node docs/analysis/calculate-pricing.mjs
 */

import { calculateAggregate, calculatePerPlan, PLANS_CONFIG, ACTIVITY_HYPOTHESIS } from './reconcile-cost-model.mjs';

export const PRICING_SNAPSHOT = {
  date: '2026-08-29',
  usdBrlRate: 5.19, // Cotação mid-market em 2026-08-29
  sources: {
    firestore: 'https://cloud.google.com/firestore/pricing',
    network: 'https://cloud.google.com/vpc/network-pricing',
    firebaseAuth: 'https://cloud.google.com/identity-platform/pricing',
    vercel: 'https://vercel.com/docs/pricing',
    vercelPricingPage: 'https://vercel.com/pricing',
    currency: 'Mid-market quote (Wise/Xe) em 2026-08-29'
  },
  firestore: {
    freeTierMonthly: {
      reads: 50000 * 30,   // 1.5M reads/mês
      writes: 20000 * 30,  // 600k writes/mês
      deletes: 20000 * 30, // 600k deletes/mês
      storageGB: 1.0,      // 1 GiB/mês
      egressGB: 10.0,      // 10 GiB/mês
    },
    usCentral1: {
      readsPer1M: 0.30,        // $0.03 per 100k
      writesPer1M: 0.90,       // $0.09 per 100k
      deletesPer1M: 0.10,      // $0.01 per 100k
      storagePerGBMonth: 0.18, // $0.18 / GiB-month ($0.0002466/GiB-hour x 730h)
    },
    southamericaEast1: {
      readsPer1M: 0.45,        // $0.045 per 100k
      writesPer1M: 1.35,       // $0.135 per 100k
      deletesPer1M: 0.15,      // $0.015 per 100k
      storagePerGBMonth: 0.25, // $0.25 / GiB-month ($0.0003425/GiB-hour x 730h)
    },
    // Google Cloud Internet Data Transfer Out (Premium Tier Worldwide)
    // Aplicável a egress para internet (Vercel) independente de origem US/SP
    internetEgressTiers: [
      { upToGB: 1024, rateUSD: 0.12 },   // 0 a 1 TiB (1.024 GiB)
      { upToGB: 10240, rateUSD: 0.11 },  // 1 a 10 TiB (1.024 a 10.240 GiB)
      { upToGB: Infinity, rateUSD: 0.08 } // 10 TiB+ (10.240 GiB+)
    ]
  },
  firebaseAuth: {
    freeMAU: 50000,
    identityPlatformTiers: [
      { upTo: 50000, rate: 0.0 },
      { upTo: 100000, rate: 0.0055 },
      { upTo: 1000000, rate: 0.0046 },
      { upTo: 10000000, rate: 0.0032 },
      { upTo: Infinity, rate: 0.0025 }
    ]
  },
  vercel: {
    proBaseSeats: 1,
    seatPriceMonthly: 20.0,
    includedMonthlyUsageCredit: 20.0,
    // Included Resource Allocations (Pro)
    includedAllocations: {
      invocations: 1000000,      // 1M invocations/mês
      activeCpuHours: 4.0,       // 4 CPU-horas/mês
      provisionedMemGBHours: 360,// 360 GB-horas/mês
      edgeRequests: 10000000,    // 10M Edge Requests/mês
      fastOriginTransferGB: 10,  // 10 GB FOT/mês
      fastDataTransferGB: 1000,  // 1 TB (1.000 GB) FDT/mês
    },
    rates: {
      invocationsPer1M: 0.60,
      activeCpuPerHour: 0.128,
      provisionedMemGBHour: 0.0106,
      edgeRequestsPer1M: 2.00,
      fotOveragePerGB: 0.06,
      fdtOveragePerGB: 0.15,
    }
  },
  computeScenarios: {
    low: { activeCpuMs: 30, wallClockMs: 80, memoryGB: 0.5 },
    medium: { activeCpuMs: 60, wallClockMs: 150, memoryGB: 1.0 },
    high: { activeCpuMs: 120, wallClockMs: 300, memoryGB: 1.0 },
  },
  egressScenariosPerSessionMB: {
    low: { free: 0.2, lite: 0.4, lite_plus: 0.6, essential: 0.8, pro: 2.0, premium: 6.0, enterprise_stress: 15.0, legacy_premium_1k: 4.5 },
    medium: { free: 0.4, lite: 0.8, lite_plus: 1.2, essential: 1.6, pro: 4.0, premium: 11.5, enterprise_stress: 25.0, legacy_premium_1k: 8.0 },
    high: { free: 0.8, lite: 1.6, lite_plus: 2.4, essential: 3.2, pro: 8.0, premium: 23.0, enterprise_stress: 50.0, legacy_premium_1k: 16.0 },
  }
};

/**
 * Calcula custo de Internet Egress do Google Cloud por faixas marginais (Tiered Pricing)
 */
export function calculateTieredEgressCost(billableGB) {
  if (billableGB <= 0) return 0;
  let remaining = billableGB;
  let cost = 0;
  let prevLimit = 0;

  for (const tier of PRICING_SNAPSHOT.firestore.internetEgressTiers) {
    const tierCapacity = tier.upToGB - prevLimit;
    const usageInTier = Math.min(remaining, tierCapacity);
    cost += usageInTier * tier.rateUSD;
    remaining -= usageInTier;
    prevLimit = tier.upToGB;
    if (remaining <= 0) break;
  }
  return cost;
}

/**
 * Calcula custo do Firebase Auth sob cenário com/sem Identity Platform
 */
export function calculateAuthCost(mau, withIdentityPlatform = false) {
  if (!withIdentityPlatform) return 0;
  if (mau <= 50000) return 0;
  let remaining = mau - 50000;
  let cost = 0;
  // 50k a 100k (próximos 50k)
  const t1 = Math.min(remaining, 50000);
  cost += t1 * 0.0055;
  remaining -= t1;
  if (remaining <= 0) return cost;
  // 100k a 1M (próximos 900k)
  const t2 = Math.min(remaining, 900000);
  cost += t2 * 0.0046;
  remaining -= t2;
  if (remaining <= 0) return cost;
  // 1M a 10M
  const t3 = Math.min(remaining, 9000000);
  cost += t3 * 0.0032;
  remaining -= t3;
  if (remaining <= 0) return cost;
  cost += remaining * 0.0025;
  return cost;
}

/**
 * Calcula o volume de egress do Firestore (em GB) conforme o cenário de sensibilidade
 */
export function calculateFirestoreEgressGB(multiplier = 1, egressScenario = 'medium') {
  const perPlan = calculatePerPlan();
  const scenarioMap = PRICING_SNAPSHOT.egressScenariosPerSessionMB[egressScenario];
  let totalMB = 0;
  for (const [key, p] of Object.entries(perPlan)) {
    if (p.weight > 0) {
      const planCount = p.weight * multiplier;
      const sess = p.sessions * planCount;
      const mbPerSess = scenarioMap[key] || 2.0;
      totalMB += sess * mbPerSess;
    }
  }
  return totalMB / 1024;
}

/**
 * Simulação determinística de custos de escala
 */
export function calculateScaleCost(
  multiplier = 1,
  regionKey = 'usCentral1',
  withIdentityPlatform = false,
  computeScenario = 'medium',
  egressScenario = 'medium'
) {
  const agg = calculateAggregate(multiplier);
  const pricing = PRICING_SNAPSHOT.firestore[regionKey];
  const comp = PRICING_SNAPSHOT.computeScenarios[computeScenario];
  const vercelCfg = PRICING_SNAPSHOT.vercel;
  const vercelInc = vercelCfg.includedAllocations;

  // 1. Firestore Reads (deduzindo franquia gratuita mensal de 1,5M)
  const billableReads = Math.max(0, agg.firestoreReads - PRICING_SNAPSHOT.firestore.freeTierMonthly.reads);
  const firestoreReadsCostUSD = (billableReads / 1000000) * pricing.readsPer1M;

  // 2. Firestore Writes (deduzindo franquia gratuita mensal de 600k)
  const billableWrites = Math.max(0, agg.firestoreWrites - PRICING_SNAPSHOT.firestore.freeTierMonthly.writes);
  const firestoreWritesCostUSD = (billableWrites / 1000000) * pricing.writesPer1M;

  // 3. Firestore Storage (deduzindo 1 GB gratuito)
  const billableStorageGB = Math.max(0, (agg.storageMB / 1024) - PRICING_SNAPSHOT.firestore.freeTierMonthly.storageGB);
  const firestoreStorageCostUSD = billableStorageGB * pricing.storagePerGBMonth;

  // 4. Firestore Internet Egress (deduzindo 10 GB gratuitos e aplicando faixas marginais)
  const firestoreEgressGB = calculateFirestoreEgressGB(multiplier, egressScenario);
  const billableFirestoreEgressGB = Math.max(0, firestoreEgressGB - PRICING_SNAPSHOT.firestore.freeTierMonthly.egressGB);
  const firestoreEgressCostUSD = calculateTieredEgressCost(billableFirestoreEgressGB);

  // 5. Firebase Auth
  const authCostUSD = calculateAuthCost(agg.mau, withIdentityPlatform);

  // 6. Vercel Function Invocations (deduzindo 1M incluídas)
  const rawInvocations = agg.httpRequests;
  const billableInvocations = Math.max(0, rawInvocations - vercelInc.invocations);
  const invocationsCostUSD = (billableInvocations / 1000000) * vercelCfg.rates.invocationsPer1M;

  // 7. Vercel Active CPU (deduzindo 4 CPU-horas incluídas)
  const rawActiveCpuHours = (agg.httpRequests * (comp.activeCpuMs / 1000)) / 3600;
  const billableActiveCpuHours = Math.max(0, rawActiveCpuHours - vercelInc.activeCpuHours);
  const activeCpuCostUSD = billableActiveCpuHours * vercelCfg.rates.activeCpuPerHour;

  // 8. Vercel Provisioned Memory (deduzindo 360 GB-horas incluídas)
  const rawMemGBHours = (agg.httpRequests * (comp.wallClockMs / 1000) * comp.memoryGB) / 3600;
  const billableMemGBHours = Math.max(0, rawMemGBHours - vercelInc.provisionedMemGBHours);
  const memoryCostUSD = billableMemGBHours * vercelCfg.rates.provisionedMemGBHour;

  // 9. Vercel Edge Requests (deduzindo 10M incluídas)
  const rawEdgeRequests = agg.httpRequests;
  const billableEdgeRequests = Math.max(0, rawEdgeRequests - vercelInc.edgeRequests);
  const edgeRequestsCostUSD = (billableEdgeRequests / 1000000) * vercelCfg.rates.edgeRequestsPer1M;

  // 10. Vercel Fast Origin Transfer (FOT) (deduzindo 10 GB incluídos)
  const rawFOT_GB = agg.bandwidthGB;
  const billableFOT_GB = Math.max(0, rawFOT_GB - vercelInc.fastOriginTransferGB);
  const fotCostUSD = billableFOT_GB * vercelCfg.rates.fotOveragePerGB;

  // 11. Vercel Fast Data Transfer (FDT) (deduzindo 1 TB incluído)
  const rawFDT_GB = agg.bandwidthGB;
  const billableFDT_GB = Math.max(0, rawFDT_GB - vercelInc.fastDataTransferGB);
  const fdtCostUSD = billableFDT_GB * vercelCfg.rates.fdtOveragePerGB;

  // 12. Vercel Managed Infrastructure Usage & Aplicação do Crédito de $20
  const totalBillableUsageBeforeCredit = invocationsCostUSD + activeCpuCostUSD + memoryCostUSD + edgeRequestsCostUSD + fotCostUSD + fdtCostUSD;
  const vercelUsageOverageUSD = Math.max(0, totalBillableUsageBeforeCredit - vercelCfg.includedMonthlyUsageCredit);
  const vercelBaseFeeUSD = vercelCfg.proBaseSeats * vercelCfg.seatPriceMonthly;
  const totalVercelCostUSD = vercelBaseFeeUSD + vercelUsageOverageUSD;

  // 13. Totais Agregados
  const firestoreTotalUSD = firestoreReadsCostUSD + firestoreWritesCostUSD + firestoreStorageCostUSD + firestoreEgressCostUSD;
  const variableCostUSD = firestoreTotalUSD + authCostUSD + vercelUsageOverageUSD;
  const fixedCostUSD = vercelBaseFeeUSD;
  const totalCostUSD = fixedCostUSD + variableCostUSD;
  const totalCostBRL = totalCostUSD * PRICING_SNAPSHOT.usdBrlRate;

  return {
    scale: agg.ministriesCount,
    region: regionKey,
    withIdentityPlatform,
    computeScenario,
    egressScenario,
    members: agg.members,
    mau: agg.mau,
    sessions: agg.sessions,
    httpRequests: agg.httpRequests,
    firestoreReads: agg.firestoreReads,
    firestoreWrites: agg.firestoreWrites,
    firestoreEgressGB: Number(firestoreEgressGB.toFixed(2)),
    bandwidthGB: agg.bandwidthGB,
    storageMB: agg.storageMB,
    // Itemized Firestore USD
    firestoreReadsCostUSD: Number(firestoreReadsCostUSD.toFixed(2)),
    firestoreWritesCostUSD: Number(firestoreWritesCostUSD.toFixed(2)),
    firestoreStorageCostUSD: Number(firestoreStorageCostUSD.toFixed(2)),
    firestoreEgressCostUSD: Number(firestoreEgressCostUSD.toFixed(2)),
    firestoreTotalUSD: Number(firestoreTotalUSD.toFixed(2)),
    // Auth USD
    authCostUSD: Number(authCostUSD.toFixed(2)),
    // Vercel Itemized Usage Before Credit
    rawInvocations,
    billableInvocations,
    invocationsCostUSD: Number(invocationsCostUSD.toFixed(2)),
    rawActiveCpuHours: Number(rawActiveCpuHours.toFixed(2)),
    billableActiveCpuHours: Number(billableActiveCpuHours.toFixed(2)),
    activeCpuCostUSD: Number(activeCpuCostUSD.toFixed(2)),
    rawMemGBHours: Number(rawMemGBHours.toFixed(2)),
    billableMemGBHours: Number(billableMemGBHours.toFixed(2)),
    memoryCostUSD: Number(memoryCostUSD.toFixed(2)),
    rawEdgeRequests,
    billableEdgeRequests,
    edgeRequestsCostUSD: Number(edgeRequestsCostUSD.toFixed(2)),
    rawFOT_GB: Number(rawFOT_GB.toFixed(2)),
    billableFOT_GB: Number(billableFOT_GB.toFixed(2)),
    fotCostUSD: Number(fotCostUSD.toFixed(2)),
    rawFDT_GB: Number(rawFDT_GB.toFixed(2)),
    billableFDT_GB: Number(billableFDT_GB.toFixed(2)),
    fdtCostUSD: Number(fdtCostUSD.toFixed(2)),
    totalBillableUsageBeforeCredit: Number(totalBillableUsageBeforeCredit.toFixed(2)),
    vercelUsageOverageUSD: Number(vercelUsageOverageUSD.toFixed(2)),
    vercelBaseFeeUSD: Number(vercelBaseFeeUSD.toFixed(2)),
    totalVercelCostUSD: Number(totalVercelCostUSD.toFixed(2)),
    // Summary
    fixedCostUSD: Number(fixedCostUSD.toFixed(2)),
    variableCostUSD: Number(variableCostUSD.toFixed(2)),
    totalCostUSD: Number(totalCostUSD.toFixed(2)),
    totalCostBRL: Number(totalCostBRL.toFixed(2)),
    costPerMinistryUSD: Number((totalCostUSD / agg.ministriesCount).toFixed(2)),
    costPerMinistryBRL: Number((totalCostBRL / agg.ministriesCount).toFixed(2)),
    costPerMAU_USD: Number((totalCostUSD / agg.mau).toFixed(4)),
    costPerMAU_BRL: Number((totalCostBRL / agg.mau).toFixed(4)),
  };
}

/**
 * Calcula custo marginal unitário (Marginal Resource Cost) e custo alocado no cenário (Scenario Allocated Cost) por plano
 */
export function calculatePlanDetailedCosts(
  scaleMultiplier = 1,
  regionKey = 'usCentral1',
  withIdentityPlatform = false,
  computeScenario = 'medium',
  egressScenario = 'medium'
) {
  const perPlan = calculatePerPlan();
  const pricing = PRICING_SNAPSHOT.firestore[regionKey];
  const comp = PRICING_SNAPSHOT.computeScenarios[computeScenario];
  const scenarioMap = PRICING_SNAPSHOT.egressScenariosPerSessionMB[egressScenario];
  const scaleResult = calculateScaleCost(scaleMultiplier, regionKey, withIdentityPlatform, computeScenario, egressScenario);

  const planResults = {};
  let totalMarginalAllPlans = 0;

  // 1. Calcular Marginal Resource Cost (preços unitários diretos sem free tiers)
  for (const [key, p] of Object.entries(perPlan)) {
    const readsUSD = (p.monthlyReads / 1000000) * pricing.readsPer1M;
    const writesUSD = (p.writes / 1000000) * pricing.writesPer1M;
    const storageUSD = (p.storageKB / (1024 * 1024)) * pricing.storagePerGBMonth;
    const egressMB = p.monthlyDbEgressMB || (p.sessions * (scenarioMap[key] || 2.0));
    const firestoreEgressUSD = (egressMB / 1024) * PRICING_SNAPSHOT.firestore.internetEgressTiers[0].rateUSD;

    const invocationsUSD = (p.monthlyHttp / 1000000) * PRICING_SNAPSHOT.vercel.rates.invocationsPer1M;
    const cpuHours = (p.monthlyHttp * (comp.activeCpuMs / 1000)) / 3600;
    const cpuUSD = cpuHours * PRICING_SNAPSHOT.vercel.rates.activeCpuPerHour;
    const memGBHours = (p.monthlyHttp * (comp.wallClockMs / 1000) * comp.memoryGB) / 3600;
    const memUSD = memGBHours * PRICING_SNAPSHOT.vercel.rates.provisionedMemGBHour;
    const vercelComputeUSD = invocationsUSD + cpuUSD + memUSD;

    const monthlyBW = (p.monthlyDbEgressMB || 0) + (p.monthlyRestEgressMB || 0);
    const vercelFOT_USD = (monthlyBW / 1024) * PRICING_SNAPSHOT.vercel.rates.fotOveragePerGB;
    const vercelFDT_USD = (monthlyBW / 1024) * PRICING_SNAPSHOT.vercel.rates.fdtOveragePerGB;
    const vercelEdgeReqUSD = (p.monthlyHttp / 1000000) * PRICING_SNAPSHOT.vercel.rates.edgeRequestsPer1M;
    const authMarginalUSD = withIdentityPlatform ? p.mau * 0.0055 : 0.0;

    const marginalResourceUSD = readsUSD + writesUSD + storageUSD + firestoreEgressUSD + vercelComputeUSD + vercelFOT_USD + vercelFDT_USD + vercelEdgeReqUSD + authMarginalUSD;
    const marginalResourceBRL = marginalResourceUSD * PRICING_SNAPSHOT.usdBrlRate;

    planResults[key] = {
      name: p.name,
      m: p.m,
      s: p.s,
      weight: p.weight,
      readsUSD: Number(readsUSD.toFixed(4)),
      writesUSD: Number(writesUSD.toFixed(4)),
      storageUSD: Number(storageUSD.toFixed(4)),
      firestoreEgressUSD: Number(firestoreEgressUSD.toFixed(4)),
      vercelComputeUSD: Number(vercelComputeUSD.toFixed(4)),
      vercelFOT_USD: Number(vercelFOT_USD.toFixed(4)),
      vercelFDT_USD: Number(vercelFDT_USD.toFixed(4)),
      vercelEdgeReqUSD: Number(vercelEdgeReqUSD.toFixed(4)),
      authMarginalUSD: Number(authMarginalUSD.toFixed(4)),
      marginalResourceUSD: Number(marginalResourceUSD.toFixed(4)),
      marginalResourceBRL: Number(marginalResourceBRL.toFixed(2)),
      // Variable Floors
      varFloor5pctBRL: Number((marginalResourceBRL / 0.05).toFixed(2)),
      varFloor10pctBRL: Number((marginalResourceBRL / 0.10).toFixed(2)),
      varFloor15pctBRL: Number((marginalResourceBRL / 0.15).toFixed(2)),
      varFloor20pctBRL: Number((marginalResourceBRL / 0.20).toFixed(2)),
    };

    if (p.weight > 0) {
      totalMarginalAllPlans += marginalResourceUSD * p.weight;
    }
  }

  // 2. Calcular Scenario Allocated Cost (rateio da fatura real do cenário proporcional ao consumo marginal)
  const totalScaleMinistries = scaleResult.scale;
  const totalActualInvoiceUSD = scaleResult.totalCostUSD;

  for (const [key, p] of Object.entries(planResults)) {
    if (p.weight > 0) {
      // Proporção de consumo marginal
      const planWeightInTotalVar = (p.marginalResourceUSD * p.weight) / totalMarginalAllPlans;
      // Custo variável real alocado para o segmento inteiro do plano
      const segmentActualVarUSD = scaleResult.variableCostUSD * planWeightInTotalVar;
      // Custo variável real por ministério individual daquele plano
      const unitActualVarUSD = segmentActualVarUSD / (p.weight * scaleMultiplier);
      // Rateio igualitário do custo fixo da Vercel ($20 / total de ministérios)
      const unitFixedUSD = scaleResult.fixedCostUSD / totalScaleMinistries;
      
      const scenarioAllocatedUSD = unitActualVarUSD + unitFixedUSD;
      const scenarioAllocatedBRL = scenarioAllocatedUSD * PRICING_SNAPSHOT.usdBrlRate;

      planResults[key].scenarioAllocatedUSD = Number(scenarioAllocatedUSD.toFixed(4));
      planResults[key].scenarioAllocatedBRL = Number(scenarioAllocatedBRL.toFixed(2));
      // Allocated Floors
      planResults[key].allocFloor5pctBRL = Number((scenarioAllocatedBRL / 0.05).toFixed(2));
      planResults[key].allocFloor10pctBRL = Number((scenarioAllocatedBRL / 0.10).toFixed(2));
      planResults[key].allocFloor15pctBRL = Number((scenarioAllocatedBRL / 0.15).toFixed(2));
      planResults[key].allocFloor20pctBRL = Number((scenarioAllocatedBRL / 0.20).toFixed(2));
    }
  }

  return planResults;
}

/**
 * Custo marginal do add-on de +10 membros
 */
export function calculateAddonCost(
  planKey = 'essential',
  regionKey = 'usCentral1',
  computeScenario = 'medium',
  egressScenario = 'medium'
) {
  const p = PLANS_CONFIG[planKey];
  const pricing = PRICING_SNAPSHOT.firestore[regionKey];
  const comp = PRICING_SNAPSHOT.computeScenarios[computeScenario];
  const scenarioMap = PRICING_SNAPSHOT.egressScenariosPerSessionMB[egressScenario];

  const addonM = 10;
  const addonDAU = addonM * ACTIVITY_HYPOTHESIS.dauRatio; // 3.5
  const addonSessions = addonDAU * ACTIVITY_HYPOTHESIS.activeDaysPerMonth * ACTIVITY_HYPOTHESIS.sessionsPerActiveUserDay; // 112

  const countReads = Math.ceil(p.s / 1000) + Math.ceil(p.f / 1000) + Math.ceil(p.a / 1000) + Math.ceil(p.c / 1000);
  const bootstrapReads = countReads + p.c + Math.min(p.e, 5) + 1;
  const repertoireBrowsingReads = 31;
  const searchReads = ACTIVITY_HYPOTHESIS.searchesPerSession * p.s;
  const scheduleReads = 22;
  const readsPerSession = bootstrapReads + repertoireBrowsingReads + searchReads + scheduleReads;

  const monthlyReads = addonSessions * readsPerSession;
  const readsCostUSD = (monthlyReads / 1000000) * pricing.readsPer1M;

  const monthlyHttp = addonSessions * ACTIVITY_HYPOTHESIS.httpPerSession;
  const invocationsUSD = (monthlyHttp / 1000000) * PRICING_SNAPSHOT.vercel.rates.invocationsPer1M;
  const cpuHours = (monthlyHttp * (comp.activeCpuMs / 1000)) / 3600;
  const cpuUSD = cpuHours * PRICING_SNAPSHOT.vercel.rates.activeCpuPerHour;
  const memGBHours = (monthlyHttp * (comp.wallClockMs / 1000) * comp.memoryGB) / 3600;
  const memUSD = memGBHours * PRICING_SNAPSHOT.vercel.rates.provisionedMemGBHour;
  const vercelComputeUSD = invocationsUSD + cpuUSD + memUSD;

  const dbEgressKBSession = 70 + (ACTIVITY_HYPOTHESIS.searchesPerSession * p.s * 2.5);
  const monthlyDbEgressMB = (addonSessions * dbEgressKBSession) / 1024;
  const monthlyRestEgressMB = (addonSessions * 80) / 1024;
  const monthlyBandwidthMB = monthlyDbEgressMB + monthlyRestEgressMB;

  const vercelFDT_USD = (monthlyBandwidthMB / 1024) * PRICING_SNAPSHOT.vercel.rates.fdtOveragePerGB;
  const vercelFOT_USD = (monthlyBandwidthMB / 1024) * PRICING_SNAPSHOT.vercel.rates.fotOveragePerGB;
  const vercelEdgeReqUSD = (monthlyHttp / 1000000) * PRICING_SNAPSHOT.vercel.rates.edgeRequestsPer1M;

  const firestoreEgressUSD = (monthlyDbEgressMB / 1024) * PRICING_SNAPSHOT.firestore.internetEgressTiers[0].rateUSD;

  const totalAddonUSD = readsCostUSD + firestoreEgressUSD + vercelComputeUSD + vercelFOT_USD + vercelFDT_USD + vercelEdgeReqUSD;
  const totalAddonBRL = totalAddonUSD * PRICING_SNAPSHOT.usdBrlRate;

  return {
    plan: p.name,
    addonMembers: 10,
    monthlySessions: addonSessions,
    monthlyReads,
    monthlyHttp,
    monthlyBandwidthMB: Number(monthlyBandwidthMB.toFixed(2)),
    readsCostUSD: Number(readsCostUSD.toFixed(4)),
    firestoreEgressUSD: Number(firestoreEgressUSD.toFixed(4)),
    vercelComputeUSD: Number(vercelComputeUSD.toFixed(4)),
    vercelFOT_USD: Number(vercelFOT_USD.toFixed(4)),
    vercelFDT_USD: Number(vercelFDT_USD.toFixed(4)),
    vercelEdgeReqUSD: Number(vercelEdgeReqUSD.toFixed(4)),
    totalAddonUSD: Number(totalAddonUSD.toFixed(4)),
    totalAddonBRL: Number(totalAddonBRL.toFixed(2)),
  };
}

/**
 * Análise de sensibilidade de busca para o plano Premium 300/1.500
 */
export function calculatePremiumSearchSensitivity(regionKey = 'usCentral1') {
  const p = PLANS_CONFIG.premium;
  const pricing = PRICING_SNAPSHOT.firestore[regionKey];
  const comp = PRICING_SNAPSHOT.computeScenarios.medium;
  const dau = p.m * ACTIVITY_HYPOTHESIS.dauRatio; // 105
  const sessions = dau * ACTIVITY_HYPOTHESIS.activeDaysPerMonth * ACTIVITY_HYPOTHESIS.sessionsPerActiveUserDay; // 3.360
  const monthlyHttp = sessions * ACTIVITY_HYPOTHESIS.httpPerSession + p.mutations;

  // 1. Componentes Diretos Não-Busca (Non-search direct infrastructure)
  const nonSearchReadsPerSession = (Math.ceil(p.s / 1000) + Math.ceil(p.f / 1000) + Math.ceil(p.a / 1000) + Math.ceil(p.c / 1000)) + p.c + Math.min(p.e, 5) + 1 + 31 + 22; // 7 + 31 + 22 = 60
  const nonSearchMonthlyReads = Math.round(sessions * nonSearchReadsPerSession + p.mutations * 4); // 3.360 * 60 + 10.400 = 212.000
  const nonSearchReadsUSD = (nonSearchMonthlyReads / 1000000) * pricing.readsPer1M;
  const writesUSD = (p.writes / 1000000) * pricing.writesPer1M;
  const storageUSD = (Math.round(p.s * 3.5 + p.e * 4.0 + p.m * 1.2 + 50 * 0.5 + (p.f + p.a + p.c) * 0.8) / (1024 * 1024)) * pricing.storagePerGBMonth;

  // Non-search egress: ~70 KB DB + 80 KB REST per session
  const nonSearchDbEgressMB = (sessions * 70) / 1024;
  const nonSearchRestEgressMB = (sessions * 80) / 1024;
  const nonSearchDbEgressUSD = (nonSearchDbEgressMB / 1024) * PRICING_SNAPSHOT.firestore.internetEgressTiers[0].rateUSD;

  // Vercel compute & edge requests
  const invocationsUSD = (monthlyHttp / 1000000) * PRICING_SNAPSHOT.vercel.rates.invocationsPer1M;
  const cpuHours = (monthlyHttp * (comp.activeCpuMs / 1000)) / 3600;
  const cpuUSD = cpuHours * PRICING_SNAPSHOT.vercel.rates.activeCpuPerHour;
  const memGBHours = (monthlyHttp * (comp.wallClockMs / 1000) * comp.memoryGB) / 3600;
  const memUSD = memGBHours * PRICING_SNAPSHOT.vercel.rates.provisionedMemGBHour;
  const vercelComputeUSD = invocationsUSD + cpuUSD + memUSD;

  const vercelEdgeReqUSD = (monthlyHttp / 1000000) * PRICING_SNAPSHOT.vercel.rates.edgeRequestsPer1M;
  const nonSearchBW = nonSearchDbEgressMB + nonSearchRestEgressMB;
  const nonSearchFOT_USD = (nonSearchBW / 1024) * PRICING_SNAPSHOT.vercel.rates.fotOveragePerGB;
  const nonSearchFDT_USD = (nonSearchBW / 1024) * PRICING_SNAPSHOT.vercel.rates.fdtOveragePerGB;

  const otherDirectUSD = nonSearchReadsUSD + writesUSD + storageUSD + nonSearchDbEgressUSD + vercelComputeUSD + nonSearchFOT_USD + nonSearchFDT_USD + vercelEdgeReqUSD;
  const otherDirectBRL = otherDirectUSD * PRICING_SNAPSHOT.usdBrlRate;

  const scenarios = [1, 2, 3, 4, 5, 10];
  const results = [];
  const planPrice = 214.90;

  for (const searches of scenarios) {
    const searchReads = searches * p.s; // searches * 1.500
    const monthlySearchReads = sessions * searchReads;
    const searchReadsCostUSD = (monthlySearchReads / 1000000) * pricing.readsPer1M;
    
    // DB Egress de busca (2.5 KB/doc scaneado)
    const searchEgressMB = (sessions * (searches * p.s * 2.5)) / 1024;
    const searchEgressUSD = (searchEgressMB / 1024) * PRICING_SNAPSHOT.firestore.internetEgressTiers[0].rateUSD;

    // Vercel additional bandwidth overage from search DB egress
    const searchFOT_USD = (searchEgressMB / 1024) * PRICING_SNAPSHOT.vercel.rates.fotOveragePerGB;
    const searchFDT_USD = (searchEgressMB / 1024) * PRICING_SNAPSHOT.vercel.rates.fdtOveragePerGB;

    const searchCostUSD = searchReadsCostUSD + searchEgressUSD + searchFOT_USD + searchFDT_USD;
    const searchCostBRL = searchCostUSD * PRICING_SNAPSHOT.usdBrlRate;

    const totalDirectUSD = otherDirectUSD + searchCostUSD;
    const totalDirectBRL = totalDirectUSD * PRICING_SNAPSHOT.usdBrlRate;

    const directInfraRatio = (totalDirectBRL / planPrice) * 100;
    const contributionAfterDirectInfra = planPrice - totalDirectBRL;

    results.push({
      searchesPerSession: searches,
      monthlySearches: sessions * searches,
      monthlySearchReads,
      searchCostUSD: Number(searchCostUSD.toFixed(4)),
      searchCostBRL: Number(searchCostBRL.toFixed(2)),
      otherDirectInfraBRL: Number(otherDirectBRL.toFixed(2)),
      totalDirectInfraBRL: Number(totalDirectBRL.toFixed(2)),
      directInfraRatioPct: Number(directInfraRatio.toFixed(2)),
      contributionAfterDirectInfraBRL: Number(contributionAfterDirectInfra.toFixed(2)),
    });
  }

  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('=== TESTE DE EXECUÇÃO RECONCILIADA v5.1 ===');
  const res100 = calculateScaleCost(1, 'usCentral1', false, 'medium', 'medium');
  console.log('100 Ministries (Scenario A):', res100);
  console.log('Premium Search Sensitivity:', calculatePremiumSearchSensitivity());
}
