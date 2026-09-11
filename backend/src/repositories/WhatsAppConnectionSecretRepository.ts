import { db } from '../lib/firebase';
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
      tx.delete(docRef);
    } else {
      await docRef.delete();
    }
  }
}
