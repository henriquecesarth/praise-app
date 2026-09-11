import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import crypto from 'crypto';
import {
  OrganizationRecord,
  OrganizationMemberRecord,
  OrganizationRole,
} from '../features/organizations/organization.types';
import { MinistryRecord } from './MinistryRepository';

export class OrganizationRepository {
  private readonly organizationsCol = db.collection('organizations');
  private readonly membersCol = db.collection('organization_members');
  private readonly ministriesCol = db.collection('ministries');
  private readonly ministryMembersCol = db.collection('ministry_members');
  private readonly usersCol = db.collection('users');

  async getOrganizationById(orgId: string): Promise<OrganizationRecord | null> {
    const doc = await this.organizationsCol.doc(orgId).get();
    if (!doc.exists) {
      return null;
    }
    return { id: doc.id, ...doc.data() } as OrganizationRecord;
  }

  async getOrganizationByMinistryId(ministryId: string): Promise<OrganizationRecord | null> {
    const minDoc = await this.ministriesCol.doc(ministryId).get();
    if (!minDoc.exists) {
      return null;
    }
    const minData = minDoc.data() as MinistryRecord;
    if (!minData.organization_id) {
      return null;
    }
    return this.getOrganizationById(minData.organization_id);
  }

  async getUserOrganizations(userId: string): Promise<Array<OrganizationRecord & { role: OrganizationRole }>> {
    const memberSnap = await this.membersCol.where('user_id', '==', userId).get();
    const result: Array<OrganizationRecord & { role: OrganizationRole }> = [];

    for (const doc of memberSnap.docs) {
      const memberData = doc.data() as OrganizationMemberRecord;
      const orgDoc = await this.organizationsCol.doc(memberData.organization_id).get();
      if (orgDoc.exists) {
        result.push({
          ...(orgDoc.data() as OrganizationRecord),
          id: orgDoc.id,
          role: memberData.role,
        });
      }
    }

    return result;
  }

  async getOrganizationMember(orgId: string, userId: string): Promise<OrganizationMemberRecord | null> {
    const docId = `${orgId}_${userId}`;
    const doc = await this.membersCol.doc(docId).get();
    if (doc.exists) {
      return { id: doc.id, ...doc.data() } as OrganizationMemberRecord;
    }

    // Query de fallback para compatibilidade
    const snap = await this.membersCol
      .where('organization_id', '==', orgId)
      .where('user_id', '==', userId)
      .limit(1)
      .get();

    if (!snap.empty) {
      const first = snap.docs[0];
      return { id: first.id, ...first.data() } as OrganizationMemberRecord;
    }

    return null;
  }

