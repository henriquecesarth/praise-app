import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubscriptionService, resolveCurrentRenewalRecoveryInvoice } from './subscription.service';
import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import {
  PLANS_CATALOG,
  getPlanDefinition,
  getEffectiveMemberQuota,
  getEffectiveSongQuota,
  isUsageOverLimit,
  resolveAccessMode,
  DEFAULT_GRACE_PERIOD_DAYS,
} from '../../config/plans.config';
import { MinistrySubscriptionRecord, MinistryUsageRecord } from './subscription.types';

describe('Subscription & Quota Engine (Backend Tests)', () => {
  // --------------------------------------------------------------------------
  // 1. Catálogo e Definições de Planos
  // --------------------------------------------------------------------------
  describe('1. Catálogo Oficial de Planos', () => {
    it('deve conter exatamente os 6 planos comerciais confirmados com suas quotas e preços', () => {
      const planKeys = Object.keys(PLANS_CATALOG);
      expect(planKeys).toEqual(['free', 'lite', 'lite_plus', 'essential', 'pro', 'premium']);

      // Free
      expect(PLANS_CATALOG.free).toEqual({
        id: 'free',
        name: 'Free',
        baseMembers: 10,
        baseSongs: 50,
        allowMemberAddons: false,
        maxMemberAddonBlocks: 0,
        monthlyPriceCents: 0,
        annualPriceCents: 0,
        addonBlockMonthlyPriceCents: 0,
        addonBlockAnnualPriceCents: 0,
        includedWhatsAppConnections: 0,
      });

      // Lite
      expect(PLANS_CATALOG.lite).toEqual({
        id: 'lite',
        name: 'Lite',
        baseMembers: 20,
        baseSongs: 100,
        allowMemberAddons: false,
        maxMemberAddonBlocks: 0,
        monthlyPriceCents: 1490,
        annualPriceCents: 16092,
        addonBlockMonthlyPriceCents: 0,
        addonBlockAnnualPriceCents: 0,
        includedWhatsAppConnections: 1,
      });

      // Lite+
      expect(PLANS_CATALOG.lite_plus).toEqual({
        id: 'lite_plus',
        name: 'Lite+',
        baseMembers: 30,
        baseSongs: 150,
        allowMemberAddons: false,
        maxMemberAddonBlocks: 0,
        monthlyPriceCents: 2490,
        annualPriceCents: 26892,
        addonBlockMonthlyPriceCents: 0,
        addonBlockAnnualPriceCents: 0,
        includedWhatsAppConnections: 1,
      });

      // Essential
      expect(PLANS_CATALOG.essential).toEqual({
        id: 'essential',
        name: 'Essential',
        baseMembers: 40,
        baseSongs: 200,
        allowMemberAddons: true,
        maxMemberAddonBlocks: 4,
        monthlyPriceCents: 3490,
        annualPriceCents: 37692,
        addonBlockMonthlyPriceCents: 990,
        addonBlockAnnualPriceCents: 10692,
        includedWhatsAppConnections: 1,
      });

      // Pro
      expect(PLANS_CATALOG.pro).toEqual({
        id: 'pro',
        name: 'Pro',
        baseMembers: 100,
        baseSongs: 500,
        allowMemberAddons: true,
        maxMemberAddonBlocks: 10,
        monthlyPriceCents: 8990,
        annualPriceCents: 97092,
        addonBlockMonthlyPriceCents: 690,
        addonBlockAnnualPriceCents: 7452,
        includedWhatsAppConnections: 1,
      });

      // Premium
      expect(PLANS_CATALOG.premium).toEqual({
        id: 'premium',
        name: 'Premium',
        baseMembers: 300,
        baseSongs: 1500,
        allowMemberAddons: false,
        maxMemberAddonBlocks: 0,
        monthlyPriceCents: 21490,
        annualPriceCents: 232092,
        addonBlockMonthlyPriceCents: 0,
        addonBlockAnnualPriceCents: 0,
        includedWhatsAppConnections: 1,
      });
    });

    it('deve retornar plano Free padrão quando solicitado um planId desconhecido', () => {
      const plan = getPlanDefinition('invalido_qualquer');
      expect(plan.id).toBe('free');
      expect(plan.name).toBe('Free');
    });
  });

  // --------------------------------------------------------------------------
  // 2. Cálculo de Quotas Efetivas e Add-ons
  // --------------------------------------------------------------------------
  describe('2. Cálculo de Quotas Efetivas e Add-ons', () => {
    it('deve calcular quotas de membros para planos sem add-on ignorando blocos extras', () => {
      expect(getEffectiveMemberQuota(PLANS_CATALOG.free, 5)).toBe(10);
      expect(getEffectiveMemberQuota(PLANS_CATALOG.lite, 3)).toBe(20);
      expect(getEffectiveMemberQuota(PLANS_CATALOG.lite_plus, 2)).toBe(30);
    });

    it('deve calcular quotas de membros no plano Essential com blocos de +10 respeitando o teto de 4 blocos', () => {
      expect(getEffectiveMemberQuota(PLANS_CATALOG.essential, 0)).toBe(40);
      expect(getEffectiveMemberQuota(PLANS_CATALOG.essential, 1)).toBe(50);
      expect(getEffectiveMemberQuota(PLANS_CATALOG.essential, 2)).toBe(60);
      expect(getEffectiveMemberQuota(PLANS_CATALOG.essential, 4)).toBe(80); // Teto
      expect(getEffectiveMemberQuota(PLANS_CATALOG.essential, 10)).toBe(80); // Limitado pelo maxMemberAddonBlocks
    });

    it('deve calcular quotas de membros no plano Pro com blocos de +10 respeitando o teto de 10 blocos', () => {
      expect(getEffectiveMemberQuota(PLANS_CATALOG.pro, 0)).toBe(100);
      expect(getEffectiveMemberQuota(PLANS_CATALOG.pro, 5)).toBe(150);
      expect(getEffectiveMemberQuota(PLANS_CATALOG.pro, 10)).toBe(200); // Teto
      expect(getEffectiveMemberQuota(PLANS_CATALOG.pro, 25)).toBe(200); // Limitado pelo maxMemberAddonBlocks
    });

    it('deve retornar quotas de 300 membros e 1.500 músicas para o plano Premium', () => {
      expect(getEffectiveMemberQuota(PLANS_CATALOG.premium, 0)).toBe(300);
      expect(getEffectiveSongQuota(PLANS_CATALOG.premium)).toBe(1500);
    });

    it('deve validar limites de músicas conforme o catálogo', () => {
      expect(getEffectiveSongQuota(PLANS_CATALOG.free)).toBe(50);
      expect(getEffectiveSongQuota(PLANS_CATALOG.lite)).toBe(100);
      expect(getEffectiveSongQuota(PLANS_CATALOG.lite_plus)).toBe(150);
      expect(getEffectiveSongQuota(PLANS_CATALOG.essential)).toBe(200);
      expect(getEffectiveSongQuota(PLANS_CATALOG.pro)).toBe(500);
      expect(getEffectiveSongQuota(PLANS_CATALOG.premium)).toBe(1500);
    });
  });


  // --------------------------------------------------------------------------
  // 3. Resolução Funcional de AccessMode e State Machine
  // --------------------------------------------------------------------------
  describe('3. Resolução Dinâmica de AccessMode', () => {
    const baseSub: MinistrySubscriptionRecord = {
      id: 'min-1',
      ministry_id: 'min-1',
      plan_id: 'free',
      member_addon_blocks: 0,
      billing_status: 'active',
      administratively_suspended: false,
      suspended_at: null,
      suspension_reason: null,
      grace_period_expires_at: null,
      current_period_start: '2026-08-28T00:00:00.000Z',
      current_period_end: null,
      cancel_at_period_end: false,
      created_at: '2026-08-28T00:00:00.000Z',
      updated_at: '2026-08-28T00:00:00.000Z',
    };

    it('deve resolver como "normal" quando usage está estritamente dentro da quota', () => {
      const usage: MinistryUsageRecord = {
        id: 'min-1',
        ministry_id: 'min-1',
        members_count: 8,
        songs_count: 35,
        created_at: '2026-08-28T00:00:00.000Z',
        updated_at: '2026-08-28T00:00:00.000Z',
      };

      const result = resolveAccessMode(baseSub, PLANS_CATALOG.free, usage);
      expect(result.accessMode).toBe('normal');
      expect(result.isOverLimit).toBe(false);
      expect(result.graceDaysRemaining).toBeNull();
    });

    it('deve resolver como "suspended" com prioridade máxima se administratively_suspended for true', () => {
      const suspendedSub = { ...baseSub, administratively_suspended: true };
      const usage = { id: 'min-1', ministry_id: 'min-1', members_count: 5, songs_count: 10, created_at: '', updated_at: '' };

      const result = resolveAccessMode(suspendedSub, PLANS_CATALOG.free, usage);
      expect(result.accessMode).toBe('suspended');
      expect(result.isOverLimit).toBe(false);
    });

    it('deve resolver como "grace" com contagem regressiva de dias quando carência está ativa', () => {
      const now = new Date('2026-08-28T12:00:00.000Z');
      const graceExpiresAt = new Date('2026-09-02T12:00:00.000Z').toISOString(); // 5 dias no futuro

      const subWithGrace = { ...baseSub, grace_period_expires_at: graceExpiresAt };
      const overUsage = { id: 'min-1', ministry_id: 'min-1', members_count: 25, songs_count: 30, created_at: '', updated_at: '' };

      const result = resolveAccessMode(subWithGrace, PLANS_CATALOG.free, overUsage, now);
      expect(result.accessMode).toBe('grace');
      expect(result.isOverLimit).toBe(true);
      expect(result.graceDaysRemaining).toBe(5);
    });

    it('deve resolver como "restricted_over_limit" quando a data de carência expirar', () => {
      const now = new Date('2026-08-28T12:00:00.000Z');
      const expiredGrace = new Date('2026-08-27T12:00:00.000Z').toISOString(); // Expirou ontem

      const subExpired = { ...baseSub, grace_period_expires_at: expiredGrace };
      const overUsage = { id: 'min-1', ministry_id: 'min-1', members_count: 25, songs_count: 30, created_at: '', updated_at: '' };

      const result = resolveAccessMode(subExpired, PLANS_CATALOG.free, overUsage, now);
      expect(result.accessMode).toBe('restricted_over_limit');
      expect(result.isOverLimit).toBe(true);
      expect(result.graceDaysRemaining).toBe(0);
    });

    it('deve resolver como "restricted_over_limit" (fail-safe) se estiver em excesso sem registro de carência (prevenção de grace infinito)', () => {
      const now = new Date('2026-08-28T12:00:00.000Z');
      const subNoGrace = { ...baseSub, grace_period_expires_at: null };
      const overUsage = { id: 'min-1', ministry_id: 'min-1', members_count: 15, songs_count: 30, created_at: '', updated_at: '' };

      const result = resolveAccessMode(subNoGrace, PLANS_CATALOG.free, overUsage, now);
      expect(result.accessMode).toBe('restricted_over_limit');
      expect(result.isOverLimit).toBe(true);
      expect(result.graceDaysRemaining).toBe(0);
    });

    it('deve recuperar imediatamente para "normal" assim que o uso diminui abaixo da quota', () => {
      const expiredGrace = new Date('2026-08-27T12:00:00.000Z').toISOString();
      const subExpired = { ...baseSub, grace_period_expires_at: expiredGrace };

      // Reduziu de 25 para 9 membros (quota Free é 10)
      const regularizedUsage = { id: 'min-1', ministry_id: 'min-1', members_count: 9, songs_count: 30, created_at: '', updated_at: '' };

      const result = resolveAccessMode(subExpired, PLANS_CATALOG.free, regularizedUsage);
      expect(result.accessMode).toBe('normal');
      expect(result.isOverLimit).toBe(false);
      expect(result.graceDaysRemaining).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // 4. SubscriptionService: Transições de Plano e Downgrades
  // --------------------------------------------------------------------------
  describe('4. SubscriptionService: Transições e Downgrades', () => {
    let mockRepo: any;
    let service: SubscriptionService;

    beforeEach(() => {
      mockRepo = {
        getSubscription: vi.fn(),
        setSubscription: vi.fn(),
        getUsage: vi.fn(),
        setUsage: vi.fn(),
        countRealData: vi.fn(),
        ensureSubscriptionAndUsage: vi.fn(),
        reconcileMinistryUsage: vi.fn(),
      };
      service = new SubscriptionService(mockRepo as unknown as SubscriptionRepository);
    });

    it('deve realizar downgrade de Pro (85 membros) para Free, registrando carência de 7 dias sem apagar dados', async () => {
      const existingSub: MinistrySubscriptionRecord = {
        id: 'min-pro',
        ministry_id: 'min-pro',
        plan_id: 'pro',
        member_addon_blocks: 0,
        billing_status: 'active',
        administratively_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        grace_period_expires_at: null,
        current_period_start: '2026-08-28T00:00:00.000Z',
        current_period_end: null,
        cancel_at_period_end: false,
        created_at: '2026-08-28T00:00:00.000Z',
        updated_at: '2026-08-28T00:00:00.000Z',
      };

      const existingUsage: MinistryUsageRecord = {
        id: 'min-pro',
        ministry_id: 'min-pro',
        members_count: 85,
        songs_count: 120,
        created_at: '2026-08-28T00:00:00.000Z',
        updated_at: '2026-08-28T00:00:00.000Z',
      };

      mockRepo.ensureSubscriptionAndUsage.mockResolvedValue({
        subscription: existingSub,
        usage: existingUsage,
      });

      const updated = await service.changePlan('min-pro', 'free');

      expect(updated.plan_id).toBe('free');
      expect(updated.grace_period_expires_at).not.toBeNull();

      const graceDate = new Date(updated.grace_period_expires_at!);
      const now = new Date();
      const diffDays = (graceDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      expect(Math.round(diffDays)).toBe(DEFAULT_GRACE_PERIOD_DAYS);

      expect(mockRepo.setSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          plan_id: 'free',
          grace_period_expires_at: expect.any(String),
        })
      );
    });

    it('deve limpar a data de carência ao realizar upgrade para plano que comporta o uso atual', async () => {
      const graceSub: MinistrySubscriptionRecord = {
        id: 'min-1',
        ministry_id: 'min-1',
        plan_id: 'free',
        member_addon_blocks: 0,
        billing_status: 'active',
        administratively_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        grace_period_expires_at: '2026-09-04T00:00:00.000Z',
        current_period_start: '2026-08-28T00:00:00.000Z',
        current_period_end: null,
        cancel_at_period_end: false,
        created_at: '2026-08-28T00:00:00.000Z',
        updated_at: '2026-08-28T00:00:00.000Z',
      };

      const usage: MinistryUsageRecord = {
        id: 'min-1',
        ministry_id: 'min-1',
        members_count: 35, // Cabe no Essential (40)
        songs_count: 80,   // Cabe no Essential (200)
        created_at: '2026-08-28T00:00:00.000Z',
        updated_at: '2026-08-28T00:00:00.000Z',
      };

      mockRepo.ensureSubscriptionAndUsage.mockResolvedValue({
        subscription: graceSub,
        usage,
      });

      const updated = await service.changePlan('min-1', 'essential');

      expect(updated.plan_id).toBe('essential');
      expect(updated.grace_period_expires_at).toBeNull(); // Carência limpa
    });

    it('deve rejeitar alteração de add-on de membros para planos que não suportam add-on', async () => {
      const freeSub: MinistrySubscriptionRecord = {
        id: 'min-free',
        ministry_id: 'min-free',
        plan_id: 'free',
        member_addon_blocks: 0,
        billing_status: 'active',
        administratively_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        grace_period_expires_at: null,
        current_period_start: '2026-08-28T00:00:00.000Z',
        current_period_end: null,
        cancel_at_period_end: false,
        created_at: '2026-08-28T00:00:00.000Z',
        updated_at: '2026-08-28T00:00:00.000Z',
      };

      mockRepo.ensureSubscriptionAndUsage.mockResolvedValue({
        subscription: freeSub,
        usage: { id: 'min-free', ministry_id: 'min-free', members_count: 5, songs_count: 10, created_at: '', updated_at: '' },
      });

      await expect(service.changeMemberAddonBlocks('min-free', 1)).rejects.toThrow(
        /não suporta add-ons/i
      );
    });

    it('deve rejeitar blocos de add-on acima do teto permitido pelo plano Essential (max 4)', async () => {
      const essentialSub: MinistrySubscriptionRecord = {
        id: 'min-ess',
        ministry_id: 'min-ess',
        plan_id: 'essential',
        member_addon_blocks: 0,
        billing_status: 'active',
        administratively_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        grace_period_expires_at: null,
        current_period_start: '2026-08-28T00:00:00.000Z',
        current_period_end: null,
        cancel_at_period_end: false,
        created_at: '2026-08-28T00:00:00.000Z',
        updated_at: '2026-08-28T00:00:00.000Z',
      };

      mockRepo.ensureSubscriptionAndUsage.mockResolvedValue({
        subscription: essentialSub,
        usage: { id: 'min-ess', ministry_id: 'min-ess', members_count: 20, songs_count: 50, created_at: '', updated_at: '' },
      });

      await expect(service.changeMemberAddonBlocks('min-ess', 5)).rejects.toThrow(
        /permite no máximo 4 blocos/i
      );
    });
  });

  // --------------------------------------------------------------------------
  // 5. Suporte e Compatibilidade com Ministérios Legados
  // --------------------------------------------------------------------------
  describe('5. Suporte a Ministérios Legados e Pureza em GET', () => {
    let mockRepo: any;
    let service: SubscriptionService;

    beforeEach(() => {
      mockRepo = {
        getSubscription: vi.fn(),
        setSubscription: vi.fn(),
        getUsage: vi.fn(),
        setUsage: vi.fn(),
        countRealData: vi.fn(),
        ensureSubscriptionAndUsage: vi.fn(),
        reconcileMinistryUsage: vi.fn(),
      };
      service = new SubscriptionService(mockRepo as unknown as SubscriptionRepository);
    });

    it('deve ler resumo de ministério legado sem registros persistidos usando fallback seguro sem side-effects no banco', async () => {
      mockRepo.getSubscription.mockResolvedValue(null);
      mockRepo.getUsage.mockResolvedValue(null);
      mockRepo.countRealData.mockResolvedValue({ realMembersCount: 6, realSongsCount: 22 });

      const summary = await service.getSubscriptionSummary('legacy-min');

      expect(summary.plan.id).toBe('free');
      expect(summary.subscription.planId).toBe('free');
      expect(summary.usage.membersCount).toBe(6);
      expect(summary.usage.songsCount).toBe(22);
      expect(summary.subscription.accessMode).toBe('normal');
      expect(summary.isOverLimit).toBe(false);

      // Leitura pura: NENHUMA escrita no repositório
      expect(mockRepo.setSubscription).not.toHaveBeenCalled();
      expect(mockRepo.setUsage).not.toHaveBeenCalled();
    });

    it('deve identificar ministério legado com 85 membros como restricted_over_limit sem conceder carência indevida', async () => {
      mockRepo.getSubscription.mockResolvedValue(null);
      mockRepo.getUsage.mockResolvedValue(null);
      mockRepo.countRealData.mockResolvedValue({ realMembersCount: 85, realSongsCount: 40 });

      const summary = await service.getSubscriptionSummary('legacy-over-limit');

      expect(summary.plan.id).toBe('free');
      expect(summary.usage.membersCount).toBe(85);
      expect(summary.quotas.members).toBe(10);
      expect(summary.isOverLimit).toBe(true);
      expect(summary.overLimitDetails.membersOver).toBe(true);
      expect(summary.subscription.accessMode).toBe('restricted_over_limit'); // Fail-safe correto
      expect(summary.graceDaysRemaining).toBe(0);
    });

    it('deve reconciliar e corrigir eventuais divergências no usage materializado', async () => {
      mockRepo.reconcileMinistryUsage.mockResolvedValue({
        id: 'min-1',
        ministry_id: 'min-1',
        members_count: 12,
        songs_count: 45,
        created_at: '2026-08-28T00:00:00.000Z',
        updated_at: '2026-08-28T00:00:00.000Z',
      });

      const reconciled = await service.reconcileUsage('min-1');
      expect(reconciled.members_count).toBe(12);
      expect(reconciled.songs_count).toBe(45);
      expect(mockRepo.reconcileMinistryUsage).toHaveBeenCalledWith('min-1');
    });
  });

  // --------------------------------------------------------------------------
  // 6. Cenários Específicos de Auditoria
  // --------------------------------------------------------------------------
  describe('6. Cenários Específicos de Auditoria de Transições e Quotas', () => {
    it('deve suportar Essential com redução de blocos adicionais gerando carência quando o uso excede a nova capacidade', () => {
      const essentialSub: MinistrySubscriptionRecord = {
        id: 'min-ess',
        ministry_id: 'min-ess',
        plan_id: 'essential',
        member_addon_blocks: 1, // Reduziu de 2 para 1 (capacidade 50)
        billing_status: 'active',
        administratively_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        grace_period_expires_at: new Date('2026-09-04T12:00:00.000Z').toISOString(),
        current_period_start: '2026-08-28T00:00:00.000Z',
        current_period_end: null,
        cancel_at_period_end: false,
        created_at: '2026-08-28T00:00:00.000Z',
        updated_at: '2026-08-28T00:00:00.000Z',
      };

      const usage: MinistryUsageRecord = {
        id: 'min-ess',
        ministry_id: 'min-ess',
        members_count: 57, // Excede 50
        songs_count: 100,
        created_at: '2026-08-28T00:00:00.000Z',
        updated_at: '2026-08-28T00:00:00.000Z',
      };

      // 1. Durante a carência
      const now = new Date('2026-08-28T12:00:00.000Z');
      const graceResult = resolveAccessMode(essentialSub, PLANS_CATALOG.essential, usage, now);
      expect(graceResult.accessMode).toBe('grace');
      expect(graceResult.isOverLimit).toBe(true);

      // 2. Após expiração da carência (determinação dinâmica sem necessidade de job/worker)
      const afterExpiry = new Date('2026-09-05T12:00:00.000Z');
      const restrictedResult = resolveAccessMode(essentialSub, PLANS_CATALOG.essential, usage, afterExpiry);
      expect(restrictedResult.accessMode).toBe('restricted_over_limit');
      expect(restrictedResult.isOverLimit).toBe(true);
    });

    it('deve regularizar imediatamente para "normal" quando uso de 57 membros migra para Essential com 2 blocos (capacidade 60)', () => {
      const regularizedSub: MinistrySubscriptionRecord = {
        id: 'min-upgraded',
        ministry_id: 'min-upgraded',
        plan_id: 'essential',
        member_addon_blocks: 2, // 40 base + 20 add-ons = 60
        billing_status: 'active',
        administratively_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        grace_period_expires_at: null,
        current_period_start: '2026-08-28T00:00:00.000Z',
        current_period_end: null,
        cancel_at_period_end: false,
        created_at: '2026-08-28T00:00:00.000Z',
        updated_at: '2026-08-28T00:00:00.000Z',
      };

      const usage: MinistryUsageRecord = {
        id: 'min-upgraded',
        ministry_id: 'min-upgraded',
        members_count: 57, // Menor que 60
        songs_count: 180,
        created_at: '2026-08-28T00:00:00.000Z',
        updated_at: '2026-08-28T00:00:00.000Z',
      };

      const result = resolveAccessMode(regularizedSub, PLANS_CATALOG.essential, usage);
      expect(result.accessMode).toBe('normal');
      expect(result.isOverLimit).toBe(false);
      expect(result.overLimitDetails.membersOver).toBe(false);
      expect(result.overLimitDetails.songsOver).toBe(false);
    });

    it('deve validar plano Premium com volumes até 300 membros e 1.500 músicas em normal e acusar over-limit acima', () => {
      const premiumSub: MinistrySubscriptionRecord = {
        id: 'min-prem',
        ministry_id: 'min-prem',
        plan_id: 'premium',
        member_addon_blocks: 0,
        billing_status: 'active',
        administratively_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        grace_period_expires_at: null,
        current_period_start: '2026-08-28T00:00:00.000Z',
        current_period_end: null,
        cancel_at_period_end: false,
        created_at: '2026-08-28T00:00:00.000Z',
        updated_at: '2026-08-28T00:00:00.000Z',
      };

      const withinLimitUsage: MinistryUsageRecord = {
        id: 'min-prem',
        ministry_id: 'min-prem',
        members_count: 280,
        songs_count: 1400,
        created_at: '2026-08-28T00:00:00.000Z',
        updated_at: '2026-08-28T00:00:00.000Z',
      };

      const result = resolveAccessMode(premiumSub, PLANS_CATALOG.premium, withinLimitUsage);
      expect(result.accessMode).toBe('normal');
      expect(result.isOverLimit).toBe(false);
      expect(getEffectiveMemberQuota(PLANS_CATALOG.premium, 0)).toBe(300);
      expect(getEffectiveSongQuota(PLANS_CATALOG.premium)).toBe(1500);

      const overLimitUsage: MinistryUsageRecord = {
        ...withinLimitUsage,
        members_count: 320,
      };
      const overResult = resolveAccessMode(premiumSub, PLANS_CATALOG.premium, overLimitUsage);
      expect(overResult.isOverLimit).toBe(true);
      expect(overResult.accessMode).toBe('restricted_over_limit');
    });

    it('Cenário L: cancel_at_period_end no futuro mantém plano pago; após vencer transiciona para Free', async () => {
      const mockRepo = {
        getSubscription: vi.fn(),
        getUsage: vi.fn().mockResolvedValue({
          id: 'min-cancel',
          ministry_id: 'min-cancel',
          members_count: 8,
          songs_count: 30,
        }),
      };
      const service = new SubscriptionService(mockRepo as any);

      // 1. Período ainda válido no futuro: continua Pro
      mockRepo.getSubscription.mockResolvedValue({
        id: 'min-cancel',
        ministry_id: 'min-cancel',
        plan_id: 'pro',
        member_addon_blocks: 0,
        billing_status: 'active',
        subscription_mode: 'paid',
        cancel_at_period_end: true,
        current_period_start: '2026-08-01T00:00:00.000Z',
        current_period_end: new Date(Date.now() + 86400000).toISOString(), // amanhã
      });

      const summaryFuture = await service.getSubscriptionSummary('min-cancel');
      expect(summaryFuture.plan.id).toBe('pro');
      expect(summaryFuture.subscription.subscriptionMode).toBe('paid');
      expect(summaryFuture.subscription.cancelAtPeriodEnd).toBe(true);
      expect(summaryFuture.quotas.members).toBe(100);

      // 2. Período vencido no passado: transiciona para Free
      mockRepo.getSubscription.mockResolvedValue({
        id: 'min-cancel',
        ministry_id: 'min-cancel',
        plan_id: 'pro',
        member_addon_blocks: 0,
        billing_status: 'active',
        subscription_mode: 'paid',
        cancel_at_period_end: true,
        current_period_start: '2026-07-01T00:00:00.000Z',
        current_period_end: '2026-08-01T00:00:00.000Z', // passado
      });

      const summaryPast = await service.getSubscriptionSummary('min-cancel');
      expect(summaryPast.plan.id).toBe('free');
      expect(summaryPast.subscription.subscriptionMode).toBe('free');
      expect(summaryPast.quotas.members).toBe(10);
      expect(summaryPast.quotas.songs).toBe(50);
    });

    it('Cenário V1 (Phase 3D.3 Hardening): cancel_at_period_end no passado com active_cancellation_transition_id NÃO transiciona para Free (mantém plano e cotas pagas)', async () => {
      const mockRepo = {
        getSubscription: vi.fn(),
        getUsage: vi.fn().mockResolvedValue({
          id: 'min-v1-cancel',
          ministry_id: 'min-v1-cancel',
          members_count: 15,
          songs_count: 60,
        }),
      };
      const service = new SubscriptionService(mockRepo as any);

      // Período vencido no passado, mas gerenciado por transição V1:
      mockRepo.getSubscription.mockResolvedValue({
        id: 'min-v1-cancel',
        ministry_id: 'min-v1-cancel',
        plan_id: 'pro',
        member_addon_blocks: 0,
        billing_status: 'active',
        subscription_mode: 'paid',
        cancel_at_period_end: true,
        active_cancellation_transition_id: 'tr_v1_cancel_active_123',
        current_period_start: '2026-07-01T00:00:00.000Z',
        current_period_end: '2026-08-01T00:00:00.000Z', // passado
      });

      const summary = await service.getSubscriptionSummary('min-v1-cancel');
      // Entitlement permanece PRO pago, NÃO faz auto-cutover para Free
      expect(summary.plan.id).toBe('pro');
      expect(summary.subscription.subscriptionMode).toBe('paid');
      expect(summary.subscription.cancelAtPeriodEnd).toBe(true);
      expect(summary.subscription.activeCancellationTransitionId).toBe('tr_v1_cancel_active_123');
      expect(summary.quotas.members).toBe(100);
      expect(summary.quotas.songs).toBe(500);
      expect(summary.isOverLimit).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Phase 4A.1: Customer Billing Summary Normalization
  // --------------------------------------------------------------------------
  describe('7. Phase 4A.1: Customer Billing Summary Normalization', () => {
    it('deve retornar pendingTransition = null e paymentStatus.state = "current" quando não há transição ativa', async () => {
      const mockSubRepo = {
        getSubscription: vi.fn().mockResolvedValue({
          id: 'min-1',
          ministry_id: 'min-1',
          plan_id: 'essential',
          member_addon_blocks: 0,
          billing_status: 'active',
          subscription_mode: 'paid',
          cancel_at_period_end: false,
          current_period_start: '2026-09-01T00:00:00.000Z',
          current_period_end: '2026-10-01T00:00:00.000Z',
        }),
        getUsage: vi.fn().mockResolvedValue({
          id: 'min-1',
          ministry_id: 'min-1',
          members_count: 5,
          songs_count: 20,
        }),
      };
      const mockBillingRepo = {
        getActiveTransitionForMinistry: vi.fn().mockResolvedValue(null),
        getSubscription: vi.fn().mockResolvedValue({
          id: 'min-1_asaas',
          ministry_id: 'min-1',
          provider: 'asaas',
          status: 'active',
        }),
      };

      const service = new SubscriptionService(mockSubRepo as any, mockBillingRepo as any);
      const summary = await service.getSubscriptionSummary('min-1');

      expect(summary.pendingTransition).toBeNull();
      expect(summary.paymentStatus).toEqual({
        state: 'current',
        graceEndsAt: null,
        canRecoverPayment: false,
        recoveryInvoiceUrl: null,
      });
      expect(summary.graceReason).toBe('none');
    });

    it('deve projetar pendingTransition quando existe slot ativo com transição V1 agendada', async () => {
      const mockSubRepo = {
        getSubscription: vi.fn().mockResolvedValue({
          id: 'min-2',
          ministry_id: 'min-2',
          plan_id: 'lite',
          member_addon_blocks: 0,
          billing_status: 'active',
          subscription_mode: 'paid',
          cancel_at_period_end: false,
          current_period_start: '2026-09-01T00:00:00.000Z',
          current_period_end: '2026-10-01T00:00:00.000Z',
        }),
        getUsage: vi.fn().mockResolvedValue({
          id: 'min-2',
          ministry_id: 'min-2',
          members_count: 10,
          songs_count: 40,
        }),
      };
      const mockBillingRepo = {
        getActiveTransitionForMinistry: vi.fn().mockResolvedValue({
          slot: {
            id: 'slot_min-2__asaas',
            ministry_id: 'min-2',
            provider: 'asaas',
            plan_change_id: 'tr_plan_up_456',
          },
          transition: {
            id: 'tr_plan_up_456',
            transition_id: 'tr_plan_up_456',
            policy_version: 'billing_transition_v1',
            ministry_id: 'min-2',
            provider: 'asaas',
            execution_strategy: 'scheduled_paid_transition',
            transition_status: 'scheduled',
            financial_safety_status: 'live',
            source_plan_id: 'lite',
            source_interval: 'monthly',
            source_addon_blocks: 0,
            target_plan_id: 'essential',
            target_interval: 'monthly',
            target_addon_blocks: 0,
            requested_at: '2026-09-07T12:00:00.000Z',
            effective_at: '2026-10-01T00:00:00.000Z',
          },
        }),
        getSubscription: vi.fn().mockResolvedValue({
          id: 'min-2_asaas',
          ministry_id: 'min-2',
          provider: 'asaas',
          status: 'active',
        }),
      };

      const service = new SubscriptionService(mockSubRepo as any, mockBillingRepo as any);
      const summary = await service.getSubscriptionSummary('min-2');

      expect(summary.pendingTransition).not.toBeNull();
      expect(summary.pendingTransition?.transitionId).toBe('tr_plan_up_456');
      expect(summary.pendingTransition?.kind).toBe('plan_upgrade');
      expect(summary.pendingTransition?.status).toBe('scheduled');
      expect(summary.pendingTransition?.effectiveAt).toBe('2026-10-01T00:00:00.000Z');
      expect(summary.pendingTransition?.source.planId).toBe('lite');
      expect(summary.pendingTransition?.target.planId).toBe('essential');
    });

    it('deve projetar past_due e graceReason = "payment_failure" quando a assinatura estiver inadimplente em carência', async () => {
      const graceEnd = new Date(Date.now() + 7 * 86400000).toISOString();
      const mockSubRepo = {
        getSubscription: vi.fn().mockResolvedValue({
          id: 'min-delinquent',
          ministry_id: 'min-delinquent',
          plan_id: 'essential',
          member_addon_blocks: 0,
          billing_status: 'past_due',
          subscription_mode: 'paid',
          cancel_at_period_end: false,
          grace_period_expires_at: graceEnd,
          current_period_start: '2026-08-01T00:00:00.000Z',
          current_period_end: '2026-09-01T00:00:00.000Z',
        }),
        getUsage: vi.fn().mockResolvedValue({
          id: 'min-delinquent',
          ministry_id: 'min-delinquent',
          members_count: 50, // > 40 cotas do Essential -> triggers isOverLimit
          songs_count: 50,
        }),
      };
      const mockBillingRepo = {
        getActiveTransitionForMinistry: vi.fn().mockResolvedValue(null),
        getSubscription: vi.fn().mockResolvedValue({
          id: 'min-delinquent_asaas',
          ministry_id: 'min-delinquent',
          provider: 'asaas',
          status: 'past_due',
        }),
      };

      const service = new SubscriptionService(mockSubRepo as any, mockBillingRepo as any);
      const summary = await service.getSubscriptionSummary('min-delinquent');

      expect(summary.paymentStatus).toEqual({
        state: 'past_due',
        graceEndsAt: graceEnd,
        canRecoverPayment: true,
        recoveryInvoiceUrl: null,
      });
      expect(summary.subscription.accessMode).toBe('grace');
      expect(summary.graceReason).toBe('payment_failure');
    });

    it('deve garantir isolamento de tenant: não expõe transição ativa de outro ministério', async () => {
      const mockSubRepo = {
        getSubscription: vi.fn().mockResolvedValue({
          id: 'min-tenant-A',
          ministry_id: 'min-tenant-A',
          plan_id: 'lite',
          member_addon_blocks: 0,
          billing_status: 'active',
          subscription_mode: 'paid',
          cancel_at_period_end: false,
          current_period_start: '2026-09-01T00:00:00.000Z',
          current_period_end: '2026-10-01T00:00:00.000Z',
        }),
        getUsage: vi.fn().mockResolvedValue({
          id: 'min-tenant-A',
          ministry_id: 'min-tenant-A',
          members_count: 5,
          songs_count: 20,
        }),
      };
      // Retorna acidentalmente transição do Tenant B
      const mockBillingRepo = {
        getActiveTransitionForMinistry: vi.fn().mockResolvedValue({
          slot: {
            id: 'slot_min-tenant-A__asaas',
            ministry_id: 'min-tenant-A',
            provider: 'asaas',
            plan_change_id: 'tr_tenant_B',
          },
          transition: {
            id: 'tr_tenant_B',
            transition_id: 'tr_tenant_B',
            policy_version: 'billing_transition_v1',
            ministry_id: 'min-tenant-B', // DIVERGENTE
            provider: 'asaas',
            execution_strategy: 'scheduled_paid_transition',
            transition_status: 'scheduled',
            financial_safety_status: 'live',
            source_plan_id: 'pro',
            source_interval: 'monthly',
            source_addon_blocks: 0,
            target_plan_id: 'premium',
            target_interval: 'monthly',
            target_addon_blocks: 0,
          },
        }),
        getSubscription: vi.fn().mockResolvedValue(null),
      };

      const service = new SubscriptionService(mockSubRepo as any, mockBillingRepo as any);
      const summary = await service.getSubscriptionSummary('min-tenant-A');

      // Tenant isolation: transição do tenant B é descartada
      expect(summary.pendingTransition).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // 8. Phase 4A.6: Delinquency, Grace & Payment Recovery Normalization
  // --------------------------------------------------------------------------
  describe('8. Phase 4A.6: Delinquency, Grace & Payment Recovery Normalization', () => {
    it('deve expor canRecoverPayment = true e recoveryInvoiceUrl quando há cobrança em aberto com fatura', async () => {
      const graceEnd = new Date(Date.now() + 5 * 86400000).toISOString();
      const mockSubRepo = {
        getSubscription: vi.fn().mockResolvedValue({
          id: 'min-recovery-1',
          ministry_id: 'min-recovery-1',
          plan_id: 'essential',
          member_addon_blocks: 0,
          billing_status: 'past_due',
          subscription_mode: 'paid',
          cancel_at_period_end: false,
          grace_period_expires_at: graceEnd,
          current_period_start: '2026-08-01T00:00:00.000Z',
          current_period_end: '2026-09-01T00:00:00.000Z',
        }),
        getUsage: vi.fn().mockResolvedValue({
          id: 'min-recovery-1',
          ministry_id: 'min-recovery-1',
          members_count: 20,
          songs_count: 50,
        }),
      };
      const mockBillingRepo = {
        getActiveTransitionForMinistry: vi.fn().mockResolvedValue(null),
        getSubscription: vi.fn().mockResolvedValue({
          id: 'min-recovery-1_asaas',
          ministry_id: 'min-recovery-1',
          provider: 'asaas',
          provider_subscription_id: 'sub_rec_123',
          current_period_end_billing_date: '2026-09-01',
          status: 'past_due',
        }),
        getTransactions: vi.fn().mockResolvedValue([
          {
            id: 'asaas_pay_overdue_123',
            ministry_id: 'min-recovery-1',
            provider: 'asaas',
            provider_subscription_id: 'sub_rec_123',
            transaction_type: 'recurring_payment',
            due_date: '2026-09-01',
            status: 'overdue',
            amount_cents: 3490,
            invoice_url: 'https://sandbox.asaas.com/i/rec_invoice_123',
          },
        ]),
      };

      const service = new SubscriptionService(mockSubRepo as any, mockBillingRepo as any);
      const summary = await service.getSubscriptionSummary('min-recovery-1');

      expect(summary.paymentStatus.state).toBe('past_due');
      expect(summary.paymentStatus.graceEndsAt).toBe(graceEnd);
      expect(summary.paymentStatus.canRecoverPayment).toBe(true);
      expect(summary.paymentStatus.recoveryInvoiceUrl).toBe('https://sandbox.asaas.com/i/rec_invoice_123');
      expect(summary.subscription.billingStatus).toBe('past_due');
    });

    it('deve desabilitar canRecoverPayment quando transição ativa possui financial_attention_required', async () => {
      const graceEnd = new Date(Date.now() + 3 * 86400000).toISOString();
      const mockSubRepo = {
        getSubscription: vi.fn().mockResolvedValue({
          id: 'min-recovery-attention',
          ministry_id: 'min-recovery-attention',
          plan_id: 'essential',
          member_addon_blocks: 0,
          billing_status: 'past_due',
          subscription_mode: 'paid',
          cancel_at_period_end: false,
          grace_period_expires_at: graceEnd,
          current_period_start: '2026-08-01T00:00:00.000Z',
          current_period_end: '2026-09-01T00:00:00.000Z',
        }),
        getUsage: vi.fn().mockResolvedValue({
          id: 'min-recovery-attention',
          ministry_id: 'min-recovery-attention',
          members_count: 20,
          songs_count: 50,
        }),
      };
      const mockBillingRepo = {
        getActiveTransitionForMinistry: vi.fn().mockResolvedValue({
          slot: {
            id: 'slot_min-recovery-attention__asaas',
            ministry_id: 'min-recovery-attention',
            provider: 'asaas',
            plan_change_id: 'tr_attention_123',
          },
          transition: {
            id: 'tr_attention_123',
            transition_id: 'tr_attention_123',
            policy_version: 'billing_transition_v1',
            ministry_id: 'min-recovery-attention',
            provider: 'asaas',
            execution_strategy: 'scheduled_paid_transition',
            transition_status: 'scheduled',
            financial_safety_status: 'attention_required',
            financial_attention_required: true,
            source_plan_id: 'essential',
            source_interval: 'monthly',
            source_addon_blocks: 0,
            target_plan_id: 'pro',
            target_interval: 'monthly',
            target_addon_blocks: 0,
          },
        }),
        getSubscription: vi.fn().mockResolvedValue({
          id: 'min-recovery-attention_asaas',
          ministry_id: 'min-recovery-attention',
          provider: 'asaas',
          status: 'past_due',
        }),
        getTransactions: vi.fn().mockResolvedValue([
          {
            id: 'asaas_pay_overdue_456',
            ministry_id: 'min-recovery-attention',
            status: 'overdue',
            amount_cents: 3490,
            invoice_url: 'https://sandbox.asaas.com/i/rec_invoice_456',
          },
        ]),
      };

      const service = new SubscriptionService(mockSubRepo as any, mockBillingRepo as any);
      const summary = await service.getSubscriptionSummary('min-recovery-attention');

      expect(summary.paymentStatus.state).toBe('past_due');
      expect(summary.paymentStatus.canRecoverPayment).toBe(false);
      expect(summary.paymentStatus.recoveryInvoiceUrl).toBeNull();
    });

    it('deve manter canRecoverPayment = false para planos cortesia ou gratuitos mesmo que billingSub indique past_due', async () => {
      const mockSubRepo = {
        getSubscription: vi.fn().mockResolvedValue({
          id: 'min-complimentary-delinquent',
          ministry_id: 'min-complimentary-delinquent',
          plan_id: 'essential',
          member_addon_blocks: 0,
          billing_status: 'past_due',
          subscription_mode: 'complimentary',
          cancel_at_period_end: false,
          current_period_start: '2026-08-01T00:00:00.000Z',
          current_period_end: '2026-09-01T00:00:00.000Z',
        }),
        getUsage: vi.fn().mockResolvedValue({
          id: 'min-complimentary-delinquent',
          ministry_id: 'min-complimentary-delinquent',
          members_count: 10,
          songs_count: 20,
        }),
      };
      const mockBillingRepo = {
        getActiveTransitionForMinistry: vi.fn().mockResolvedValue(null),
        getSubscription: vi.fn().mockResolvedValue({
          id: 'min-complimentary-delinquent_asaas',
          ministry_id: 'min-complimentary-delinquent',
          provider: 'asaas',
          status: 'past_due',
        }),
      };

      const service = new SubscriptionService(mockSubRepo as any, mockBillingRepo as any);
      const summary = await service.getSubscriptionSummary('min-complimentary-delinquent');

      expect(summary.paymentStatus.state).toBe('current');
      expect(summary.paymentStatus.canRecoverPayment).toBe(false);
      expect(summary.paymentStatus.recoveryInvoiceUrl).toBeNull();
    });

    describe('Phase 4A.6A: Renewal Recovery Obligation Correlation Hardening', () => {
      it('Seção 12: deve priorizar a fatura da assinatura corrente e ignorar checkout de ativação antecipada pendente e renovação antiga', async () => {
        const mockSubRepo = {
          getSubscription: vi.fn().mockResolvedValue({
            id: 'min-corr-1',
            ministry_id: 'min-corr-1',
            plan_id: 'essential',
            member_addon_blocks: 0,
            billing_status: 'past_due',
            subscription_mode: 'paid',
            cancel_at_period_end: false,
            current_period_start: '2026-08-01T00:00:00.000Z',
            current_period_end: '2026-09-01T00:00:00.000Z',
          }),
          getUsage: vi.fn().mockResolvedValue({
            id: 'min-corr-1',
            ministry_id: 'min-corr-1',
            members_count: 20,
            songs_count: 50,
          }),
        };
        const mockBillingRepo = {
          getActiveTransitionForMinistry: vi.fn().mockResolvedValue(null),
          getSubscription: vi.fn().mockResolvedValue({
            id: 'min-corr-1_asaas',
            ministry_id: 'min-corr-1',
            provider: 'asaas',
            provider_subscription_id: 'sub_current_123',
            status: 'past_due',
            current_period_start_billing_date: '2026-08-01',
            current_period_end_billing_date: '2026-09-01',
          }),
          getTransactions: vi.fn().mockResolvedValue([
            // A) Tentativa recente de ajuste de ativação antecipada pendente
            {
              id: 'asaas_early_adj_999',
              ministry_id: 'min-corr-1',
              provider: 'asaas',
              provider_payment_id: 'pay_early_999',
              status: 'pending',
              transaction_type: 'prorated_early_activation_adjustment',
              amount_cents: 1250,
              invoice_url: 'https://sandbox.asaas.com/i/wrong_early_activation',
              created_at: '2026-09-05T12:00:00.000Z',
            },
            // B) Fatura de renovação legítima do ciclo corrente
            {
              id: 'asaas_renewal_current_456',
              ministry_id: 'min-corr-1',
              provider: 'asaas',
              provider_payment_id: 'pay_renewal_456',
              provider_subscription_id: 'sub_current_123',
              status: 'overdue',
              transaction_type: 'recurring_payment',
              due_date: '2026-09-01',
              amount_cents: 3490,
              invoice_url: 'https://sandbox.asaas.com/i/correct_renewal_invoice',
              created_at: '2026-09-01T00:00:00.000Z',
            },
            // C) Fatura vencida de ciclo antigo ou assinatura anterior
            {
              id: 'asaas_renewal_old_111',
              ministry_id: 'min-corr-1',
              provider: 'asaas',
              provider_payment_id: 'pay_renewal_111',
              provider_subscription_id: 'sub_old_prior',
              status: 'overdue',
              transaction_type: 'recurring_payment',
              due_date: '2026-07-01',
              amount_cents: 3490,
              invoice_url: 'https://sandbox.asaas.com/i/wrong_old_invoice',
              created_at: '2026-07-01T00:00:00.000Z',
            },
          ]),
        };

        const service = new SubscriptionService(mockSubRepo as any, mockBillingRepo as any);
        const summary = await service.getSubscriptionSummary('min-corr-1');

        expect(summary.paymentStatus.state).toBe('past_due');
        expect(summary.paymentStatus.canRecoverPayment).toBe(true);
        expect(summary.paymentStatus.recoveryInvoiceUrl).toBe('https://sandbox.asaas.com/i/correct_renewal_invoice');
      });

      it('Seção 13: deve ignorar faturas de outra assinatura do provedor (sub_old)', async () => {
        const mockSubRepo = {
          getSubscription: vi.fn().mockResolvedValue({
            id: 'min-corr-2',
            ministry_id: 'min-corr-2',
            plan_id: 'essential',
            billing_status: 'past_due',
            subscription_mode: 'paid',
            current_period_end: '2026-09-01T00:00:00.000Z',
          }),
          getUsage: vi.fn().mockResolvedValue({ members_count: 5, songs_count: 10 }),
        };
        const mockBillingRepo = {
          getActiveTransitionForMinistry: vi.fn().mockResolvedValue(null),
          getSubscription: vi.fn().mockResolvedValue({
            id: 'min-corr-2_asaas',
            ministry_id: 'min-corr-2',
            provider: 'asaas',
            provider_subscription_id: 'sub_current_active',
            status: 'past_due',
          }),
          getTransactions: vi.fn().mockResolvedValue([
            {
              id: 'tx_sub_old',
              ministry_id: 'min-corr-2',
              provider: 'asaas',
              provider_subscription_id: 'sub_old_cancelled',
              status: 'overdue',
              transaction_type: 'recurring_payment',
              due_date: '2026-09-01',
              invoice_url: 'https://sandbox.asaas.com/i/wrong_sub_old',
            },
            {
              id: 'tx_sub_current',
              ministry_id: 'min-corr-2',
              provider: 'asaas',
              provider_subscription_id: 'sub_current_active',
              status: 'overdue',
              transaction_type: 'recurring_payment',
              due_date: '2026-09-01',
              invoice_url: 'https://sandbox.asaas.com/i/correct_sub_current',
            },
          ]),
        };

        const service = new SubscriptionService(mockSubRepo as any, mockBillingRepo as any);
        const summary = await service.getSubscriptionSummary('min-corr-2');

        expect(summary.paymentStatus.recoveryInvoiceUrl).toBe('https://sandbox.asaas.com/i/correct_sub_current');
      });

      it('Seção 14: deve distinguir ciclo corrente de ciclo antigo da mesma assinatura via due_date', async () => {
        const mockSubRepo = {
          getSubscription: vi.fn().mockResolvedValue({
            id: 'min-corr-3',
            ministry_id: 'min-corr-3',
            plan_id: 'essential',
            billing_status: 'past_due',
            subscription_mode: 'paid',
            current_period_end: '2026-09-01T00:00:00.000Z',
          }),
          getUsage: vi.fn().mockResolvedValue({ members_count: 5, songs_count: 10 }),
        };
        const mockBillingRepo = {
          getActiveTransitionForMinistry: vi.fn().mockResolvedValue(null),
          getSubscription: vi.fn().mockResolvedValue({
            id: 'min-corr-3_asaas',
            ministry_id: 'min-corr-3',
            provider: 'asaas',
            provider_subscription_id: 'sub_same_123',
            status: 'past_due',
            current_period_end_billing_date: '2026-09-01',
          }),
          getTransactions: vi.fn().mockResolvedValue([
            {
              id: 'tx_same_sub_current_cycle',
              ministry_id: 'min-corr-3',
              provider: 'asaas',
              provider_subscription_id: 'sub_same_123',
              status: 'overdue',
              transaction_type: 'recurring_payment',
              due_date: '2026-09-01',
              invoice_url: 'https://sandbox.asaas.com/i/rec_current_cycle',
            },
            {
              id: 'tx_same_sub_old_cycle',
              ministry_id: 'min-corr-3',
              provider: 'asaas',
              provider_subscription_id: 'sub_same_123',
              status: 'overdue',
              transaction_type: 'recurring_payment',
              due_date: '2026-08-01',
              invoice_url: 'https://sandbox.asaas.com/i/rec_old_cycle',
            },
          ]),
        };

        const service = new SubscriptionService(mockSubRepo as any, mockBillingRepo as any);
        const summary = await service.getSubscriptionSummary('min-corr-3');

        expect(summary.paymentStatus.recoveryInvoiceUrl).toBe('https://sandbox.asaas.com/i/rec_current_cycle');
      });

      it('Seção 9 e 37: deve falhar fechado com recoveryInvoiceUrl = null quando candidatos são ambíguos ou não correspondem ao ciclo', async () => {
        const mockSubRepo = {
          getSubscription: vi.fn().mockResolvedValue({
            id: 'min-corr-4',
            ministry_id: 'min-corr-4',
            plan_id: 'essential',
            billing_status: 'past_due',
            subscription_mode: 'paid',
            current_period_end: '2026-09-01T00:00:00.000Z',
          }),
          getUsage: vi.fn().mockResolvedValue({ members_count: 5, songs_count: 10 }),
        };
        const mockBillingRepo = {
          getActiveTransitionForMinistry: vi.fn().mockResolvedValue(null),
          getSubscription: vi.fn().mockResolvedValue({
            id: 'min-corr-4_asaas',
            ministry_id: 'min-corr-4',
            provider: 'asaas',
            provider_subscription_id: 'sub_curr',
            status: 'past_due',
            current_period_end_billing_date: '2026-09-01',
          }),
          getTransactions: vi.fn().mockResolvedValue([
            // Transação antiga que não corresponde ao ciclo corrente
            {
              id: 'tx_old_cycle_only',
              ministry_id: 'min-corr-4',
              provider: 'asaas',
              provider_subscription_id: 'sub_curr',
              status: 'overdue',
              transaction_type: 'recurring_payment',
              due_date: '2026-06-01',
              invoice_url: 'https://sandbox.asaas.com/i/rec_ancient',
            },
          ]),
        };

        const service = new SubscriptionService(mockSubRepo as any, mockBillingRepo as any);
        const summary = await service.getSubscriptionSummary('min-corr-4');

        expect(summary.paymentStatus.state).toBe('past_due');
        expect(summary.paymentStatus.canRecoverPayment).toBe(true);
        expect(summary.paymentStatus.recoveryInvoiceUrl).toBeNull();
      });

      it('Seção 15: transação de ativação antecipada isolada NUNCA vira recoveryInvoiceUrl', async () => {
        const mockSubRepo = {
          getSubscription: vi.fn().mockResolvedValue({
            id: 'min-corr-5',
            ministry_id: 'min-corr-5',
            plan_id: 'essential',
            billing_status: 'past_due',
            subscription_mode: 'paid',
            current_period_end: '2026-09-01T00:00:00.000Z',
          }),
          getUsage: vi.fn().mockResolvedValue({ members_count: 5, songs_count: 10 }),
        };
        const mockBillingRepo = {
          getActiveTransitionForMinistry: vi.fn().mockResolvedValue(null),
          getSubscription: vi.fn().mockResolvedValue({
            id: 'min-corr-5_asaas',
            ministry_id: 'min-corr-5',
            provider: 'asaas',
            provider_subscription_id: 'sub_curr',
            status: 'past_due',
            current_period_end_billing_date: '2026-09-01',
          }),
          getTransactions: vi.fn().mockResolvedValue([
            {
              id: 'tx_early_activation_only',
              ministry_id: 'min-corr-5',
              provider: 'asaas',
              provider_payment_id: 'pay_early_123',
              transaction_type: 'prorated_early_activation_adjustment',
              quote_id: 'quote_123',
              attempt_id: 'att_123',
              status: 'pending',
              due_date: '2026-09-01',
              invoice_url: 'https://sandbox.asaas.com/i/rec_early_only',
            },
          ]),
        };

        const service = new SubscriptionService(mockSubRepo as any, mockBillingRepo as any);
        const summary = await service.getSubscriptionSummary('min-corr-5');

        expect(summary.paymentStatus.state).toBe('past_due');
        expect(summary.paymentStatus.canRecoverPayment).toBe(true);
        expect(summary.paymentStatus.recoveryInvoiceUrl).toBeNull();
      });

      describe('Phase 4A.6B: Exact Current Renewal Identity Hardening (Sections 3-37)', () => {
        const defaultContext = {
          ministryId: 'min-exact-1',
          billingSub: {
            id: 'min-exact-1_asaas',
            ministry_id: 'min-exact-1',
            provider: 'asaas' as const,
            provider_subscription_id: 'sub_exact_curr',
            plan_id: 'essential' as const,
            interval: 'monthly' as const,
            member_addon_blocks: 0,
            amount_cents: 3490,
            status: 'past_due' as const,
            started_at: '2026-08-01T00:00:00.000Z',
            current_period_start: '2026-08-01T00:00:00.000Z',
            current_period_end: '2026-09-01T00:00:00.000Z',
            current_period_end_billing_date: '2026-09-01',
            cancel_at_period_end: false,
            created_at: '2026-08-01T00:00:00.000Z',
            updated_at: '2026-09-01T00:00:00.000Z',
          },
          subscription: {
            id: 'min-exact-1',
            ministry_id: 'min-exact-1',
            plan_id: 'essential' as const,
            member_addon_blocks: 0,
            billing_status: 'past_due' as const,
            subscription_mode: 'paid' as const,
            current_period_start: '2026-08-01T00:00:00.000Z',
            current_period_end: '2026-09-01T00:00:00.000Z',
            grace_period_expires_at: '2026-09-08T00:00:00.000Z',
            grace_period_expires_billing_date: '2026-09-08',
            administratively_suspended: false,
            suspended_at: null,
            suspension_reason: null,
            cancel_at_period_end: false,
            created_at: '2026-08-01T00:00:00.000Z',
            updated_at: '2026-09-01T00:00:00.000Z',
          },
        };

        const canonicalRenewalTx = {
          id: 'tx_canonical_renewal',
          ministry_id: 'min-exact-1',
          provider: 'asaas',
          provider_subscription_id: 'sub_exact_curr',
          provider_payment_id: 'pay_renewal_exact_1',
          transaction_type: 'recurring_payment',
          status: 'overdue',
          due_date: '2026-09-01',
          invoice_url: 'https://sandbox.asaas.com/i/canonical_renewal_url',
        };

        it('1. exact current recurring renewal -> selected', () => {
          const res = resolveCurrentRenewalRecoveryInvoice([canonicalRenewalTx], defaultContext);
          expect(res).toBe('https://sandbox.asaas.com/i/canonical_renewal_url');
        });

        it('2. pending early activation adjustment -> rejected', () => {
          const res = resolveCurrentRenewalRecoveryInvoice([
            {
              ...canonicalRenewalTx,
              transaction_type: 'prorated_early_activation_adjustment',
              quote_id: 'quote_123',
              attempt_id: 'att_123',
            },
          ], defaultContext);
          expect(res).toBeNull();
        });

        it('3. wrong provider subscription -> rejected', () => {
          const res = resolveCurrentRenewalRecoveryInvoice([
            {
              ...canonicalRenewalTx,
              provider_subscription_id: 'sub_wrong_another',
            },
          ], defaultContext);
          expect(res).toBeNull();
        });

        it('4. old same-sub renewal cycle -> rejected', () => {
          const res = resolveCurrentRenewalRecoveryInvoice([
            {
              ...canonicalRenewalTx,
              due_date: '2026-08-01',
            },
          ], defaultContext);
          expect(res).toBeNull();
        });

        it('5. grace expiry due date -> rejected (deadline is NOT renewal date)', () => {
          const res = resolveCurrentRenewalRecoveryInvoice([
            {
              ...canonicalRenewalTx,
              due_date: '2026-09-08',
            },
          ], defaultContext);
          expect(res).toBeNull();
        });

        it('6. current period start due date -> rejected (start is NOT renewal boundary)', () => {
          const res = resolveCurrentRenewalRecoveryInvoice([
            {
              ...canonicalRenewalTx,
              due_date: '2026-08-01',
            },
          ], defaultContext);
          expect(res).toBeNull();
        });

        it('7. future transition target payment -> rejected (target recurrence != source renewal debt)', () => {
          const res = resolveCurrentRenewalRecoveryInvoice([
            {
              id: 'tx_future_target',
              ministry_id: 'min-exact-1',
              provider: 'asaas',
              provider_subscription_id: 'sub_target_future',
              provider_payment_id: 'pay_target_future_777',
              transaction_type: 'recurring_payment',
              status: 'pending',
              due_date: '2026-09-01',
              invoice_url: 'https://sandbox.asaas.com/i/wrong_target_url',
            },
          ], {
            ...defaultContext,
            activeTransitionResult: {
              transition: {
                id: 'tr_scheduled_pro',
                future_provider_payment_id: 'pay_target_future_777',
                effective_billing_date: '2026-09-01',
              },
            },
          });
          expect(res).toBeNull();
        });

        it('8. billingSub missing -> null (cannot verify current provider subscription)', () => {
          const res = resolveCurrentRenewalRecoveryInvoice([canonicalRenewalTx], {
            ...defaultContext,
            billingSub: null,
          });
          expect(res).toBeNull();
        });

        it('9. provider_subscription_id missing or empty -> null', () => {
          const res = resolveCurrentRenewalRecoveryInvoice([canonicalRenewalTx], {
            ...defaultContext,
            billingSub: {
              ...defaultContext.billingSub,
              provider_subscription_id: '',
            },
          });
          expect(res).toBeNull();
        });

        it('10. missing due_date -> rejected', () => {
          const res = resolveCurrentRenewalRecoveryInvoice([
            {
              ...canonicalRenewalTx,
              due_date: undefined,
            },
          ], defaultContext);
          expect(res).toBeNull();
        });

        it('11. unknown/missing transaction_type -> rejected (positive recurring purpose required)', () => {
          const res = resolveCurrentRenewalRecoveryInvoice([
            {
              ...canonicalRenewalTx,
              transaction_type: undefined,
            },
          ], defaultContext);
          expect(res).toBeNull();

          const resUnknown = resolveCurrentRenewalRecoveryInvoice([
            {
              ...canonicalRenewalTx,
              transaction_type: 'one_off_charge',
            },
          ], defaultContext);
          expect(resUnknown).toBeNull();
        });

        it('12. settled/canceled invoice -> rejected (only overdue/pending recoverable)', () => {
          const resConfirmed = resolveCurrentRenewalRecoveryInvoice([
            { ...canonicalRenewalTx, status: 'confirmed' },
          ], defaultContext);
          expect(resConfirmed).toBeNull();

          const resReceived = resolveCurrentRenewalRecoveryInvoice([
            { ...canonicalRenewalTx, status: 'received' },
          ], defaultContext);
          expect(resReceived).toBeNull();

          const resCanceled = resolveCurrentRenewalRecoveryInvoice([
            { ...canonicalRenewalTx, status: 'canceled' },
          ], defaultContext);
          expect(resCanceled).toBeNull();
        });

        it('13. two exact candidates for same cycle -> null (fail closed on ambiguity)', () => {
          const res = resolveCurrentRenewalRecoveryInvoice([
            canonicalRenewalTx,
            {
              ...canonicalRenewalTx,
              id: 'tx_canonical_duplicate',
              provider_payment_id: 'pay_renewal_exact_2',
              invoice_url: 'https://sandbox.asaas.com/i/canonical_duplicate_url',
            },
          ], defaultContext);
          expect(res).toBeNull();
        });

        it('14. canonical boundary fields divergence -> null (fail closed on conflicting cycle dates)', () => {
          const res = resolveCurrentRenewalRecoveryInvoice([canonicalRenewalTx], {
            ...defaultContext,
            billingSub: {
              ...defaultContext.billingSub,
              current_period_end_billing_date: '2026-09-01',
              effective_billing_date: '2026-09-02', // divergência material!
            },
          });
          expect(res).toBeNull();
        });

        it('15. mixed history realistic test: exactly ONE current source renewal selected among noise', async () => {
          const mockSubRepo = {
            getSubscription: vi.fn().mockResolvedValue(defaultContext.subscription),
            getUsage: vi.fn().mockResolvedValue({ members_count: 5, songs_count: 10 }),
          };
          const mockBillingRepo = {
            getActiveTransitionForMinistry: vi.fn().mockResolvedValue({
              transition: {
                id: 'tr_scheduled_pro',
                future_provider_payment_id: 'pay_target_future_777',
                effective_billing_date: '2026-09-01',
              },
            }),
            getSubscription: vi.fn().mockResolvedValue(defaultContext.billingSub),
            getTransactions: vi.fn().mockResolvedValue([
              // 1. Ajuste de ativação antecipada recente
              {
                id: 'tx_early_adj',
                ministry_id: 'min-exact-1',
                provider: 'asaas',
                transaction_type: 'prorated_early_activation_adjustment',
                quote_id: 'quote_99',
                attempt_id: 'att_99',
                status: 'pending',
                due_date: '2026-09-01',
                invoice_url: 'https://sandbox.asaas.com/i/noise_early_adj',
              },
              // 2. Cobrança da target transition
              {
                id: 'tx_target_tr',
                ministry_id: 'min-exact-1',
                provider: 'asaas',
                provider_subscription_id: 'sub_target_future',
                provider_payment_id: 'pay_target_future_777',
                transaction_type: 'recurring_payment',
                status: 'pending',
                due_date: '2026-09-01',
                invoice_url: 'https://sandbox.asaas.com/i/noise_target_tr',
              },
              // 3. Fatura de ciclo antigo da mesma assinatura
              {
                id: 'tx_old_cycle',
                ministry_id: 'min-exact-1',
                provider: 'asaas',
                provider_subscription_id: 'sub_exact_curr',
                transaction_type: 'recurring_payment',
                status: 'overdue',
                due_date: '2026-08-01',
                invoice_url: 'https://sandbox.asaas.com/i/noise_old_cycle',
              },
              // 4. Fatura liquidada anterior da mesma assinatura
              {
                id: 'tx_settled',
                ministry_id: 'min-exact-1',
                provider: 'asaas',
                provider_subscription_id: 'sub_exact_curr',
                transaction_type: 'recurring_payment',
                status: 'confirmed',
                due_date: '2026-09-01',
                invoice_url: 'https://sandbox.asaas.com/i/noise_settled',
              },
              // 5. Fatura de outra assinatura do provedor
              {
                id: 'tx_other_sub',
                ministry_id: 'min-exact-1',
                provider: 'asaas',
                provider_subscription_id: 'sub_prior_legacy',
                transaction_type: 'recurring_payment',
                status: 'overdue',
                due_date: '2026-09-01',
                invoice_url: 'https://sandbox.asaas.com/i/noise_other_sub',
              },
              // 6. Fatura legítima de renovação do ciclo corrente
              canonicalRenewalTx,
            ]),
          };

          const service = new SubscriptionService(mockSubRepo as any, mockBillingRepo as any);
          const summary = await service.getSubscriptionSummary('min-exact-1');

          expect(summary.paymentStatus.state).toBe('past_due');
          expect(summary.paymentStatus.canRecoverPayment).toBe(true);
          expect(summary.paymentStatus.recoveryInvoiceUrl).toBe('https://sandbox.asaas.com/i/canonical_renewal_url');
        });
      });
    });
  });
});
