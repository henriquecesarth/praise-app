import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import {
  WhatsAppOutboundDispatchRecord,
  WhatsAppOutboundDispatchStatus,
  WhatsAppZernioProviderMessageRecord,
  WhatsAppZernioProviderMessageStatus,
  buildZernioProviderMessageDocId,
} from '../features/whatsapp/zernio.types';

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
    params: { providerMessageId: string; providerConversationId: string }
  ): Promise<WhatsAppOutboundDispatchRecord> {
    const cleanId = dispatchId.trim();
    const cleanMessageId = params.providerMessageId.trim();
    const cleanConvId = params.providerConversationId.trim();
    const shadowDocId = buildZernioProviderMessageDocId(cleanMessageId);

    const dispatchRef = this.dispatchesCol.doc(cleanId);
    const shadowRef = this.providerMessagesCol.doc(shadowDocId);

    return await db.runTransaction(async (tx) => {
      const dispatchDoc = await tx.get(dispatchRef);
      if (!dispatchDoc.exists) {
        throw new AppError(404, `Despacho ${cleanId} não encontrado.`);
      }
      const dispatch = dispatchDoc.data() as WhatsAppOutboundDispatchRecord;
      const nowIso = new Date().toISOString();

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
        provider_accepted_at: nowIso,
        delivered_at: deliveredAt,
        read_at: readAt,
        failed_at: failedAt,
        updated_at: nowIso,
      };

      tx.update(dispatchRef, {
        status: evolvedStatus,
        phase: 'completed',
        provider_message_id: cleanMessageId,
        provider_conversation_id: cleanConvId,
        provider_accepted_at: nowIso,
        delivered_at: deliveredAt,
        read_at: readAt,
        failed_at: failedAt,
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
    await this.dispatchesCol.doc(cleanId).update({
      phase: 'completed',
      status: 'failed',
      failed_at: nowIso,
      last_error_type: error.type || 'send_error',
      last_error_code: error.code || 'SEND_FAILED',
      updated_at: nowIso,
    });
  }

  async markOutcomeUnknown(dispatchId: string, reason: string): Promise<void> {
    const cleanId = dispatchId.trim();
    const nowIso = new Date().toISOString();
    await this.dispatchesCol.doc(cleanId).update({
      phase: 'completed',
      status: 'outcome_unknown',
      outcome_unknown_reason: reason,
      updated_at: nowIso,
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
