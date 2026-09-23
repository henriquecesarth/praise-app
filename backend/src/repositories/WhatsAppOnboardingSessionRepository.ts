import { db } from '../lib/firebase';
import {
  WhatsAppOnboardingSessionRecord,
  WhatsAppProviderProgress,
} from '../features/whatsapp/whatsapp.types';

export const PROVIDER_PROGRESS_RANK: Record<WhatsAppProviderProgress, number> = {
  none: 0,
  credential_staged: 1,
  assets_verified: 2,
  phone_registered: 3,
  waba_subscribed: 4,
};

export class WhatsAppOnboardingSessionRepository {
  private readonly sessionsCol = db.collection('whatsapp_onboarding_sessions');

  async getSessionById(sessionId: string): Promise<WhatsAppOnboardingSessionRecord | null> {
    const doc = await this.sessionsCol.doc(sessionId).get();
    if (!doc.exists) {
      return null;
    }
    const session = { id: doc.id, ...doc.data() } as WhatsAppOnboardingSessionRecord;
    // DEC-7D-45: Logical 30-day retention enforcement
    if (session.retention_expires_at && new Date(session.retention_expires_at) <= new Date()) {
      return null;
    }
    return session;
  }

  async createSession(
    session: WhatsAppOnboardingSessionRecord,
    tx?: FirebaseFirestore.Transaction
  ): Promise<void> {
    const docRef = this.sessionsCol.doc(session.id);
    if (tx) {
      tx.set(docRef, session);
    } else {
      await docRef.set(session);
    }
  }

  async updateSession(
    sessionId: string,
    data: Partial<WhatsAppOnboardingSessionRecord>,
    tx?: FirebaseFirestore.Transaction
  ): Promise<void> {
    const docRef = this.sessionsCol.doc(sessionId);
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

  async updateProgressMonotonically(
    sessionId: string,
    newProgress: WhatsAppProviderProgress,
    additionalUpdates?: Partial<WhatsAppOnboardingSessionRecord>,
    existingTx?: FirebaseFirestore.Transaction
  ): Promise<WhatsAppOnboardingSessionRecord | null> {
    const handler = async (tx: FirebaseFirestore.Transaction) => {
      const docRef = this.sessionsCol.doc(sessionId);
      const doc = await tx.get(docRef);
      if (!doc.exists) {
        return null;
      }
      const session = doc.data() as WhatsAppOnboardingSessionRecord;
      const currentProgress = session.provider_progress || 'none';
      const currentRank = PROVIDER_PROGRESS_RANK[currentProgress] ?? 0;
      const targetRank = PROVIDER_PROGRESS_RANK[newProgress] ?? 0;

      // Monotonicity: never regress provider_progress
      const finalProgress = currentRank > targetRank ? currentProgress : newProgress;

      const now = new Date().toISOString();
      const updatePayload: Partial<WhatsAppOnboardingSessionRecord> = {
        ...additionalUpdates,
        provider_progress: finalProgress,
        updated_at: now,
      };

      if (session.status === 'consumed' && additionalUpdates?.status && additionalUpdates.status !== 'consumed') {
        delete updatePayload.status;
      }

      tx.update(docRef, updatePayload);
      return {
        ...session,
        ...updatePayload,
      };
    };

    if (existingTx) {
      return await handler(existingTx);
    }
    return await db.runTransaction(handler);
  }
}
