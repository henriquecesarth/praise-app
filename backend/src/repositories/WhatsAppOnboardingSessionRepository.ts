import { db } from '../lib/firebase';
import { WhatsAppOnboardingSessionRecord } from '../features/whatsapp/whatsapp.types';

export class WhatsAppOnboardingSessionRepository {
  private readonly sessionsCol = db.collection('whatsapp_onboarding_sessions');

  async getSessionById(sessionId: string): Promise<WhatsAppOnboardingSessionRecord | null> {
    const doc = await this.sessionsCol.doc(sessionId).get();
    if (!doc.exists) {
      return null;
    }
    return { id: doc.id, ...doc.data() } as WhatsAppOnboardingSessionRecord;
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
}
