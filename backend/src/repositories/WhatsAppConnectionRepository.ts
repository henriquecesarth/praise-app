import { db } from '../lib/firebase';
import { FieldPath } from 'firebase-admin/firestore';
import { AppError } from '../middleware/error-handler';
import crypto from 'crypto';
import {
  WhatsAppConnectionRecord,
  WhatsAppConnectionStatus,
  CreateWhatsAppConnectionData,
  CONFIG_CONSUMING_STATUSES,
  getClaimId,
  getMinistryAssignmentClaimId,
  parseWhatsAppCursor,
} from '../features/whatsapp/whatsapp.types';
import { OrganizationRecord } from '../features/organizations/organization.types';

export class WhatsAppConnectionRepository {
  private readonly connectionsCol = db.collection('whatsapp_connections');
  private readonly organizationsCol = db.collection('organizations');
  private readonly claimsCol = db.collection('whatsapp_provider_identity_claims');
  private readonly assignmentClaimsCol = db.collection('whatsapp_ministry_assignment_claims');
  private readonly secretsCol = db.collection('whatsapp_connection_secrets');

  async getConnectionById(connectionId: string): Promise<WhatsAppConnectionRecord | null> {
    const doc = await this.connectionsCol.doc(connectionId).get();
    if (!doc.exists) {
      return null;
    }
    return { id: doc.id, ...doc.data() } as WhatsAppConnectionRecord;
  }

  async listConnectionsByOrganization(
    orgId: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<{ items: WhatsAppConnectionRecord[]; nextCursor: string | null }> {
    const pageSize = Math.min(Math.max(1, options?.limit ?? 25), 50);

    let query: FirebaseFirestore.Query = this.connectionsCol
      .where('organization_id', '==', orgId)
      .orderBy('created_at', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    if (options?.cursor) {
      const parsed = parseWhatsAppCursor(options.cursor);
      query = query.startAfter(parsed.createdAt, parsed.id);
    }

    // Lookahead: query pageSize + 1
    const snapshot = await query.limit(pageSize + 1).get();
    const hasMore = snapshot.docs.length > pageSize;
    const docsToReturn = snapshot.docs.slice(0, pageSize);

    const items = docsToReturn.map(
      (doc) => ({ id: doc.id, ...doc.data() } as WhatsAppConnectionRecord)
    );

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastDoc = docsToReturn[docsToReturn.length - 1];
      const lastItem = items[items.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ createdAt: lastItem.created_at, id: lastDoc.id })
      ).toString('base64url');
    }

