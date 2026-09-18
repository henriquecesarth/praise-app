import crypto from 'crypto';
import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import {
  WhatsAppOutboundDispatchRecord,
  WhatsAppOutboundDispatchStatus,
  WhatsAppZernioProviderMessageRecord,
  WhatsAppZernioProviderMessageStatus,
  AcquireDispatchExecutionParams,
  AcquireDispatchExecutionResult,
  buildZernioProviderMessageDocId,
} from '../features/whatsapp/zernio.types';
import { OrganizationRecord } from '../features/organizations/organization.types';
import { MinistrySubscriptionRecord } from '../features/subscriptions/subscription.types';
import { WhatsAppConnectionRepository } from './WhatsAppConnectionRepository';
import {
  evaluateWhatsAppCommercialEntitlement,
} from '../features/subscriptions/whatsapp-commercial-evaluator';

export interface PrepareDispatchParams {
  id: string;
  organizationId: string;
  ministryId?: string | null;
  connectionId: string;
  providerAccountId: string;
  recipientE164: string;
  recipientParticipantId: string;
  dispatchKind: 'proactive_template' | 'existing_conversation_text';
  templateName?: string | null;
  templateLanguage?: string | null;
  templateParams?: unknown[] | Record<string, unknown> | null;
  messageText?: string | null;
  requestFingerprint: string;
  providerIdempotencyKey?: string | null;
}

export interface RecordMessageLifecycleEventParams {
  providerMessageId: string;
  providerAccountId: string;
  organizationId?: string | null;
  connectionId?: string | null;
  eventType: 'message.sent' | 'message.delivered' | 'message.read' | 'message.failed';
  conversationId?: string;
  timestamp?: string | number;
  error?: {
    code?: string | number;
    message?: string;
    details?: unknown;
  };
}

export class WhatsAppOutboundDispatchRepository {
  private readonly dispatchesCol = db.collection('whatsapp_outbound_dispatches');
  private readonly providerMessagesCol = db.collection('whatsapp_zernio_provider_messages');
  private readonly organizationsCol = db.collection('organizations');
  private readonly ministriesCol = db.collection('ministries');
  private readonly subscriptionsCol = db.collection('ministry_subscriptions');
  private readonly connectionsCol = db.collection('whatsapp_connections');
  private readonly connectionRepo = new WhatsAppConnectionRepository();

  async getDispatchById(id: string): Promise<WhatsAppOutboundDispatchRecord | null> {
    const cleanId = id?.trim();
    if (!cleanId) return null;
    const doc = await this.dispatchesCol.doc(cleanId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as WhatsAppOutboundDispatchRecord;
  }

  async getProviderMessageShadow(
    id: string
  ): Promise<WhatsAppZernioProviderMessageRecord | null> {
    const cleanId = id?.trim();
    if (!cleanId) return null;
    const doc = await this.providerMessagesCol.doc(cleanId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as WhatsAppZernioProviderMessageRecord;
  }

  async prepareDispatch(
    params: PrepareDispatchParams
  ): Promise<{ record: WhatsAppOutboundDispatchRecord; isExisting: boolean }> {
    const cleanId = params.id.trim();
    if (!cleanId) {
      throw new AppError(400, 'dispatchId é obrigatório para registrar despacho.');
    }
    const docRef = this.dispatchesCol.doc(cleanId);

    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const nowIso = new Date().toISOString();

      if (snap.exists) {
        const existing = snap.data() as WhatsAppOutboundDispatchRecord;
        if (existing.organization_id !== params.organizationId) {
          throw new AppError(
            403,
            'FORBIDDEN_DISPATCH_TENANT_MISMATCH: Despacho pertence a outra organização.',
            {
              code: 'FORBIDDEN_DISPATCH_TENANT_MISMATCH',
              dispatchId: cleanId,
            }
          );
        }
        if (params.connectionId && existing.connection_id !== params.connectionId) {
          throw new AppError(
            403,
            'FORBIDDEN_DISPATCH_CONNECTION_MISMATCH: Despacho pertence a outra conexão.',
            {
              code: 'FORBIDDEN_DISPATCH_CONNECTION_MISMATCH',
              dispatchId: cleanId,
            }
          );
        }
        if (existing.request_fingerprint !== params.requestFingerprint) {
          throw new AppError(
            422,
            'DISPATCH_FINGERPRINT_MISMATCH: Tentativa de reutilizar dispatchId com parâmetros divergentes.',
            {
              code: 'DISPATCH_FINGERPRINT_MISMATCH',
              dispatchId: cleanId,
            }
          );
        }
        return { record: existing, isExisting: true };
      }

      const newRecord: WhatsAppOutboundDispatchRecord = {
        id: cleanId,
        organization_id: params.organizationId,
        ministry_id: params.ministryId || null,
        connection_id: params.connectionId,
        provider: 'zernio',
        provider_account_id: params.providerAccountId,
        recipient_e164: params.recipientE164,
        recipient_participant_id: params.recipientParticipantId,
        dispatch_kind: params.dispatchKind,
        template_name: params.templateName || null,
        template_language: params.templateLanguage || null,
        template_params: params.templateParams || null,
        message_text: params.messageText || null,
        request_fingerprint: params.requestFingerprint,
        provider_idempotency_key: params.providerIdempotencyKey || null,
        status: 'pending',
        phase: 'prepared',
        provider_conversation_id: null,
        provider_message_id: null,
        request_execution_id: null,
        request_lease_until: null,
        send_started_at: null,
        provider_accepted_at: null,
        delivered_at: null,
        read_at: null,
        failed_at: null,
        last_error_type: null,
        last_error_code: null,
        outcome_unknown_reason: null,
        created_at: nowIso,
        updated_at: nowIso,
      };

      tx.set(docRef, newRecord);
      return { record: newRecord, isExisting: false };
    });
  }

