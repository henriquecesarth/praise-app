/**
 * LouvAIO — Script Determinístico de Modelagem e Reconciliação de Consumo
 * Versão 5.0.0 (Reconciliação Final Pós-Otimização: Premium Comercial 300/1.500, Egress Decomposto e Agregações Exatas)
 * 
 * Uso: node docs/analysis/reconcile-cost-model.mjs
 * 
 * Este script é uma ferramenta analítica de documentação. Não faz parte do runtime.
 */

export const PLANS_CONFIG = {
  free: { name: 'Free', m: 10, s: 50, f: 5, a: 15, c: 7, e: 8, weight: 60, mutations: 20, writes: 120 },
  lite: { name: 'Lite', m: 20, s: 100, f: 8, a: 25, c: 7, e: 12, weight: 10, mutations: 35, writes: 220 },
  lite_plus: { name: 'Lite+', m: 30, s: 150, f: 10, a: 30, c: 8, e: 16, weight: 8, mutations: 50, writes: 310 },
  essential: { name: 'Essential', m: 40, s: 200, f: 15, a: 40, c: 8, e: 20, weight: 12, mutations: 65, writes: 420 },
  pro: { name: 'Pro', m: 100, s: 500, f: 30, a: 80, c: 10, e: 40, weight: 7, mutations: 150, writes: 980 },
  premium: { name: 'Premium (Comercial)', m: 300, s: 1500, f: 60, a: 200, c: 15, e: 100, weight: 3, mutations: 400, writes: 2600 },
  legacy_premium_1k: { name: 'Legacy Analysis (1k)', m: 200, s: 1000, f: 50, a: 150, c: 12, e: 80, weight: 0, mutations: 300, writes: 1950 },
  enterprise_stress: { name: 'Enterprise (Stress)', m: 500, s: 3000, f: 100, a: 300, c: 15, e: 150, weight: 0, mutations: 600, writes: 4800 },
};

export const ACTIVITY_HYPOTHESIS = {
  mauRate: 0.90, // 90% dos membros cadastrados acessam no mês
  dauRatio: 0.35, // 35% dos membros acessam em um dia ativo típico
  activeDaysPerMonth: 16, // ensaios + cultos
  sessionsPerActiveUserDay: 2.0,
  searchesPerSession: 3,
  scheduleVisitsPerSession: 2,
  httpPerSession: 19,
};