    return { items, nextCursor };
  }

  async findAssignedConnectionForMinistry(
    orgId: string,
    ministryId: string
  ): Promise<WhatsAppConnectionRecord | null> {
    const snap = await this.connectionsCol
      .where('organization_id', '==', orgId)
      .where('assigned_ministry_id', '==', ministryId)
      .limit(1)
      .get();

    if (snap.empty) {
      return null;
    }

    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as WhatsAppConnectionRecord;
  }

  async countConfiguredConnections(orgId: string): Promise<number> {
    const baseQuery = this.connectionsCol
      .where('organization_id', '==', orgId)
      .where('status', 'in', CONFIG_CONSUMING_STATUSES);

    // Support aggregation count query
    if (typeof (baseQuery as any).count === 'function') {
      const snap = await (baseQuery as any).count().get();
      return snap.data().count;
    }

    const snap = await baseQuery.get();
    return snap.size;
  }

  async findByProviderPhoneNumberId(phoneId: string): Promise<WhatsAppConnectionRecord | null> {
    const snap = await this.connectionsCol
      .where('provider_phone_number_id', '==', phoneId)
      .limit(1)
      .get();

    if (snap.empty) {
      return null;
    }

    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as WhatsAppConnectionRecord;
  }

  async createConnection(data: CreateWhatsAppConnectionData): Promise<WhatsAppConnectionRecord> {
    const now = new Date().toISOString();
    const id = `wac_${crypto.randomBytes(12).toString('hex')}`;
    const status = data.status || 'pending';

    const pendingExpiresAt =
      status === 'pending'
        ? data.pending_expires_at || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : null;

    const record: WhatsAppConnectionRecord = {
      id,
      organization_id: data.organization_id,
      display_name: data.display_name,
      phone_number: data.phone_number || null,
      provider: 'meta_cloud_api',
      provider_waba_id: data.provider_waba_id || null,
      provider_phone_number_id: data.provider_phone_number_id || null,
      status,
      status_reason: data.status_reason || null,
      assigned_ministry_id: data.assigned_ministry_id || null,
      created_by_user_id: data.created_by_user_id,
      pending_expires_at: pendingExpiresAt,
      last_connected_at: data.last_connected_at || null,
      last_health_check_at: data.last_health_check_at || null,
      created_at: now,
      updated_at: now,
    };

    await this.connectionsCol.doc(id).set(record);
    return record;
  }

  async updateConnection(
    orgId: string,
    connectionId: string,
    data: Partial<WhatsAppConnectionRecord>,
    tx?: FirebaseFirestore.Transaction
  ): Promise<void> {
    const docRef = this.connectionsCol.doc(connectionId);
    const updatePayload = {
      ...data,
      updated_at: new Date().toISOString(),
    };

    if (tx) {
      tx.update(docRef, updatePayload);
    } else {
      await docRef.update(updatePayload);
    }
  }

  async setConnectionStatus(
    orgId: string,
    connectionId: string,
    status: WhatsAppConnectionStatus,
    reason?: string | null
  ): Promise<void> {
    const now = new Date().toISOString();
    const updatePayload: Partial<WhatsAppConnectionRecord> = {
      status,
      status_reason: reason || null,
      updated_at: now,
    };

    if (status === 'connected') {
      updatePayload.last_connected_at = now;
      updatePayload.pending_expires_at = null;
    } else if (status === 'disconnected') {
      updatePayload.pending_expires_at = null;
    }

    await this.connectionsCol.doc(connectionId).update(updatePayload);
  }

  async disconnectConnection(orgId: string, connectionId: string): Promise<void> {
    return await db.runTransaction(async (tx) => {
      const connRef = this.connectionsCol.doc(connectionId);
      const connDoc = await tx.get(connRef);
      if (!connDoc.exists) {
        throw new AppError(404, 'Conexão não encontrada.');
      }

      const conn = connDoc.data() as WhatsAppConnectionRecord;
      if (conn.organization_id !== orgId) {
        throw new AppError(404, 'Conexão não encontrada nesta organização.');
      }

      // Idempotency: if already disconnected, no-op
      if (conn.status === 'disconnected') {
        return;
      }

      // Read phase first (strictly before writes)
      const orgRef = this.organizationsCol.doc(orgId);
      const orgDoc = await tx.get(orgRef);

      let claimRef: FirebaseFirestore.DocumentReference | undefined;
      let claimDoc: FirebaseFirestore.DocumentSnapshot | undefined;
      if (conn.provider_phone_number_id) {
        const claimId = getClaimId(conn.provider, conn.provider_phone_number_id);
        claimRef = this.claimsCol.doc(claimId);
        claimDoc = await tx.get(claimRef);
      }

      let assignmentClaimRef: FirebaseFirestore.DocumentReference | undefined;
      let assignmentClaimDoc: FirebaseFirestore.DocumentSnapshot | undefined;
      if (conn.assigned_ministry_id) {
        const assignmentClaimId = getMinistryAssignmentClaimId(orgId, conn.assigned_ministry_id);
        assignmentClaimRef = this.assignmentClaimsCol.doc(assignmentClaimId);
        assignmentClaimDoc = await tx.get(assignmentClaimRef);
      }

      const secretRef = this.secretsCol.doc(connectionId);
      const secretDoc = await tx.get(secretRef);

      // Write phase
      const now = new Date().toISOString();

      if (orgDoc.exists) {
        const orgData = orgDoc.data() as OrganizationRecord;
        if (orgData.default_whatsapp_connection_id === connectionId) {
          tx.update(orgRef, {
            default_whatsapp_connection_id: null,
            updated_at: now,
          });
        }
      }

      tx.update(connRef, {
        status: 'disconnected',
        assigned_ministry_id: null,
        pending_expires_at: null,
        updated_at: now,
      });

      // Release provider claim IF AND ONLY IF owned by this connection
      if (
        claimRef &&
        claimDoc?.exists &&
        claimDoc.data()?.connection_id === connectionId &&
        claimDoc.data()?.organization_id === orgId &&
        claimDoc.data()?.provider_phone_number_id === conn.provider_phone_number_id
      ) {
        tx.delete(claimRef);
      }

      // Release assignment claim IF AND ONLY IF owned by this connection
      if (
        assignmentClaimRef &&
        assignmentClaimDoc?.exists &&
        assignmentClaimDoc.data()?.connection_id === connectionId &&
        assignmentClaimDoc.data()?.organization_id === orgId &&
        assignmentClaimDoc.data()?.ministry_id === conn.assigned_ministry_id
      ) {
        tx.delete(assignmentClaimRef);
      }

      // Delete secret IF AND ONLY IF owned by this connection
      if (
        secretDoc.exists &&
        secretDoc.data()?.organization_id === orgId &&
        secretDoc.data()?.connection_id === connectionId
      ) {
        tx.delete(secretRef);
      }
    });
  }
}