  async acquireDispatchExecution(
    params: AcquireDispatchExecutionParams
  ): Promise<AcquireDispatchExecutionResult> {
    const cleanId = params.dispatchId.trim();
    if (!cleanId) {
      throw new AppError(400, 'dispatchId é obrigatório para adquirir execução.');
    }
    const docRef = this.dispatchesCol.doc(cleanId);

    return await db.runTransaction(async (tx) => {
      // 1. ALL READS FIRST
      const snap = await tx.get(docRef);
      if (!snap.exists) {
        throw new AppError(404, `Despacho ${cleanId} não encontrado.`);
      }

      const existing = snap.data() as WhatsAppOutboundDispatchRecord;

      // 2. Validate tenant, connection, and request fingerprint
      if (existing.organization_id !== params.organizationId) {
        throw new AppError(
          403,
          'FORBIDDEN_DISPATCH_TENANT_MISMATCH: Despacho pertence a outra organização.',
          { code: 'FORBIDDEN_DISPATCH_TENANT_MISMATCH', dispatchId: cleanId }
        );
      }
      if (params.connectionId && existing.connection_id !== params.connectionId) {
        throw new AppError(
          403,
          'FORBIDDEN_DISPATCH_CONNECTION_MISMATCH: Despacho pertence a outra conexão.',
          { code: 'FORBIDDEN_DISPATCH_CONNECTION_MISMATCH', dispatchId: cleanId }
        );
      }
      if (existing.request_fingerprint !== params.requestFingerprint) {
        throw new AppError(
          422,
          'DISPATCH_FINGERPRINT_MISMATCH: Tentativa de reutilizar dispatchId com parâmetros divergentes.',
          { code: 'DISPATCH_FINGERPRINT_MISMATCH', dispatchId: cleanId }
        );
      }

      // 3. Inspect terminal or outcome_unknown states
      if (['accepted', 'delivered', 'read', 'failed'].includes(existing.status)) {
        return { outcome: 'terminal', record: existing };
      }
      if (existing.status === 'outcome_unknown' || existing.phase === 'completed') {
        return { outcome: 'outcome_unknown', record: existing };
      }

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      // 4. Inspect request_started phase (Active vs Expired Lease)
      if (existing.phase === 'request_started') {
        const leaseUntilMs = existing.request_lease_until
          ? new Date(existing.request_lease_until).getTime()
          : 0;

        if (leaseUntilMs > nowMs) {
          // Active lease held by another worker - leave untouched, return in_progress
          return { outcome: 'in_progress', record: existing };
        } else {
          // Expired lease! Original execution owner disappeared or hung.
          // Atomically converge to outcome_unknown and completed phase.
          // Lease expiration NEVER grants permission to send again.
          const updates: Partial<WhatsAppOutboundDispatchRecord> = {
            status: 'outcome_unknown',
            phase: 'completed',
            outcome_unknown_reason:
              'EXECUTION_LEASE_EXPIRED: O lease de execução expirou sem confirmação do provedor; resultado incerto impede reenvio automático.',
            updated_at: nowIso,
          };
          tx.update(docRef, updates);
          return {
            outcome: 'outcome_unknown',
            record: { ...existing, ...updates },
          };
        }
      }

      // 5. phase === 'prepared' -> Grant execution permission after linearizing commercial entitlement
      if (existing.phase === 'prepared') {
        // Read organization
        const orgDoc = await tx.get(this.organizationsCol.doc(existing.organization_id));
        if (!orgDoc.exists) {
          throw new AppError(404, 'Organização do despacho não encontrada.', {
            code: 'ORGANIZATION_NOT_FOUND',
          });
        }
        const org = { id: orgDoc.id, ...orgDoc.data() } as OrganizationRecord;

        // Read billing anchor ministry
        const anchorMinistryDoc = await tx.get(this.ministriesCol.doc(org.billing_anchor_ministry_id));
        if (!anchorMinistryDoc.exists) {
          throw new AppError(
            403,
            'COMMERCIAL_INTEGRITY_VIOLATION: Ministério âncora de faturamento não encontrado.',
            { code: 'COMMERCIAL_INTEGRITY_VIOLATION' }
          );
        }
        const anchorMinistry = { id: anchorMinistryDoc.id, ...anchorMinistryDoc.data() } as any;
        if (anchorMinistry.organization_id !== org.id) {
          throw new AppError(
            403,
            'COMMERCIAL_INTEGRITY_VIOLATION: Ministério âncora de faturamento não pertence à organização.',
            { code: 'COMMERCIAL_INTEGRITY_VIOLATION' }
          );
        }

        // Read subscription
        const subDoc = await tx.get(this.subscriptionsCol.doc(org.billing_anchor_ministry_id));
        const sub = subDoc.exists ? ({ id: subDoc.id, ...subDoc.data() } as MinistrySubscriptionRecord) : null;

        const txNow = new Date();
        const consumingCount = await this.connectionRepo.countConsumingConnections(org.id, txNow, tx);

        const entitlement = evaluateWhatsAppCommercialEntitlement({
          organization: org,
          anchorMinistry: { id: anchorMinistry.id, organization_id: anchorMinistry.organization_id },
          subscription: sub,
          consumingConnectionsCount: consumingCount,
          now: txNow,
        });

        if (!entitlement.canSendMessages) {
          throw new AppError(
            403,
            `COMMERCIAL_RESTRICTION: Envio não permitido pela assinatura (${entitlement.state}).`,
            {
              code: entitlement.restrictionReason || 'COMMERCIAL_RESTRICTION',
              commercialState: entitlement.state,
              organizationId: org.id,
              dispatchId: cleanId,
            }
          );
        }

        const leaseDurationMs = params.leaseDurationMs ?? 60000;
        const executionId = `exec_${crypto.randomBytes(16).toString('hex')}`;
        const leaseUntilIso = new Date(nowMs + leaseDurationMs).toISOString();

        const updates: Partial<WhatsAppOutboundDispatchRecord> = {
          phase: 'request_started',
          request_execution_id: executionId,
          request_lease_until: leaseUntilIso,
          send_started_at: existing.send_started_at || nowIso,
          updated_at: nowIso,
        };

        tx.update(docRef, updates);
        return {
          outcome: 'acquired',
          executionId,
          record: { ...existing, ...updates },
        };
      }

      return { outcome: 'terminal', record: existing };
    });
  }

