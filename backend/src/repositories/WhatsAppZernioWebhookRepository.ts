import { db } from '../lib/firebase';
import {
  WhatsAppZernioWebhookEventRecord,
  buildZernioWebhookEventDocId,
} from '../features/whatsapp/zernio.types';

export interface AcquireZernioWebhookEventResult {
  shouldProcess: boolean;
  isDuplicate: boolean;
  isConcurrentLeaseActive: boolean;
  record: WhatsAppZernioWebhookEventRecord;
}

export class WhatsAppZernioWebhookRepository {
  private readonly webhookEventsCol = db.collection('whatsapp_zernio_webhook_events');

  async getEventById(docId: string): Promise<WhatsAppZernioWebhookEventRecord | null> {
    const doc = await this.webhookEventsCol.doc(docId).get();
    if (!doc.exists) {
      return null;
    }
    return { id: doc.id, ...doc.data() } as WhatsAppZernioWebhookEventRecord;
  }

  async getEventByEventId(eventId: string): Promise<WhatsAppZernioWebhookEventRecord | null> {
    const docId = buildZernioWebhookEventDocId(eventId);
    return this.getEventById(docId);
  }

  async acquireEvent(params: {
    eventId: string;
    eventType: string;
    payload?: Record<string, unknown>;
    leaseDurationMs?: number;
  }): Promise<AcquireZernioWebhookEventResult> {
    const { eventId, eventType, payload, leaseDurationMs = 60_000 } = params;
    const docId = buildZernioWebhookEventDocId(eventId);
    const docRef = this.webhookEventsCol.doc(docId);

    return await db.runTransaction(async (tx) => {
      const doc = await tx.get(docRef);
      const nowIso = new Date().toISOString();
      const leaseUntilIso = new Date(Date.now() + leaseDurationMs).toISOString();

      if (!doc.exists) {
        const record: WhatsAppZernioWebhookEventRecord = {
          id: docId,
          event_id: eventId,
          event_type: eventType,
          status: 'processing',
          payload: payload || {},
          processing_attempt_count: 1,
          lease_until: leaseUntilIso,
          received_at: nowIso,
          processed_at: null,
          error: null,
          created_at: nowIso,
          updated_at: nowIso,
        };
        tx.set(docRef, record);
        return {
          shouldProcess: true,
          isDuplicate: false,
          isConcurrentLeaseActive: false,
          record,
        };
      }

      const existing = doc.data() as WhatsAppZernioWebhookEventRecord;

      // 1. Terminal completed / ignored / terminal_error states -> strictly duplicate
      if (
        existing.status === 'processed' ||
        existing.status === 'ignored' ||
        existing.status === 'terminal_error'
      ) {
        return {
          shouldProcess: false,
          isDuplicate: true,
          isConcurrentLeaseActive: false,
          record: existing,
        };
      }

      // 2. Active processing with valid unexpired lease -> concurrent execution conflict
      if (existing.status === 'processing') {
        const isLeaseActive = existing.lease_until && new Date(existing.lease_until) > new Date();
        if (isLeaseActive) {
          return {
            shouldProcess: false,
            isDuplicate: false,
            isConcurrentLeaseActive: true,
            record: existing,
          };
        }
        // If lease is expired, allow takeover for retry
      }

      // 3. Status is retryable_error OR processing with expired lease -> allow retry
      const nextAttempt = (existing.processing_attempt_count || 1) + 1;
      const updated: WhatsAppZernioWebhookEventRecord = {
        ...existing,
        status: 'processing',
        processing_attempt_count: nextAttempt,
        lease_until: leaseUntilIso,
        updated_at: nowIso,
      };
      tx.update(docRef, {
        status: 'processing',
        processing_attempt_count: nextAttempt,
        lease_until: leaseUntilIso,
        updated_at: nowIso,
      });

      return {
        shouldProcess: true,
        isDuplicate: false,
        isConcurrentLeaseActive: false,
        record: updated,
      };
    });
  }

  async markEventProcessed(docId: string): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.webhookEventsCol.doc(docId).update({
      status: 'processed',
      processed_at: nowIso,
      lease_until: null,
      updated_at: nowIso,
    });
  }

  async markEventIgnored(docId: string, reason?: string): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.webhookEventsCol.doc(docId).update({
      status: 'ignored',
      processed_at: nowIso,
      lease_until: null,
      error: reason || null,
      updated_at: nowIso,
    });
  }

  async markEventTerminalError(docId: string, error: string): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.webhookEventsCol.doc(docId).update({
      status: 'terminal_error',
      processed_at: nowIso,
      lease_until: null,
      error: error || 'Terminal error',
      updated_at: nowIso,
    });
  }

  async markEventRetryableError(docId: string, error: string): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.webhookEventsCol.doc(docId).update({
      status: 'retryable_error',
      lease_until: null,
      error: error || 'Retryable error',
      updated_at: nowIso,
    });
  }
}
