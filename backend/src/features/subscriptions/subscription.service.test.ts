import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubscriptionService } from './subscription.service';
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
    it('deve conter exatamente os 6 planos comerciais confirmados com suas quotas', () => {
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
      });

      // Lite
      expect(PLANS_CATALOG.lite).toEqual({
        id: 'lite',
        name: 'Lite',
        baseMembers: 20,
        baseSongs: 100,
        allowMemberAddons: false,
        maxMemberAddonBlocks: 0,
      });

      // Lite+
      expect(PLANS_CATALOG.lite_plus).toEqual({
        id: 'lite_plus',
        name: 'Lite+',
        baseMembers: 30,
        baseSongs: 150,
        allowMemberAddons: false,
        maxMemberAddonBlocks: 0,
      });

      // Essential
      expect(PLANS_CATALOG.essential).toEqual({
        id: 'essential',
        name: 'Essential',
        baseMembers: 40,
        baseSongs: 200,
        allowMemberAddons: true,
        maxMemberAddonBlocks: 4,
      });

      // Pro
      expect(PLANS_CATALOG.pro).toEqual({
        id: 'pro',
        name: 'Pro',
        baseMembers: 100,
        baseSongs: 500,
        allowMemberAddons: true,
        maxMemberAddonBlocks: 10,
      });

      // Premium
      expect(PLANS_CATALOG.premium).toEqual({
        id: 'premium',
        name: 'Premium',
        baseMembers: 'unlimited',
        baseSongs: 'unlimited',
        allowMemberAddons: false,
        maxMemberAddonBlocks: 0,
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

    it('deve retornar explicitamente "unlimited" para o plano Premium', () => {
      expect(getEffectiveMemberQuota(PLANS_CATALOG.premium, 0)).toBe('unlimited');
      expect(getEffectiveSongQuota(PLANS_CATALOG.premium)).toBe('unlimited');
    });

    it('deve validar limites de músicas conforme o catálogo', () => {
      expect(getEffectiveSongQuota(PLANS_CATALOG.free)).toBe(50);
      expect(getEffectiveSongQuota(PLANS_CATALOG.lite)).toBe(100);
      expect(getEffectiveSongQuota(PLANS_CATALOG.lite_plus)).toBe(150);
      expect(getEffectiveSongQuota(PLANS_CATALOG.essential)).toBe(200);
      expect(getEffectiveSongQuota(PLANS_CATALOG.pro)).toBe(500);
      expect(getEffectiveSongQuota(PLANS_CATALOG.premium)).toBe('unlimited');
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

    it('deve validar plano Premium com grandes volumes (1000 membros e 5000 músicas) sem overflow ou quota finita', () => {
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

      const largeUsage: MinistryUsageRecord = {
        id: 'min-prem',
        ministry_id: 'min-prem',
        members_count: 1000,
        songs_count: 5000,
        created_at: '2026-08-28T00:00:00.000Z',
        updated_at: '2026-08-28T00:00:00.000Z',
      };

      const result = resolveAccessMode(premiumSub, PLANS_CATALOG.premium, largeUsage);
      expect(result.accessMode).toBe('normal');
      expect(result.isOverLimit).toBe(false);
      expect(getEffectiveMemberQuota(PLANS_CATALOG.premium, 0)).toBe('unlimited');
      expect(getEffectiveSongQuota(PLANS_CATALOG.premium)).toBe('unlimited');
    });
  });
});