  async markRequestStarted(dispatchId: string): Promise<void> {
    const cleanId = dispatchId.trim();
    const nowIso = new Date().toISOString();
    await this.dispatchesCol.doc(cleanId).update({
      phase: 'request_started',
      send_started_at: nowIso,
      updated_at: nowIso,
    });
  }

  async markAccepted(
    dispatchId: string,
    params: {
      providerMessageId: string;
      providerConversationId: string;
      executionId?: string;
    }
  ): Promise<WhatsAppOutboundDispatchRecord> {
    const cleanId = dispatchId.trim();
    const cleanMessageId = params.providerMessageId.trim();
    const cleanConvId = params.providerConversationId.trim();
    const shadowDocId = buildZernioProviderMessageDocId(cleanMessageId);

    const dispatchRef = this.dispatchesCol.doc(cleanId);
    const shadowRef = this.providerMessagesCol.doc(shadowDocId);

    return await db.runTransaction(async (tx) => {
      // 1. ALL READS FIRST
      const dispatchDoc = await tx.get(dispatchRef);
      if (!dispatchDoc.exists) {
        throw new AppError(404, `Despacho ${cleanId} não encontrado.`);
      }
      const dispatch = dispatchDoc.data() as WhatsAppOutboundDispatchRecord;
      const nowIso = new Date().toISOString();

      // Validate execution token if provided and active
      if (
        params.executionId &&
        dispatch.request_execution_id &&
        dispatch.request_execution_id !== params.executionId
      ) {
        throw new AppError(
          409,
          'WHATSAPP_EXECUTION_TOKEN_MISMATCH: O token de execução não corresponde ao executor registrado para o despacho.',
          { code: 'WHATSAPP_EXECUTION_TOKEN_MISMATCH', dispatchId: cleanId }
        );
      }

      const shadowDoc = await tx.get(shadowRef);
      let evolvedStatus: WhatsAppOutboundDispatchStatus = 'accepted';
      let deliveredAt: string | null = null;
      let readAt: string | null = null;
      let failedAt: string | null = null;

      if (shadowDoc.exists) {
        const shadow = shadowDoc.data() as WhatsAppZernioProviderMessageRecord;
        deliveredAt = shadow.delivered_at || null;
        readAt = shadow.read_at || null;
        failedAt = shadow.failed_at || null;

        if (shadow.read_at) {
          evolvedStatus = 'read';
        } else if (shadow.delivered_at) {
          evolvedStatus = 'delivered';
        } else if (shadow.failed_at) {
          evolvedStatus = 'failed';
        }

        // Link outbound_dispatch_id to existing shadow
        tx.update(shadowRef, {
          outbound_dispatch_id: cleanId,
          organization_id: dispatch.organization_id,
          connection_id: dispatch.connection_id,
          updated_at: nowIso,
        });
      } else {
        // Create initial shadow
        const initialShadow: WhatsAppZernioProviderMessageRecord = {
          id: shadowDocId,
          provider_message_id: cleanMessageId,
          provider_account_id: dispatch.provider_account_id,
          organization_id: dispatch.organization_id,
          connection_id: dispatch.connection_id,
          outbound_dispatch_id: cleanId,
          provider_conversation_id: cleanConvId,
          status: 'sent',
          sent_at: nowIso,
          delivered_at: null,
          read_at: null,
          failed_at: null,
          failure_code: null,
          failure_message: null,
          created_at: nowIso,
          updated_at: nowIso,
        };
        tx.set(shadowRef, initialShadow);
      }

      const updatedDispatch: WhatsAppOutboundDispatchRecord = {
        ...dispatch,
        status: evolvedStatus,
        phase: 'completed',
        provider_message_id: cleanMessageId,
        provider_conversation_id: cleanConvId,
        provider_accepted_at: dispatch.provider_accepted_at || nowIso,
        delivered_at: deliveredAt || dispatch.delivered_at,
        read_at: readAt || dispatch.read_at,
        failed_at: failedAt || dispatch.failed_at,
        outcome_unknown_reason: null, // Genuine provider 2xx clears outcome_unknown
        updated_at: nowIso,
      };

      tx.update(dispatchRef, {
        status: evolvedStatus,
        phase: 'completed',
        provider_message_id: cleanMessageId,
        provider_conversation_id: cleanConvId,
        provider_accepted_at: dispatch.provider_accepted_at || nowIso,
        delivered_at: deliveredAt || dispatch.delivered_at,
        read_at: readAt || dispatch.read_at,
        failed_at: failedAt || dispatch.failed_at,
        outcome_unknown_reason: null,
        updated_at: nowIso,
      });

      return updatedDispatch;
    });
  }