export function calculatePerPlan(searchOverride = null) {
  const planResults = {};
  const searchesCount = searchOverride !== null ? searchOverride : ACTIVITY_HYPOTHESIS.searchesPerSession;

  for (const [key, p] of Object.entries(PLANS_CONFIG)) {
    const mau = Math.round(p.m * ACTIVITY_HYPOTHESIS.mauRate);
    const dau = p.m * ACTIVITY_HYPOTHESIS.dauRatio;
    const sessions = dau * ACTIVITY_HYPOTHESIS.activeDaysPerMonth * ACTIVITY_HYPOTHESIS.sessionsPerActiveUserDay;
    
    // Reads components
    // 1. Agregação count().get() (1 read a cada 1.000 entradas de índice por agregação)
    const countReads = Math.ceil(p.s / 1000) + Math.ceil(p.f / 1000) + Math.ceil(p.a / 1000) + Math.ceil(p.c / 1000);
    
    // 2. Bootstrap da sessão: counts + classificações + escalas recentes + assinatura
    const bootstrapReads = countReads + p.c + Math.min(p.e, 5) + 1;
    
    // 3. Navegação normal de repertório via cursor (1.5 páginas de 20 músicas por sessão via limit+1)
    const repertoireBrowsingReads = 31; // 21 (página 1) + 10 (página 2 parcial)
    
    // 4. Busca textual isolada (varrendo as S músicas do ministério autenticado)
    const searchReadsPerSession = searchesCount * p.s;
    
    // 5. Visitas a escalas e comentários recentes
    const scheduleReadsPerSession = 22; // 2 visitas x (1 escala + 5 itens + 5 comentários)
    
    const readsPerSession = bootstrapReads + repertoireBrowsingReads + searchReadsPerSession + scheduleReadsPerSession;
    
    const monthlyReads = Math.round(sessions * readsPerSession + p.mutations * 4);
    const monthlyHttp = Math.round(sessions * ACTIVITY_HYPOTHESIS.httpPerSession + p.mutations);
    
    // Storage (body storage only, index storage excluded)
    const storageKB = Math.round(p.s * 3.5 + p.e * 4.0 + p.m * 1.2 + 50 * 0.5 + (p.f + p.a + p.c) * 0.8);
    
    // Egress Decomposto:
    // A. Firestore -> Vercel (DB Egress):
    //    - Bootstrap + browsing + schedules: ~70 KB
    //    - Search scan payload: searchesCount * p.s * ~2.5 KB (título + artista + letra compacta)
    const dbEgressKBSession = 70 + (searchesCount * p.s * 2.5);
    const monthlyDbEgressMB = Number(((sessions * dbEgressKBSession) / 1024).toFixed(2));
    
    // B. Vercel -> Browser (REST Response Egress):
    //    - JSON responses com projeção SongSummary e listas paginadas: ~80 KB por sessão
    const restEgressKBSession = 80;
    const monthlyRestEgressMB = Number(((sessions * restEgressKBSession) / 1024).toFixed(2));

    planResults[key] = {
      ...p,
      mau,
      dau,
      sessions,
      countReads,
      bootstrapReads,
      repertoireBrowsingReads,
      searchReadsPerSession,
      scheduleReadsPerSession,
      readsPerSession,
      monthlyReads,
      monthlyHttp,
      storageKB,
      monthlyDbEgressMB,
      monthlyRestEgressMB,
    };
  }

  return planResults;
}

export function calculateAggregate(multiplier = 1, searchOverride = null) {
  const perPlan = calculatePerPlan(searchOverride);
  let totalM = 0, totalMAU = 0, totalDAU = 0, totalSess = 0, totalHttp = 0;
  let totalReads = 0, totalWrites = 0, totalStorageKB = 0, totalDbEgressMB = 0, totalRestEgressMB = 0;

  for (const r of Object.values(perPlan)) {
    if (r.weight > 0) {
      const planCount = r.weight * multiplier;
      totalM += r.m * planCount;
      totalMAU += r.mau * planCount;
      totalDAU += r.dau * planCount;
      totalSess += r.sessions * planCount;
      totalHttp += r.monthlyHttp * planCount;
      totalReads += r.monthlyReads * planCount;
      totalWrites += r.writes * planCount;
      totalStorageKB += r.storageKB * planCount;
      totalDbEgressMB += r.monthlyDbEgressMB * planCount;
      totalRestEgressMB += r.monthlyRestEgressMB * planCount;
    }
  }

  return {
    ministriesCount: 100 * multiplier,
    members: totalM,
    mau: totalMAU,
    dau: totalDAU,
    sessions: totalSess,
    httpRequests: totalHttp,
    firestoreReads: totalReads,
    firestoreWrites: totalWrites,
    storageMB: Number((totalStorageKB / 1024).toFixed(2)),
    bandwidthGB: Number(((totalDbEgressMB + totalRestEgressMB) / 1024).toFixed(2)),
    firestoreEgressGB: Number((totalDbEgressMB / 1024).toFixed(2)),
    vercelBandwidthGB: Number(((totalDbEgressMB + totalRestEgressMB) / 1024).toFixed(2)),
    restEgressGB: Number((totalRestEgressMB / 1024).toFixed(2)),
  };
}

// Se executado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('--- PER PLAN RESULTS (V5 RECONCILED) ---');
  console.table(calculatePerPlan());
  console.log('--- 100 MINISTRIES ---');
  console.log(calculateAggregate(1));
  console.log('--- 1.000 MINISTRIES ---');
  console.log(calculateAggregate(10));
  console.log('--- 10.000 MINISTRIES ---');
  console.log(calculateAggregate(100));
  console.log('--- 100.000 MINISTRIES ---');
  console.log(calculateAggregate(1000));
}