  async listOrganizationMembers(orgId: string): Promise<OrganizationMemberRecord[]> {
    const snap = await this.membersCol.where('organization_id', '==', orgId).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as OrganizationMemberRecord));
  }

  async addOrganizationMember(
    orgId: string,
    targetUserId: string,
    actorUserId: string
  ): Promise<OrganizationMemberRecord> {
    const org = await this.getOrganizationById(orgId);
    if (!org) {
      throw new AppError(404, 'Organização não encontrada.');
    }

    if (org.owner_user_id !== actorUserId) {
      throw new AppError(403, 'Apenas o proprietário da organização pode adicionar administradores.');
    }

    // Verificar existência do usuário
    const userDoc = await this.usersCol.doc(targetUserId).get();
    if (!userDoc.exists) {
      throw new AppError(404, 'Usuário não encontrado.');
    }

    const docId = `${orgId}_${targetUserId}`;
    const existing = await this.getOrganizationMember(orgId, targetUserId);
    if (existing) {
      if (existing.role === 'owner') {
        throw new AppError(400, 'O proprietário da organização já possui autoridade máxima.');
      }
      return existing; // Idempotente
    }

    const now = new Date().toISOString();
    const newMember: OrganizationMemberRecord = {
      id: docId,
      organization_id: orgId,
      user_id: targetUserId,
      role: 'admin',
      invited_by_user_id: actorUserId,
      created_at: now,
      updated_at: now,
    };

    await this.membersCol.doc(docId).set(newMember);
    return newMember;
  }

  async removeOrganizationMember(
    orgId: string,
    targetUserId: string,
    actorUserId: string
  ): Promise<void> {
    const org = await this.getOrganizationById(orgId);
    if (!org) {
      throw new AppError(404, 'Organização não encontrada.');
    }

    if (org.owner_user_id !== actorUserId) {
      throw new AppError(403, 'Apenas o proprietário da organização pode remover administradores.');
    }

    if (org.owner_user_id === targetUserId) {
      throw new AppError(400, 'O proprietário da organização não pode ser removido.', {
        code: 'OWNER_CANNOT_BE_REMOVED',
      });
    }

    const docId = `${orgId}_${targetUserId}`;
    await this.membersCol.doc(docId).delete();
  }

  async lazyProvisionForMinistry(
    ministryId: string,
    actorUserId: string
  ): Promise<OrganizationRecord> {
    return await db.runTransaction(async (transaction) => {
      const ministryRef = this.ministriesCol.doc(ministryId);
      const minDoc = await transaction.get(ministryRef);
      if (!minDoc.exists) {
        throw new AppError(404, 'Ministério não encontrado.');
      }
      const minData = minDoc.data() as MinistryRecord;

      // AUTORIDADE ESTRITA: Apenas o proprietário do ministério pode criar a organização
      if (minData.owner_user_id !== actorUserId) {
        throw new AppError(403, 'Apenas o proprietário do ministério pode criar a organização.', {
          code: 'ONLY_MINISTRY_OWNER_CAN_PROVISION_ORGANIZATION',
        });
      }

      // Idempotência: Se já vinculado, retorna a organização existente sem mutações colaterais
      if (minData.organization_id) {
        const existingOrgDoc = await transaction.get(this.organizationsCol.doc(minData.organization_id));
        if (existingOrgDoc.exists) {
          return { id: existingOrgDoc.id, ...existingOrgDoc.data() } as OrganizationRecord;
        }
      }

      const orgId = crypto.randomUUID();
      const now = new Date().toISOString();
      const newOrg: OrganizationRecord = {
        id: orgId,
        name: minData.name,
        slug: minData.slug || null,
        owner_user_id: minData.owner_user_id,
        billing_anchor_ministry_id: ministryId,
        default_whatsapp_connection_id: null,
        created_at: now,
        updated_at: now,
      };

      const ownerMember: OrganizationMemberRecord = {
        id: `${orgId}_${minData.owner_user_id}`,
        organization_id: orgId,
        user_id: minData.owner_user_id,
        role: 'owner',
        invited_by_user_id: null,
        created_at: now,
        updated_at: now,
      };

      transaction.set(this.organizationsCol.doc(orgId), newOrg);
      transaction.set(this.membersCol.doc(ownerMember.id), ownerMember);
      transaction.update(ministryRef, { organization_id: orgId, updated_at: now });

      return newOrg;
    });
  }

  async linkMinistryToOrganization(
    orgId: string,
    ministryId: string,
    actorUserId: string
  ): Promise<void> {
    return await db.runTransaction(async (transaction) => {
      const orgDoc = await transaction.get(this.organizationsCol.doc(orgId));
      if (!orgDoc.exists) {
        throw new AppError(404, 'Organização não encontrada.');
      }
      const orgData = orgDoc.data() as OrganizationRecord;

      // Verificar autoridade do ator na Organização: estritamente ORG_OWNER
      if (orgData.owner_user_id !== actorUserId) {
        throw new AppError(403, 'Ação restrita ao proprietário da organização.');
      }

      const minRef = this.ministriesCol.doc(ministryId);
      const minDoc = await transaction.get(minRef);
      if (!minDoc.exists) {
        throw new AppError(404, 'Ministério não encontrado.');
      }
      const minData = minDoc.data() as MinistryRecord;

      // Verificar autoridade do ator no ministério alvo: proprietário ou administrador
      const isMinistryOwner = minData.owner_user_id === actorUserId;
      let isMinistryAdmin = isMinistryOwner;
      if (!isMinistryAdmin) {
        const memberSnap = await this.ministryMembersCol
          .where('ministry_id', '==', ministryId)
          .where('user_id', '==', actorUserId)
          .limit(1)
          .get();
        if (!memberSnap.empty && memberSnap.docs[0].data().role === 'admin') {
          isMinistryAdmin = true;
        }
      }

      if (!isMinistryAdmin) {
        throw new AppError(403, 'Acesso negado. Você não é administrador do ministério alvo.');
      }

      // Invariante de Null Organization (DEC-7A-25-R2):
      // Apenas ministérios sem organização (organization_id == null) podem ser vinculados
      if (minData.organization_id) {
        throw new AppError(409, 'Este ministério já pertence a uma organização.', {
          code: 'MINISTRY_ALREADY_HAS_ORGANIZATION',
        });
      }

      const now = new Date().toISOString();
      transaction.update(minRef, { organization_id: orgId, updated_at: now });
    });
  }

  async detachMinistryFromOrganization(
    orgId: string,
    ministryId: string,
    actorUserId: string
  ): Promise<void> {
    return await db.runTransaction(async (transaction) => {
      const orgDoc = await transaction.get(this.organizationsCol.doc(orgId));
      if (!orgDoc.exists) {
        throw new AppError(404, 'Organização não encontrada.');
      }
      const orgData = orgDoc.data() as OrganizationRecord;

      // Apenas o ORG_OWNER pode desvincular
      if (orgData.owner_user_id !== actorUserId) {
        throw new AppError(403, 'Ação restrita ao proprietário da organização.');
      }

      // Proibido desvincular o ministério âncora de faturamento
      if (orgData.billing_anchor_ministry_id === ministryId) {
        throw new AppError(400, 'Não é permitido desvincular o ministério âncora de faturamento da organização.', {
          code: 'CANNOT_DETACH_BILLING_ANCHOR',
        });
      }

      const minRef = this.ministriesCol.doc(ministryId);
      const minDoc = await transaction.get(minRef);
      if (!minDoc.exists) {
        throw new AppError(404, 'Ministério não encontrado.');
      }
      const minData = minDoc.data() as MinistryRecord;

      if (minData.organization_id !== orgId) {
        throw new AppError(400, 'O ministério não pertence a esta organização.');
      }

      const now = new Date().toISOString();
      transaction.update(minRef, { organization_id: null, updated_at: now });
    });
  }
}
