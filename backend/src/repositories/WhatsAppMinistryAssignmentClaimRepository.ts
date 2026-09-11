import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import {
  WhatsAppMinistryAssignmentClaimRecord,
  WhatsAppConnectionRecord,
} from '../features/whatsapp/whatsapp.types';

export class WhatsAppMinistryAssignmentClaimRepository {
  private readonly claimsCol = db.collection('whatsapp_ministry_assignment_claims');
  private readonly connectionsCol = db.collection('whatsapp_connections');

  async getClaim(claimId: string): Promise<WhatsAppMinistryAssignmentClaimRecord | null> {
    const doc = await this.claimsCol.doc(claimId).get();
    if (!doc.exists) {
      return null;
    }
    return { id: doc.id, ...doc.data() } as WhatsAppMinistryAssignmentClaimRecord;
  }

  async acquireClaimInTransaction(
    tx: FirebaseFirestore.Transaction,
    claim: WhatsAppMinistryAssignmentClaimRecord
  ): Promise<void> {
    const claimRef = this.claimsCol.doc(claim.id);
    const claimDoc = await tx.get(claimRef);

    if (claimDoc.exists) {
      const existingClaim = claimDoc.data() as WhatsAppMinistryAssignmentClaimRecord;
      if (existingClaim.connection_id !== claim.connection_id) {
        // Read referenced connection to see if it is still live and assigned
        const connRef = this.connectionsCol.doc(existingClaim.connection_id);
        const connDoc = await tx.get(connRef);

        if (connDoc.exists) {
          const connData = connDoc.data() as WhatsAppConnectionRecord;
          if (
            connData.status !== 'disconnected' &&
            connData.assigned_ministry_id === claim.ministry_id
          ) {
            throw new AppError(
              409,
              'MINISTRY_ALREADY_HAS_EXCLUSIVE_CONNECTION: Este ministério já possui uma conexão WhatsApp atribuída.',
              { code: 'MINISTRY_ALREADY_HAS_EXCLUSIVE_CONNECTION' }
            );
          }
        }
      }
    }

    tx.set(claimRef, claim);
  }

  async releaseClaimInTransaction(
    tx: FirebaseFirestore.Transaction,
    claimId: string,
    expectedConnectionId?: string,
    expectedOrgId?: string,
    expectedMinistryId?: string
  ): Promise<void> {
    const claimRef = this.claimsCol.doc(claimId);
    const claimDoc = await tx.get(claimRef);
    if (!claimDoc.exists) {
      return;
    }
    const data = claimDoc.data() as WhatsAppMinistryAssignmentClaimRecord;
    if (expectedConnectionId && data.connection_id !== expectedConnectionId) {
      return;
    }
    if (expectedOrgId && data.organization_id !== expectedOrgId) {
      return;
    }
    if (expectedMinistryId && data.ministry_id !== expectedMinistryId) {
      return;
    }
    tx.delete(claimRef);
  }
}
