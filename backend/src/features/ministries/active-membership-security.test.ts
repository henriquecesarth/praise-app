import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../lib/firebase';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import { ScheduleRepository } from '../../repositories/ScheduleRepository';
import { OrganizationRepository } from '../../repositories/OrganizationRepository';
import { AvailabilityService } from '../availability/availability.service';
import { NotificationService } from '../notifications/notification.service';
import { requireMinistryRole } from '../../middleware/rbac';
import { AppError } from '../../middleware/error-handler';

function uniqueId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

describe('Active Membership Security Hardening (M12A-R4)', { timeout: 30000 }, () => {
  let ministryRepo: MinistryRepository;
  let subRepo: SubscriptionRepository;
  let scheduleRepo: ScheduleRepository;
  let orgRepo: OrganizationRepository;
  let availabilityService: AvailabilityService;
  let notificationService: NotificationService;

  beforeEach(() => {
    ministryRepo = new MinistryRepository();
    subRepo = new SubscriptionRepository();
    scheduleRepo = new ScheduleRepository();
    orgRepo = new OrganizationRepository();
    availabilityService = new AvailabilityService();
    notificationService = new NotificationService();
  });

  describe('R4-16 — Middleware requireMinistryRole Immediate Revocation', () => {
    it('active member calls requireMinistryRole -> succeeds; soft-removed -> same token immediately rejected with 403', async () => {
      const minId = uniqueId('min');
      const ownerId = uniqueId('usr_owner');
      const memberUserId = uniqueId('usr_member');

      await db.collection('ministries').doc(minId).set({
        name: 'Ministry R4',
        owner_user_id: ownerId,
        subscription_status: 'active',
      });
      await db.collection('ministry_subscriptions').doc(minId).set({
        plan_id: 'free',
        status: 'active',
      });
      await db.collection('ministry_usage').doc(minId).set({
        members_count: 1,
      });

      const { member } = await subRepo.addMemberTransactional({
        ministryId: minId,
        userId: memberUserId,
        role: 'member',
      });
      expect(member.status).toBe('active');

      const middleware = requireMinistryRole('member');
      const req = {
        user: { id: memberUserId },
        params: { ministryId: minId },
      } as any;
      const res = {} as any;
      let nextCalledWith: any = null;
      await middleware(req, res, (err) => { nextCalledWith = err; });
      expect(nextCalledWith).toBeUndefined();

      // Soft remove member
      await ministryRepo.removeMember(minId, memberUserId, ownerId);

      // Second call with exact same token/req
      nextCalledWith = null;
      await middleware(req, res, (err) => { nextCalledWith = err; });
      expect(nextCalledWith).toBeInstanceOf(AppError);
      expect(nextCalledWith.statusCode).toBe(403);
      expect(nextCalledWith.details?.code).toBe('MINISTRY_ACCESS_DENIED');
    });

    it('active admin calls requireMinistryRole("admin") -> succeeds; soft-removed -> same token rejected with 403', async () => {
      const minId = uniqueId('min');
      const ownerId = uniqueId('usr_owner');
      const adminUserId = uniqueId('usr_admin');
      const otherAdminId = uniqueId('usr_other_admin');

      await db.collection('ministries').doc(minId).set({
        name: 'Ministry R4 Admin',
        owner_user_id: ownerId,
        subscription_status: 'active',
      });
      await db.collection('ministry_subscriptions').doc(minId).set({
        plan_id: 'pro',
        status: 'active',
      });
      await db.collection('ministry_usage').doc(minId).set({
        members_count: 2,
      });

      // Add two admins so removing one does not leave 0 admins
      await subRepo.addMemberTransactional({
        ministryId: minId,
        userId: otherAdminId,
        role: 'admin',
      });
      await subRepo.addMemberTransactional({
        ministryId: minId,
        userId: adminUserId,
        role: 'admin',
      });

      const adminMiddleware = requireMinistryRole('admin');
      const req = {
        user: { id: adminUserId },
        params: { ministryId: minId },
      } as any;
      const res = {} as any;
      let nextCalledWith: any = null;
      await adminMiddleware(req, res, (err) => { nextCalledWith = err; });
      expect(nextCalledWith).toBeUndefined();

      // Soft remove admin
      await ministryRepo.removeMember(minId, adminUserId, ownerId);

      // Second call with same token
      nextCalledWith = null;
      await adminMiddleware(req, res, (err) => { nextCalledWith = err; });
      expect(nextCalledWith).toBeInstanceOf(AppError);
      expect(nextCalledWith.statusCode).toBe(403);
      expect(nextCalledWith.details?.code).toBe('MINISTRY_ACCESS_DENIED');
    });

    it('admin demoted to member is immediately denied on admin routes but permitted on member routes', async () => {
      const minId = uniqueId('min');
      const ownerId = uniqueId('usr_owner');
      const adminUserId = uniqueId('usr_admin');

      await db.collection('ministries').doc(minId).set({
        name: 'Ministry R4 Demote',
        owner_user_id: ownerId,
        subscription_status: 'active',
      });
      await db.collection('ministry_subscriptions').doc(minId).set({
        plan_id: 'pro',
        status: 'active',
      });
      await db.collection('ministry_usage').doc(minId).set({
        members_count: 2,
      });

      const otherAdmin = uniqueId('usr_admin2');
      await subRepo.addMemberTransactional({
        ministryId: minId,
        userId: otherAdmin,
        role: 'admin',
      });

      const { member } = await subRepo.addMemberTransactional({
        ministryId: minId,
        userId: adminUserId,
        role: 'admin',
      });

      const adminMiddleware = requireMinistryRole('admin');
      const memberMiddleware = requireMinistryRole('member');
      const req = {
        user: { id: adminUserId },
        params: { ministryId: minId },
      } as any;
      const res = {} as any;

      let nextResult: any;
      await adminMiddleware(req, res, (err) => { nextResult = err; });
      expect(nextResult).toBeUndefined();

      // Demote admin to member
      await ministryRepo.updateMemberDetails(minId, member.id, { role: 'member' }, ownerId);

      // Admin route must now fail with 403
      nextResult = null;
      await adminMiddleware(req, res, (err) => { nextResult = err; });
      expect(nextResult).toBeInstanceOf(AppError);
      expect(nextResult.statusCode).toBe(403);
      expect(nextResult.message).toMatch(/Ação restrita a administradores/i);

      // Member route still succeeds
      nextResult = null;
      await memberMiddleware(req, res, (err) => { nextResult = err; });
      expect(nextResult).toBeUndefined();
    });
  });

  describe('R4-17 — Consumers correctly exclude soft-removed members', () => {
    it('getUserMinistries excludes ministries where user has status === "removed"', async () => {
      const minActive = uniqueId('min_act');
      const minRemoved = uniqueId('min_rem');
      const userId = uniqueId('usr_user');

      await db.collection('ministries').doc(minActive).set({
        name: 'Min Active',
        owner_user_id: uniqueId('owner1'),
      });
      await db.collection('ministries').doc(minRemoved).set({
        name: 'Min Removed',
        owner_user_id: uniqueId('owner2'),
      });

      await db.collection('ministry_members').add({
        ministry_id: minActive,
        user_id: userId,
        role: 'member',
        status: 'active',
        created_at: new Date().toISOString(),
      });
      await db.collection('ministry_members').add({
        ministry_id: minRemoved,
        user_id: userId,
        role: 'member',
        status: 'removed',
        removed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });

      const list = await ministryRepo.getUserMinistries(userId);
      const ministryIds = list.map((m) => m.id);
      expect(ministryIds).toContain(minActive);
      expect(ministryIds).not.toContain(minRemoved);
    });

    it('getMinistryById rejects soft-removed member with 403 MINISTRY_ACCESS_DENIED', async () => {
      const minId = uniqueId('min');
      const userId = uniqueId('usr_user');

      await db.collection('ministries').doc(minId).set({
        name: 'Min Test',
        owner_user_id: uniqueId('owner'),
      });
      await db.collection('ministry_members').add({
        ministry_id: minId,
        user_id: userId,
        role: 'member',
        status: 'removed',
        removed_at: new Date().toISOString(),
      });

      await expect(ministryRepo.getMinistryById(minId, userId)).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'MINISTRY_ACCESS_DENIED' },
      });
    });

    it('getMinistryMemberById rejects soft-removed member with 404 anti-IDOR', async () => {
      const minId = uniqueId('min');
      const ownerId = uniqueId('usr_owner');
      const memberUserId = uniqueId('usr_member');

      await db.collection('ministries').doc(minId).set({
        name: 'Min Test',
        owner_user_id: ownerId,
      });
      const memberRef = await db.collection('ministry_members').add({
        ministry_id: minId,
        user_id: memberUserId,
        role: 'member',
        status: 'removed',
        removed_at: new Date().toISOString(),
      });

      await expect(
        ministryRepo.getMinistryMemberById(minId, memberRef.id, ownerId)
      ).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('AvailabilityService rejects soft-removed members', async () => {
      const minId = uniqueId('min');
      const userId = uniqueId('usr_avail');

      const memRef = await db.collection('ministry_members').add({
        ministry_id: minId,
        user_id: userId,
        role: 'member',
        status: 'removed',
        removed_at: new Date().toISOString(),
      });

      await expect(
        availabilityService.resolveCanonicalMembership(minId, userId)
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'MINISTRY_ACCESS_DENIED' },
      });

      await expect(
        availabilityService.listConsolidatedAvailability(minId, {
          from: '2026-10-01',
          to: '2026-10-10',
          memberId: memRef.id,
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        details: { code: 'MEMBER_NOT_FOUND' },
      });

      const resolved = await availabilityService.resolveMinistryMemberIds(minId, [memRef.id, userId]);
      expect(resolved.canonicalMemberIds).toHaveLength(0);
      expect(resolved.unresolvedParticipantIds).toContain(memRef.id);
      expect(resolved.unresolvedParticipantIds).toContain(userId);

      const manualRef = await db.collection('ministry_members').add({
        ministry_id: minId,
        is_manual: true,
        user_id: null,
        name: 'Manual Removed',
        status: 'removed',
        removed_at: new Date().toISOString(),
      });
      await expect(
        availabilityService.resolveEligibleManualMembership(minId, manualRef.id)
      ).rejects.toMatchObject({
        statusCode: 404,
        details: { code: 'MEMBER_NOT_FOUND' },
      });
    });

    it('ScheduleRepository rejects soft-removed members from new assignments and confirmations', async () => {
      const minId = uniqueId('min');
      const userId = uniqueId('usr_user');

      const memRef = await db.collection('ministry_members').add({
        ministry_id: minId,
        user_id: userId,
        role: 'member',
        status: 'removed',
        removed_at: new Date().toISOString(),
      });

      await expect(
        scheduleRepo.createSchedule(minId, 'creator-id', {
          title: 'Ensaio Geral',
          date: '2026-10-15',
          participants: [{ id: memRef.id, name: 'Removido', role: 'Vocal' }],
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        details: { code: 'REMOVED_MEMBER_ASSIGNMENT_DENIED' },
      });

      const activeUserId = uniqueId('usr_active');
      const activeMemRef = await db.collection('ministry_members').add({
        ministry_id: minId,
        user_id: activeUserId,
        role: 'member',
        status: 'active',
      });

      const sched = await scheduleRepo.createSchedule(minId, 'creator-id', {
        title: 'Culto Domingo',
        date: '2026-10-15',
        participants: [{ id: activeMemRef.id, name: 'Ativo', role: 'Violão' }],
      });

      await expect(
        scheduleRepo.updateSchedule(sched.id, minId, {
          participants: [
            { id: activeMemRef.id, name: 'Ativo', role: 'Violão' },
            { id: memRef.id, name: 'Removido', role: 'Vocal' },
          ],
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        details: { code: 'REMOVED_MEMBER_ASSIGNMENT_DENIED' },
      });

      const updated = await scheduleRepo.updateSchedule(sched.id, minId, {
        title: 'Culto Domingo Alterado',
      });
      expect(updated.title).toBe('Culto Domingo Alterado');

      await expect(
        scheduleRepo.updateParticipantConfirmation(
          sched.id,
          minId,
          userId,
          'Removido',
          true
        )
      ).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('NotificationService omits soft-removed members from notifications', async () => {
      const minId = uniqueId('min');
      const activeUserId = uniqueId('usr_active');
      const removedUserId = uniqueId('usr_removed');

      await db.collection('ministries').doc(minId).set({
        name: 'Min Notif',
        owner_user_id: uniqueId('owner'),
      });

      await db.collection('ministry_members').add({
        ministry_id: minId,
        user_id: activeUserId,
        role: 'member',
        status: 'active',
      });
      const removedDoc = await db.collection('ministry_members').add({
        ministry_id: minId,
        user_id: removedUserId,
        role: 'member',
        status: 'removed',
        removed_at: new Date().toISOString(),
      });

      const participantUids = await notificationService.resolveParticipantUserIds(minId, [
        { id: activeUserId },
        { id: removedDoc.id },
      ]);
      expect(participantUids).toContain(activeUserId);
      expect(participantUids).not.toContain(removedUserId);

      const memberUids = await notificationService.resolveMinistryMemberUserIds(minId);
      expect(memberUids).toContain(activeUserId);
      expect(memberUids).not.toContain(removedUserId);
    });

    it('OrganizationRepository denies soft-removed admin from linking ministry', async () => {
      const minId = uniqueId('min');
      const orgId = uniqueId('org');
      const adminUserId = uniqueId('usr_admin');

      await db.collection('organizations').doc(orgId).set({
        name: 'Org Test',
        owner_user_id: adminUserId,
      });
      await db.collection('ministries').doc(minId).set({
        name: 'Min Test',
        owner_user_id: uniqueId('other_owner'),
      });
      await db.collection('ministry_members').add({
        ministry_id: minId,
        user_id: adminUserId,
        role: 'admin',
        status: 'removed',
        removed_at: new Date().toISOString(),
      });

      await expect(
        orgRepo.linkMinistryToOrganization(orgId, minId, adminUserId)
      ).rejects.toMatchObject({
        statusCode: 403,
      });
    });
  });

  describe('R4-18 — Transactional Last Active Admin Invariant', () => {
    it('rejects removal of the last remaining active admin', async () => {
      const minId = uniqueId('min');
      const ownerId = uniqueId('usr_owner');
      const onlyAdmin = uniqueId('usr_admin');

      await db.collection('ministries').doc(minId).set({
        name: 'Ministry Invariant',
        owner_user_id: ownerId,
      });
      await db.collection('ministry_subscriptions').doc(minId).set({
        plan_id: 'pro',
        status: 'active',
      });
      await db.collection('ministry_usage').doc(minId).set({
        members_count: 1,
      });

      const { member } = await subRepo.addMemberTransactional({
        ministryId: minId,
        userId: onlyAdmin,
        role: 'admin',
      });

      await expect(
        ministryRepo.removeMember(minId, member.id, ownerId)
      ).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringMatching(/Não é possível remover o único administrador/i),
      });

      await expect(
        ministryRepo.updateMemberDetails(minId, member.id, { role: 'member' }, ownerId)
      ).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringMatching(/Não é possível rebaixar o único administrador/i),
      });
    });

    it('soft-removed admins are excluded from active admin count', async () => {
      const minId = uniqueId('min');
      const ownerId = uniqueId('usr_owner');
      const activeAdmin = uniqueId('usr_admin_act');
      const removedAdmin = uniqueId('usr_admin_rem');

      await db.collection('ministries').doc(minId).set({
        name: 'Ministry Soft Removed Admins',
        owner_user_id: ownerId,
      });
      await db.collection('ministry_subscriptions').doc(minId).set({
        plan_id: 'pro',
        status: 'active',
      });
      await db.collection('ministry_usage').doc(minId).set({
        members_count: 2,
      });

      const { member: actDoc } = await subRepo.addMemberTransactional({
        ministryId: minId,
        userId: activeAdmin,
        role: 'admin',
      });

      await db.collection('ministry_members').add({
        ministry_id: minId,
        user_id: removedAdmin,
        role: 'admin',
        status: 'removed',
        removed_at: new Date().toISOString(),
      });

      await expect(
        ministryRepo.removeMember(minId, actDoc.id, ownerId)
      ).rejects.toMatchObject({
        statusCode: 400,
      });
    });
  });

  describe('R4-19 — Canonical roleIds Validation and Atomicity', () => {
    it('rejects unknown roleId and roleId from another ministry within transaction', async () => {
      const minA = uniqueId('min_a');
      const minB = uniqueId('min_b');
      const ownerA = uniqueId('usr_owner_a');

      await db.collection('ministries').doc(minA).set({
        name: 'Min A',
        owner_user_id: ownerA,
      });
      await db.collection('ministries').doc(minB).set({
        name: 'Min B',
        owner_user_id: uniqueId('usr_owner_b'),
      });
      await db.collection('ministry_subscriptions').doc(minA).set({
        plan_id: 'pro',
        status: 'active',
      });
      await db.collection('ministry_usage').doc(minA).set({
        members_count: 0,
      });

      const roleB = await db.collection('ministry_roles').add({
        ministry_id: minB,
        name: 'Bateria Min B',
      });

      await expect(
        subRepo.addMemberTransactional({
          ministryId: minA,
          userId: uniqueId('usr_x'),
          role: 'member',
          roleIds: [roleB.id],
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringMatching(/Função musical inválida ou não pertencente/i),
      });

      const usage = await db.collection('ministry_usage').doc(minA).get();
      expect(usage.data()?.members_count).toBe(0);
    });

    it('persists valid roleIds atomically', async () => {
      const minId = uniqueId('min');
      const ownerId = uniqueId('usr_owner');
      const userId = uniqueId('usr_guitar');

      await db.collection('ministries').doc(minId).set({
        name: 'Min Music',
        owner_user_id: ownerId,
      });
      await db.collection('ministry_subscriptions').doc(minId).set({
        plan_id: 'pro',
        status: 'active',
      });
      await db.collection('ministry_usage').doc(minId).set({
        members_count: 0,
      });

      const roleDoc = await db.collection('ministry_roles').add({
        ministry_id: minId,
        name: 'Violão Solo',
      });

      const { member } = await subRepo.addMemberTransactional({
        ministryId: minId,
        userId,
        role: 'member',
        roleIds: [roleDoc.id],
      });

      expect(member.role_ids).toEqual([roleDoc.id]);
    });
  });

  describe('R4-9 & R4-10 — Manual Re-add and Linked Reactivation Semantics', () => {
    it('manual member: removed record is historical; re-add creates new record; active duplicate email rejected with 409', async () => {
      const minId = uniqueId('min');
      const ownerId = uniqueId('usr_owner');

      await db.collection('ministries').doc(minId).set({
        name: 'Min Manual',
        owner_user_id: ownerId,
      });
      await db.collection('ministry_subscriptions').doc(minId).set({
        plan_id: 'free',
        status: 'active',
      });
      await db.collection('ministry_usage').doc(minId).set({
        members_count: 0,
      });

      const { member: manual1 } = await subRepo.addMemberTransactional({
        ministryId: minId,
        name: 'Manual Singer',
        email: 'manual@singer.com',
        role: 'member',
      });
      expect(manual1.is_manual).toBe(true);

      // R6-5: Dois membros manuais distintos podem legitimamente usar o mesmo e-mail
      const { member: manualDuplicateEmail } = await subRepo.addMemberTransactional({
        ministryId: minId,
        name: 'Another Singer',
        email: 'manual@singer.com',
        role: 'member',
      });
      expect(manualDuplicateEmail.id).not.toBe(manual1.id);
      expect(manualDuplicateEmail.status).toBe('active');
      expect(manualDuplicateEmail.email).toBe('manual@singer.com');

      await ministryRepo.removeMember(minId, manual1.id, ownerId);

      const { member: manual2 } = await subRepo.addMemberTransactional({
        ministryId: minId,
        name: 'Manual Singer Return',
        email: 'manual@singer.com',
        role: 'member',
      });
      expect(manual2.id).not.toBe(manual1.id);
      expect(manual2.id).not.toBe(manualDuplicateEmail.id);
      expect(manual2.status).toBe('active');

      const oldDoc = await db.collection('ministry_members').doc(manual1.id).get();
      expect(oldDoc.data()?.status).toBe('removed');
    });

    it('linked member: re-add restores existing doc, clears removed_at, increments usage once', async () => {
      const minId = uniqueId('min');
      const ownerId = uniqueId('usr_owner');
      const userId = uniqueId('usr_linked');

      await db.collection('ministries').doc(minId).set({
        name: 'Min Linked',
        owner_user_id: ownerId,
      });
      await db.collection('ministry_subscriptions').doc(minId).set({
        plan_id: 'free',
        status: 'active',
      });
      await db.collection('ministry_usage').doc(minId).set({
        members_count: 0,
      });

      const { member: member1 } = await subRepo.addMemberTransactional({
        ministryId: minId,
        userId,
        role: 'member',
      });
      let usageDoc = await db.collection('ministry_usage').doc(minId).get();
      expect(usageDoc.data()?.members_count).toBe(1);

      await ministryRepo.removeMember(minId, member1.id, ownerId);
      usageDoc = await db.collection('ministry_usage').doc(minId).get();
      expect(usageDoc.data()?.members_count).toBe(0);

      const { member: memberReactivated } = await subRepo.addMemberTransactional({
        ministryId: minId,
        userId,
        role: 'admin',
      });
      expect(memberReactivated.id).toBe(member1.id);
      expect(memberReactivated.status).toBe('active');
      expect(memberReactivated.removed_at).toBeNull();
      expect(memberReactivated.role).toBe('admin');

      usageDoc = await db.collection('ministry_usage').doc(minId).get();
      expect(usageDoc.data()?.members_count).toBe(1);
    });

    it('linked rejoin preserves still-valid role assignments and drops obsolete role assignments (R6-4)', async () => {
      const minId = uniqueId('min');
      const ownerId = uniqueId('usr_owner');
      const userId = uniqueId('usr_linked_roles');
      const roleAId = uniqueId('role_a');
      const roleBId = uniqueId('role_b');

      await db.collection('ministries').doc(minId).set({
        name: 'Min Roles',
        owner_user_id: ownerId,
      });
      await db.collection('ministry_subscriptions').doc(minId).set({
        plan_id: 'free',
        status: 'active',
      });
      await db.collection('ministry_usage').doc(minId).set({
        members_count: 0,
      });

      // Create Role A and Role B in ministry
      await db.collection('ministry_roles').doc(roleAId).set({
        id: roleAId,
        ministry_id: minId,
        name: 'Guitarra',
      });
      await db.collection('ministry_roles').doc(roleBId).set({
        id: roleBId,
        ministry_id: minId,
        name: 'Bateria',
      });

      // 1. Linked member added with Role A + Role B
      const { member: memberInitial } = await subRepo.addMemberTransactional({
        ministryId: minId,
        userId,
        role: 'member',
        roleIds: [roleAId, roleBId],
      });
      expect(memberInitial.role_ids).toEqual(expect.arrayContaining([roleAId, roleBId]));

      // 2. Member removed
      await ministryRepo.removeMember(minId, memberInitial.id, ownerId);

      // 3. Role B deleted from canonical ministry roles
      await db.collection('ministry_roles').doc(roleBId).delete();

      // 4. Member rejoins (linked reactivation)
      const { member: memberRejoined } = await subRepo.addMemberTransactional({
        ministryId: minId,
        userId,
        role: 'member',
      });

      // 5. Membership active with Role A only; Role B not restored
      expect(memberRejoined.id).toBe(memberInitial.id);
      expect(memberRejoined.status).toBe('active');
      expect(memberRejoined.role_ids).toEqual([roleAId]);
      expect(memberRejoined.role_ids).not.toContain(roleBId);

      // Verify directly in Firestore document
      const docFresh = await db.collection('ministry_members').doc(memberInitial.id).get();
      expect(docFresh.data()?.status).toBe('active');
      expect(docFresh.data()?.role_ids).toEqual([roleAId]);
    });

    it('concurrent admin demotions: OCC ensures last active admin cannot be demoted (R6-2)', async () => {
      const minId = uniqueId('min');
      const ownerId = uniqueId('usr_owner');
      const admin1Id = uniqueId('usr_admin1');
      const admin2Id = uniqueId('usr_admin2');

      await db.collection('ministries').doc(minId).set({
        name: 'Min OCC Demotion',
        owner_user_id: ownerId,
      });
      await db.collection('ministry_subscriptions').doc(minId).set({
        plan_id: 'free',
        status: 'active',
      });
      await db.collection('ministry_usage').doc(minId).set({
        members_count: 2,
      });

      const { member: m1 } = await subRepo.addMemberTransactional({
        ministryId: minId,
        userId: admin1Id,
        role: 'admin',
      });
      const { member: m2 } = await subRepo.addMemberTransactional({
        ministryId: minId,
        userId: admin2Id,
        role: 'admin',
      });

      // Demote both concurrently
      const results = await Promise.allSettled([
        ministryRepo.updateMemberDetails(minId, m1.id, { role: 'member' }, ownerId),
        ministryRepo.updateMemberDetails(minId, m2.id, { role: 'member' }, ownerId),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly one succeeds; the second must fail with 400 because only 1 active admin remained
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      const rejReason = (rejected[0] as PromiseRejectedResult).reason;
      expect(rejReason?.statusCode).toBe(400);
      expect(rejReason?.message).toContain('único administrador');
    });

    it('roleIds update: transactionally validated and rejects cross-ministry or deleted roles (R6-3)', async () => {
      const minId = uniqueId('min');
      const otherMinId = uniqueId('min_other');
      const ownerId = uniqueId('usr_owner');
      const userId = uniqueId('usr_member');
      const validRoleId = uniqueId('role_valid');
      const crossRoleId = uniqueId('role_cross');

      await db.collection('ministries').doc(minId).set({ name: 'Min A', owner_user_id: ownerId });
      await db.collection('ministries').doc(otherMinId).set({ name: 'Min B', owner_user_id: ownerId });
      await db.collection('ministry_subscriptions').doc(minId).set({ plan_id: 'free', status: 'active' });
      await db.collection('ministry_usage').doc(minId).set({ members_count: 1 });

      await db.collection('ministry_roles').doc(validRoleId).set({
        id: validRoleId,
        ministry_id: minId,
        name: 'Vocal',
      });
      await db.collection('ministry_roles').doc(crossRoleId).set({
        id: crossRoleId,
        ministry_id: otherMinId,
        name: 'Vocal Outro',
      });

      const { member } = await subRepo.addMemberTransactional({
        ministryId: minId,
        userId,
        role: 'member',
      });

      // Update with cross-ministry role fails with 400
      await expect(
        ministryRepo.updateMemberDetails(minId, member.id, { roleIds: [crossRoleId] }, ownerId)
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Função musical inválida ou não pertencente a este ministério.',
      });

      // Update with non-existent role fails with 400
      await expect(
        ministryRepo.updateMemberDetails(minId, member.id, { roleIds: ['non_existent_role_id'] }, ownerId)
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Função musical inválida ou não pertencente a este ministério.',
      });

      // Update with valid role succeeds
      const updated = await ministryRepo.updateMemberDetails(minId, member.id, { roleIds: [validRoleId] }, ownerId);
      expect(updated.role_ids).toEqual([validRoleId]);
    });

    it('account deletion: findSoleAdminMinistries excludes removed admins and counts active admins correctly (R6-1)', async () => {
      const { AccountDeletionRepository } = await import('../../repositories/AccountDeletionRepository');
      const accountDeletionRepo = new AccountDeletionRepository();

      const minId1 = uniqueId('min');
      const minId2 = uniqueId('min');
      const userId = uniqueId('usr_del_candidate');
      const otherAdminId = uniqueId('usr_other_admin');

      await db.collection('ministries').doc(minId1).set({ name: 'Min 1 Sole' });
      await db.collection('ministries').doc(minId2).set({ name: 'Min 2 Removed' });

      // In Min 1: User is admin, otherAdmin was removed -> user IS sole active admin
      await subRepo.addMemberTransactional({
        ministryId: minId1,
        userId,
        role: 'admin',
      });
      const { member: m1Other } = await subRepo.addMemberTransactional({
        ministryId: minId1,
        userId: otherAdminId,
        role: 'admin',
      });
      // Soft-remove other admin
      await db.collection('ministry_members').doc(m1Other.id).update({ status: 'removed', removed_at: new Date().toISOString() });

      // In Min 2: User was removed as admin -> user is NOT an active admin
      const { member: m2User } = await subRepo.addMemberTransactional({
        ministryId: minId2,
        userId,
        role: 'admin',
      });
      await db.collection('ministry_members').doc(m2User.id).update({ status: 'removed', removed_at: new Date().toISOString() });

      const soleMinistries = await accountDeletionRepo.findSoleAdminMinistries(userId);
      const soleIds = soleMinistries.map((m) => m.id);

      // Min 1 must be present (user is the sole active admin because other admin is soft-removed)
      expect(soleIds).toContain(minId1);
      // Min 2 must NOT be present (user was soft-removed from Min 2, so cannot block account deletion)
      expect(soleIds).not.toContain(minId2);
    });
  });
});
