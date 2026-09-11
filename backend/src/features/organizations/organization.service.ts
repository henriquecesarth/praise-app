import { OrganizationRepository } from '../../repositories/OrganizationRepository';
import {
  OrganizationRecord,
  OrganizationMemberRecord,
  OrganizationWhatsAppCapacity,
} from './organization.types';
import { AppError } from '../../middleware/error-handler';
import { SubscriptionService } from '../subscriptions/subscription.service';

export class OrganizationService {
  constructor(
    private readonly orgRepo: OrganizationRepository = new OrganizationRepository(),
    private readonly subscriptionService: SubscriptionService = new SubscriptionService()
  ) {}

  async getOrganizationById(orgId: string): Promise<OrganizationRecord> {
    const org = await this.orgRepo.getOrganizationById(orgId);
    if (!org) {
      throw new AppError(404, 'Organização não encontrada.');
    }
    return org;
  }

  async getOrganizationByMinistryId(ministryId: string): Promise<OrganizationRecord | null> {
    return await this.orgRepo.getOrganizationByMinistryId(ministryId);
  }

  async listOrganizationMembers(orgId: string): Promise<OrganizationMemberRecord[]> {
    const org = await this.orgRepo.getOrganizationById(orgId);
    if (!org) {
      throw new AppError(404, 'Organização não encontrada.');
    }
    return await this.orgRepo.listOrganizationMembers(orgId);
  }

  async addOrganizationAdmin(
    orgId: string,
    targetUserId: string,
    actorUserId: string
  ): Promise<OrganizationMemberRecord> {
    return await this.orgRepo.addOrganizationMember(orgId, targetUserId, actorUserId);
  }

  async removeOrganizationAdmin(
    orgId: string,
    targetUserId: string,
    actorUserId: string
  ): Promise<void> {
    await this.orgRepo.removeOrganizationMember(orgId, targetUserId, actorUserId);
  }

  async lazyProvisionForMinistry(
    ministryId: string,
    actorUserId: string
  ): Promise<OrganizationRecord> {
    return await this.orgRepo.lazyProvisionForMinistry(ministryId, actorUserId);
  }

  async attachMinistry(
    orgId: string,
    ministryId: string,
    actorUserId: string
  ): Promise<void> {
    await this.orgRepo.linkMinistryToOrganization(orgId, ministryId, actorUserId);
  }

  async detachMinistry(
    orgId: string,
    ministryId: string,
    actorUserId: string
  ): Promise<void> {
    await this.orgRepo.detachMinistryFromOrganization(orgId, ministryId, actorUserId);
  }

  async getWhatsAppCapacity(orgId: string): Promise<OrganizationWhatsAppCapacity> {
    return await this.subscriptionService.getOrganizationWhatsAppCapacity(orgId);
  }
}