  async markFailed(
    dispatchId: string,
    error: { type?: string; code?: string; message?: string }
  ): Promise<void> {
    const cleanId = dispatchId.trim();
    const nowIso = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(this.dispatchesCol.doc(cleanId));
      if (!snap.exists) return;
      const data = snap.data() as WhatsAppOutboundDispatchRecord;
      // Do not overwrite confirmed delivery facts
      if (['accepted', 'delivered', 'read'].includes(data.status)) {
        return;
      }
      tx.update(this.dispatchesCol.doc(cleanId), {
        phase: 'completed',
        status: 'failed',
        failed_at: nowIso,
        last_error_type: error.type || 'send_error',
        last_error_code: error.code || 'SEND_FAILED',
        updated_at: nowIso,
      });
    });
  }

  async markOutcomeUnknown(dispatchId: string, reason: string): Promise<void> {
    const cleanId = dispatchId.trim();
    const nowIso = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(this.dispatchesCol.doc(cleanId));
      if (!snap.exists) return;
      const data = snap.data() as WhatsAppOutboundDispatchRecord;
      // Do not overwrite confirmed delivery facts
      if (['accepted', 'delivered', 'read'].includes(data.status)) {
        return;
      }
      tx.update(this.dispatchesCol.doc(cleanId), {
        phase: 'completed',
        status: 'outcome_unknown',
        outcome_unknown_reason: reason,
        updated_at: nowIso,
      });
    });
  }

  async recordProviderMessageLifecycleEvent(
    params: RecordMessageLifecycleEventParams
  ): Promise<{
    shadow: WhatsAppZernioProviderMessageRecord;
    linkedDispatchId?: string | null;
  }> {
    const cleanMessageId = params.providerMessageId.trim();
    const cleanAccountId = params.providerAccountId.trim();
    const shadowDocId = buildZernioProviderMessageDocId(cleanMessageId);
    const shadowRef = this.providerMessagesCol.doc(shadowDocId);

    return await db.runTransaction(async (tx) => {
      const nowIso = new Date().toISOString();
      const eventTimestampIso =
        params.timestamp !== undefined && params.timestamp !== null
          ? new Date(params.timestamp).toISOString()
          : nowIso;

      // 1. ALL READS FIRST
      const shadowDoc = await tx.get(shadowRef);
      let existing: WhatsAppZernioProviderMessageRecord | null = null;
      let linkedDispatchDoc: FirebaseFirestore.DocumentSnapshot | null = null;

      if (shadowDoc.exists) {
        existing = shadowDoc.data() as WhatsAppZernioProviderMessageRecord;

        // Verify account ID ownership match
        if (existing.provider_account_id && existing.provider_account_id !== cleanAccountId) {
          throw new AppError(
            400,
            'ZERNIO_ACCOUNT_MISMATCH: accountId do evento diverge do registrado para a mensagem.',
            {
              code: 'ZERNIO_ACCOUNT_MISMATCH',
              existingAccountId: existing.provider_account_id,
              incomingAccountId: cleanAccountId,
            }
          );
        }

        // Read linked dispatch document before any writes
        if (existing.outbound_dispatch_id) {
          const dispatchRef = this.dispatchesCol.doc(existing.outbound_dispatch_id);
          linkedDispatchDoc = await tx.get(dispatchRef);
        }
      }

      // 2. NOW ALL WRITES
      let shadowRecord: WhatsAppZernioProviderMessageRecord;
      let linkedDispatchId: string | null = null;

      if (!existing) {
        let initialStatus: WhatsAppZernioProviderMessageStatus = 'unknown';
        let sentAt: string | null = null;
        let deliveredAt: string | null = null;
        let readAt: string | null = null;
        let failedAt: string | null = null;

        if (params.eventType === 'message.sent') {
          initialStatus = 'sent';
          sentAt = eventTimestampIso;
        } else if (params.eventType === 'message.delivered') {
          initialStatus = 'delivered';
          deliveredAt = eventTimestampIso;
        } else if (params.eventType === 'message.read') {
          initialStatus = 'read';
          readAt = eventTimestampIso;
        } else if (params.eventType === 'message.failed') {
          initialStatus = 'failed';
          failedAt = eventTimestampIso;
        }

        shadowRecord = {
          id: shadowDocId,
          provider_message_id: cleanMessageId,
          provider_account_id: cleanAccountId,
          organization_id: params.organizationId || null,
          connection_id: params.connectionId || null,
          outbound_dispatch_id: null,
          provider_conversation_id: params.conversationId || null,
          status: initialStatus,
          sent_at: sentAt,
          delivered_at: deliveredAt,
          read_at: readAt,
          failed_at: failedAt,
          failure_code: params.error?.code ? String(params.error.code) : null,
          failure_message: params.error?.message || null,
          created_at: nowIso,
          updated_at: nowIso,
        };
        tx.set(shadowRef, shadowRecord);
      } else {
        linkedDispatchId = existing.outbound_dispatch_id || null;
        let newStatus = existing.status;
        const updates: Partial<WhatsAppZernioProviderMessageRecord> = {
          updated_at: nowIso,
        };

        if (params.eventType === 'message.sent') {
          updates.sent_at = existing.sent_at || eventTimestampIso;
          if (existing.status === 'unknown') {
            newStatus = 'sent';
          }
        } else if (params.eventType === 'message.delivered') {
          updates.delivered_at = existing.delivered_at || eventTimestampIso;
          if (existing.status !== 'read') {
            newStatus = 'delivered';
          }
        } else if (params.eventType === 'message.read') {
          updates.read_at = existing.read_at || eventTimestampIso;
          newStatus = 'read';
        } else if (params.eventType === 'message.failed') {
          updates.failed_at = existing.failed_at || eventTimestampIso;
          updates.failure_code = params.error?.code ? String(params.error.code) : existing.failure_code;
          updates.failure_message = params.error?.message || existing.failure_message;
          if (existing.status !== 'read' && existing.status !== 'delivered') {
            newStatus = 'failed';
          }
        }

        updates.status = newStatus;
        tx.update(shadowRef, updates);
        shadowRecord = { ...existing, ...updates };

        // If linked dispatch exists, update it monotonically
        if (linkedDispatchDoc && linkedDispatchDoc.exists) {
          const dispatch = linkedDispatchDoc.data() as WhatsAppOutboundDispatchRecord;
          const dispatchUpdates: Partial<WhatsAppOutboundDispatchRecord> = {
            updated_at: nowIso,
          };

          if (params.eventType === 'message.read') {
            dispatchUpdates.status = 'read';
            dispatchUpdates.read_at = dispatch.read_at || eventTimestampIso;
          } else if (params.eventType === 'message.delivered') {
            if (dispatch.status !== 'read') {
              dispatchUpdates.status = 'delivered';
            }
            dispatchUpdates.delivered_at = dispatch.delivered_at || eventTimestampIso;
          } else if (params.eventType === 'message.sent') {
            dispatchUpdates.send_started_at = dispatch.send_started_at || eventTimestampIso;
          } else if (params.eventType === 'message.failed') {
            if (dispatch.status !== 'read' && dispatch.status !== 'delivered') {
              dispatchUpdates.status = 'failed';
              dispatchUpdates.failed_at = dispatch.failed_at || eventTimestampIso;
              dispatchUpdates.last_error_code = params.error?.code
                ? String(params.error.code)
                : dispatch.last_error_code;
            }
          }

          tx.update(this.dispatchesCol.doc(existing.outbound_dispatch_id!), dispatchUpdates);
        }
      }

      return { shadow: shadowRecord, linkedDispatchId };
    });
  }
}
