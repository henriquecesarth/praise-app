import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import { WhatsAppConnectionSecretRecord } from '../features/whatsapp/whatsapp.types';

export class WhatsAppConnectionSecretRepository {
  private readonly secretsCol = db.collection('whatsapp_connection_secrets');

  async getSecret(orgId: string, connectionId: string): Promise<WhatsAppConnectionSecretRecord | null> {
    const doc = await this.secretsCol.doc(connectionId).get();
    if (!doc.exists) {
      return null;
    }
    const data = doc.data() as WhatsAppConnectionSecretRecord;
    // Cumulative tenancy guard
    if (data.organization_id !== orgId) {
      return null;
    }
    return { ...data, id: doc.id };
  }

  async setSecret(
    secret: WhatsAppConnectionSecretRecord,
    tx?: FirebaseFirestore.Transaction
  ): Promise<void> {
    const docRef = this.secretsCol.doc(secret.connection_id);
    if (tx) {
      tx.set(docRef, secret);
    } else {
      await docRef.set(secret);
    }
  }

  async deleteSecret(
    orgId: string,
    connectionId: string,
    tx?: FirebaseFirestore.Transaction
  ): Promise<void> {
    const docRef = this.secretsCol.doc(connectionId);
    if (tx) {
      const doc = await tx.get(docRef);
      if (!doc.exists) {
        return;
      }
      const data = doc.data() as WhatsAppConnectionSecretRecord;
      if (data.organization_id !== orgId) {
        throw new AppError(404, 'Secret não encontrado nesta organização.');
      }
      tx.delete(docRef);
    } else {
      await db.runTransaction(async (t) => {
        const doc = await t.get(docRef);
        if (!doc.exists) {
          return;
        }
        const data = doc.data() as WhatsAppConnectionSecretRecord;
        if (data.organization_id !== orgId) {
          throw new AppError(404, 'Secret não encontrado nesta organização.');
        }
        t.delete(docRef);
      });
    }
  }
}
