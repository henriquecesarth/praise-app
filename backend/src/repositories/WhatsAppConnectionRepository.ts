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
  getZernioAccountClaimId,
  getZernioPhoneClaimId,
  normalizeToE164,
  BindZernioProfileInput,
  MaterializeZernioProviderIdentityInput,
  WhatsAppProviderIdentityClaimRecord,
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
    const data = doc.data() || {};
    return {
      id: doc.id,
      ...data,
      provider_profile_id: data.provider_profile_id ?? null,
      provider_account_id: data.provider_account_id ?? null,
    } as WhatsAppConnectionRecord;
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

  async createConnection(
    data: CreateWhatsAppConnectionData,
    tx?: FirebaseFirestore.Transaction
  ): Promise<WhatsAppConnectionRecord> {
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
      provider: data.provider || 'meta_cloud_api',
      provider_profile_id: data.provider_profile_id || null,
      provider_account_id: data.provider_account_id || null,
      provider_waba_id: data.provider_waba_id || null,
      provider_phone_number_id: data.provider_phone_number_id || null,
      status,
      status_reason: data.status_reason || null,
      assigned_ministry_id: data.assigned_ministry_id || null,
      created_by_user_id: data.created_by_user_id,
      current_onboarding_session_id: data.current_onboarding_session_id || null,
      pending_expires_at: pendingExpiresAt,
      last_connected_at: data.last_connected_at || null,
      last_health_check_at: data.last_health_check_at || null,
      created_at: now,
      updated_at: now,
    };

    if (tx) {
      tx.set(this.connectionsCol.doc(id), record);
    } else {
      await this.connectionsCol.doc(id).set(record);
    }
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

      // Release Meta provider claim IF AND ONLY IF owned by this connection
      if (
        claimRef &&
        claimDoc?.exists &&
        claimDoc.data()?.connection_id === connectionId &&
        claimDoc.data()?.organization_id === orgId &&
        claimDoc.data()?.provider_phone_number_id === conn.provider_phone_number_id
      ) {
        tx.delete(claimRef);
      }

      // Note: Zernio account and phone claims are intentionally retained upon local disconnect.
      // Remote cleanup must be strongly proven before Zernio claims can be released (D7).

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

  async findActivePlatformDependencies(
    providerWabaId: string,
    excludeConnectionId?: string
  ): Promise<WhatsAppConnectionRecord[]> {
    const snap = await this.connectionsCol
      .where('provider_waba_id', '==', providerWabaId)
      .where('status', 'in', ['pending', 'connecting', 'connected'])
      .get();

    const now = new Date();
    const active: WhatsAppConnectionRecord[] = [];

    for (const doc of snap.docs) {
      if (excludeConnectionId && doc.id === excludeConnectionId) {
        continue;
      }
      const conn = { id: doc.id, ...doc.data() } as WhatsAppConnectionRecord;
      if (conn.status === 'pending') {
        if (conn.pending_expires_at && new Date(conn.pending_expires_at) <= now) {
          continue; // expired pending does not count as active dependency
        }
      }
      active.push(conn);
    }

    return active;
  }

  async bindZernioProfileToConnection(
    params: BindZernioProfileInput,
    existingTx?: FirebaseFirestore.Transaction
  ): Promise<WhatsAppConnectionRecord> {
    const { organizationId, connectionId, providerProfileId } = params;

    const normalizedProfileId = providerProfileId?.trim();
    if (!normalizedProfileId) {
      throw new AppError(400, 'providerProfileId é obrigatório e não pode ser vazio.', {
        code: 'INVALID_PROFILE_ID',
      });
    }

    const runInTransaction = async (tx: FirebaseFirestore.Transaction) => {
      const connRef = this.connectionsCol.doc(connectionId);
      const connDoc = await tx.get(connRef);

      if (!connDoc.exists) {
        throw new AppError(404, 'Conexão não encontrada.');
      }

      const raw = connDoc.data() || {};
      const conn = {
        id: connDoc.id,
        ...raw,
        provider_profile_id: raw.provider_profile_id ?? null,
        provider_account_id: raw.provider_account_id ?? null,
      } as WhatsAppConnectionRecord;

      if (conn.organization_id !== organizationId) {
        throw new AppError(404, 'Conexão não encontrada nesta organização.');
      }

      if (conn.provider !== 'zernio') {
        throw new AppError(400, 'Esta conexão não pertence ao provedor Zernio.', {
          code: 'INVALID_PROVIDER',
        });
      }

      // Idempotency: if already bound to the exact same profile ID
      if (conn.provider_profile_id === normalizedProfileId) {
        return conn;
      }

      // Conflict: if already bound to a different profile ID
      if (conn.provider_profile_id && conn.provider_profile_id !== normalizedProfileId) {
        throw new AppError(
          409,
          'ZERNIO_PROFILE_ALREADY_BOUND: A conexão já possui outro perfil Zernio vinculado.',
          {
            code: 'ZERNIO_PROFILE_ALREADY_BOUND',
            currentProfileId: conn.provider_profile_id,
            requestedProfileId: normalizedProfileId,
          }
        );
      }

      const now = new Date().toISOString();
      tx.update(connRef, {
        provider_profile_id: normalizedProfileId,
        updated_at: now,
      });

      return {
        ...conn,
        provider_profile_id: normalizedProfileId,
        updated_at: now,
      };
    };

    if (existingTx) {
      return await runInTransaction(existingTx);
    }
    return await db.runTransaction(runInTransaction);
  }

  async materializeZernioProviderIdentity(
    params: MaterializeZernioProviderIdentityInput,
    existingTx?: FirebaseFirestore.Transaction
  ): Promise<WhatsAppConnectionRecord> {
    const { organizationId, connectionId, providerProfileId, providerAccountId, phoneNumber } = params;

    const normalizedProfileId = providerProfileId?.trim();
    if (!normalizedProfileId) {
      throw new AppError(400, 'providerProfileId é obrigatório e não pode ser vazio.', {
        code: 'INVALID_PROFILE_ID',
      });
    }

    const normalizedAccountId = providerAccountId?.trim();
    if (!normalizedAccountId) {
      throw new AppError(400, 'providerAccountId é obrigatório e não pode ser vazio.', {
        code: 'INVALID_ACCOUNT_ID',
      });
    }
    if (normalizedAccountId.includes('/')) {
      throw new AppError(400, 'providerAccountId não pode conter barra ("/").', {
        code: 'INVALID_ACCOUNT_ID',
      });
    }

    // Phone canonicalization via project-wide normalizeToE164
    const canonicalPhoneNumber = normalizeToE164(phoneNumber);

    const runInTransaction = async (tx: FirebaseFirestore.Transaction) => {
      // 1. Read Connection
      const connRef = this.connectionsCol.doc(connectionId);
      const connDoc = await tx.get(connRef);

      if (!connDoc.exists) {
        throw new AppError(404, 'Conexão não encontrada.');
      }

      const raw = connDoc.data() || {};
      const conn = {
        id: connDoc.id,
        ...raw,
        provider_profile_id: raw.provider_profile_id ?? null,
        provider_account_id: raw.provider_account_id ?? null,
      } as WhatsAppConnectionRecord;

      if (conn.organization_id !== organizationId) {
        throw new AppError(404, 'Conexão não encontrada nesta organização.');
      }

      if (conn.provider !== 'zernio') {
        throw new AppError(400, 'Esta conexão não pertence ao provedor Zernio.', {
          code: 'INVALID_PROVIDER',
        });
      }

      // Precondition: Profile must already be bound
      if (!conn.provider_profile_id) {
        throw new AppError(400, 'Conexão deve ter um perfil Zernio vinculado antes da materialização.', {
          code: 'ZERNIO_PROFILE_NOT_BOUND',
        });
      }

      if (conn.provider_profile_id !== normalizedProfileId) {
        throw new AppError(
          409,
          'ZERNIO_PROFILE_IDENTITY_MISMATCH: O perfil Zernio fornecido diverge do perfil vinculado à conexão.',
          {
            code: 'ZERNIO_PROFILE_IDENTITY_MISMATCH',
            boundProfileId: conn.provider_profile_id,
            suppliedProfileId: normalizedProfileId,
          }
        );
      }

      // Check existing connection account/phone values for conflict
      if (conn.provider_account_id && conn.provider_account_id !== normalizedAccountId) {
        throw new AppError(
          409,
          'ZERNIO_ACCOUNT_IDENTITY_MISMATCH: A conexão já possui outra conta Zernio materializada.',
          {
            code: 'ZERNIO_ACCOUNT_IDENTITY_MISMATCH',
            existingAccountId: conn.provider_account_id,
            suppliedAccountId: normalizedAccountId,
          }
        );
      }

      if (conn.phone_number && conn.phone_number !== canonicalPhoneNumber) {
        throw new AppError(
          409,
          'PROVIDER_PHONE_IDENTITY_MISMATCH: A conexão já possui outro número de telefone materializado.',
          {
            code: 'PROVIDER_PHONE_IDENTITY_MISMATCH',
            existingPhoneNumber: conn.phone_number,
            suppliedPhoneNumber: canonicalPhoneNumber,
          }
        );
      }

      // 2. Resolve Claim References & READ BOTH CLAIM DOCUMENTS BEFORE WRITES
      const accountClaimId = getZernioAccountClaimId(normalizedAccountId);
      const accountClaimRef = this.claimsCol.doc(accountClaimId);

      const phoneClaimId = getZernioPhoneClaimId(canonicalPhoneNumber);
      const phoneClaimRef = this.claimsCol.doc(phoneClaimId);

      const [accountClaimDoc, phoneClaimDoc] = await Promise.all([
        tx.get(accountClaimRef),
        tx.get(phoneClaimRef),
      ]);

      // 3. Verify Account Claim Ownership
      if (accountClaimDoc.exists) {
        const existingAccClaim = accountClaimDoc.data() as WhatsAppProviderIdentityClaimRecord;
        if (existingAccClaim.connection_id !== connectionId || existingAccClaim.organization_id !== organizationId) {
          throw new AppError(
            409,
            'ZERNIO_ACCOUNT_ALREADY_REGISTERED: Esta conta Zernio já está vinculada a outra conexão.',
            {
              code: 'ZERNIO_ACCOUNT_ALREADY_REGISTERED',
              claimedByConnectionId: existingAccClaim.connection_id,
            }
          );
        }
      }

      // 4. Verify Phone Claim Ownership
      if (phoneClaimDoc.exists) {
        const existingPhoneClaim = phoneClaimDoc.data() as WhatsAppProviderIdentityClaimRecord;
        if (existingPhoneClaim.connection_id !== connectionId || existingPhoneClaim.organization_id !== organizationId) {
          throw new AppError(
            409,
            'PROVIDER_PHONE_ALREADY_REGISTERED: Este número de telefone já está registrado em outra conexão ativa.',
            {
              code: 'PROVIDER_PHONE_ALREADY_REGISTERED',
              claimedByConnectionId: existingPhoneClaim.connection_id,
            }
          );
        }
      }

      // 5. Check Idempotency (Already fully materialized with both claims intact)
      const isAlreadyMaterialized =
        conn.provider_account_id === normalizedAccountId &&
        conn.phone_number === canonicalPhoneNumber &&
        accountClaimDoc.exists &&
        phoneClaimDoc.exists;

      if (isAlreadyMaterialized) {
        return conn;
      }

      // 6. Write Phase (Atomic reservation of both claims + connection update)
      const now = new Date().toISOString();

      if (!accountClaimDoc.exists) {
        const accountClaimRecord: WhatsAppProviderIdentityClaimRecord = {
          id: accountClaimId,
          provider: 'zernio',
          provider_phone_number_id: normalizedAccountId,
          organization_id: organizationId,
          connection_id: connectionId,
          created_at: now,
          updated_at: now,
        };
        tx.set(accountClaimRef, accountClaimRecord);
      }

      if (!phoneClaimDoc.exists) {
        const phoneClaimRecord: WhatsAppProviderIdentityClaimRecord = {
          id: phoneClaimId,
          provider: 'zernio',
          provider_phone_number_id: canonicalPhoneNumber,
          organization_id: organizationId,
          connection_id: connectionId,
          created_at: now,
          updated_at: now,
        };
        tx.set(phoneClaimRef, phoneClaimRecord);
      }

      tx.update(connRef, {
        provider_account_id: normalizedAccountId,
        phone_number: canonicalPhoneNumber,
        updated_at: now,
      });

      return {
        ...conn,
        provider_account_id: normalizedAccountId,
        phone_number: canonicalPhoneNumber,
        updated_at: now,
      };
    };

    if (existingTx) {
      return await runInTransaction(existingTx);
    }
    return await db.runTransaction(runInTransaction);
  }

  async findByZernioProfileId(
    profileId: string,
    orgId?: string
  ): Promise<WhatsAppConnectionRecord | null> {
    const cleanId = profileId?.trim();
    if (!cleanId) return null;

    // Single-field equality uses automatic indexing (no composite index required)
    const snap = await this.connectionsCol
      .where('provider_profile_id', '==', cleanId)
      .limit(2)
      .get();

    if (snap.empty) {
      return null;
    }
    if (snap.docs.length > 1) {
      throw new AppError(
        500,
        'AMBIGUOUS_ZERNIO_PROFILE_MAPPING: Múltiplas conexões encontradas para o mesmo perfil Zernio.',
        { code: 'AMBIGUOUS_ZERNIO_PROFILE_MAPPING' }
      );
    }

    const doc = snap.docs[0];
    const data = doc.data() || {};
    const record = {
      id: doc.id,
      ...data,
      provider_profile_id: data.provider_profile_id ?? null,
      provider_account_id: data.provider_account_id ?? null,
    } as WhatsAppConnectionRecord;

    if (record.provider !== 'zernio') {
      return null;
    }
    if (orgId && record.organization_id !== orgId) {
      return null;
    }
    return record;
  }

  async findByZernioAccountId(
    accountId: string,
    orgId?: string
  ): Promise<WhatsAppConnectionRecord | null> {
    const cleanId = accountId?.trim();
    if (!cleanId) return null;

    // Single-field equality uses automatic indexing (no composite index required)
    const snap = await this.connectionsCol
      .where('provider_account_id', '==', cleanId)
      .limit(2)
      .get();

    if (snap.empty) {
      return null;
    }
    if (snap.docs.length > 1) {
      throw new AppError(
        500,
        'AMBIGUOUS_ZERNIO_ACCOUNT_MAPPING: Múltiplas conexões encontradas para a mesma conta Zernio.',
        { code: 'AMBIGUOUS_ZERNIO_ACCOUNT_MAPPING' }
      );
    }

    const doc = snap.docs[0];
    const data = doc.data() || {};
    const record = {
      id: doc.id,
      ...data,
      provider_profile_id: data.provider_profile_id ?? null,
      provider_account_id: data.provider_account_id ?? null,
    } as WhatsAppConnectionRecord;

    if (record.provider !== 'zernio') {
      return null;
    }
    if (orgId && record.organization_id !== orgId) {
      return null;
    }
    return record;
  }
}
