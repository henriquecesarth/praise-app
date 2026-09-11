import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import {
  WhatsAppProviderIdentityClaimRecord,
  WhatsAppConnectionRecord,
} from '../features/whatsapp/whatsapp.types';

export class WhatsAppProviderIdentityClaimRepository {
  private readonly claimsCol = db.collection('whatsapp_provider_identity_claims');
  private readonly connectionsCol = db.collection('whatsapp_connections');

  async getClaim(claimId: string): Promise<WhatsAppProviderIdentityClaimRecord | null> {
    const doc = await this.claimsCol.doc(claimId).get();
    if (!doc.exists) {
      return null;
    }
    return { id: doc.id, ...doc.data() } as WhatsAppProviderIdentityClaimRecord;
  }

  async acquireClaimInTransaction(
    tx: FirebaseFirestore.Transaction,
    claim: WhatsAppProviderIdentityClaimRecord
  ): Promise<void> {
    const claimRef = this.claimsCol.doc(claim.id);
    const claimDoc = await tx.get(claimRef);

    if (claimDoc.exists) {
      const existingClaim = claimDoc.data() as WhatsAppProviderIdentityClaimRecord;
      if (existingClaim.connection_id !== claim.connection_id) {
        // Read referenced connection to see if it is still live
        const connRef = this.connectionsCol.doc(existingClaim.connection_id);
        const connDoc = await tx.get(connRef);

        if (connDoc.exists) {
          const connData = connDoc.data() as WhatsAppConnectionRecord;
          if (connData.status !== 'disconnected') {
            throw new AppError(
              409,
              'PROVIDER_PHONE_ALREADY_REGISTERED: Este número de telefone já está registrado em outra conexão ativa.',
              { code: 'PROVIDER_PHONE_ALREADY_REGISTERED' }
            );
          }
        }
      }
    }

    tx.set(claimRef, claim);
  }

  async releaseClaimInTransaction(
    tx: FirebaseFirestore.Transaction,
    claimId: string
  ): Promise<void> {
    const claimRef = this.claimsCol.doc(claimId);
    tx.delete(claimRef);
  }
}
