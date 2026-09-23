import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import {
  WhatsAppProviderIdentityClaimRecord,
  WhatsAppConnectionRecord,
  getZernioAccountClaimId,
  getZernioPhoneClaimId,
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

  async getClaimInTransaction(
    tx: FirebaseFirestore.Transaction,
    claimId: string
  ): Promise<WhatsAppProviderIdentityClaimRecord | null> {
    const doc = await tx.get(this.claimsCol.doc(claimId));
    if (!doc.exists) {
      return null;
    }
    return { id: doc.id, ...doc.data() } as WhatsAppProviderIdentityClaimRecord;
  }

  async getZernioAccountClaim(accountId: string): Promise<WhatsAppProviderIdentityClaimRecord | null> {
    return this.getClaim(getZernioAccountClaimId(accountId));
  }

  async getZernioPhoneClaim(phoneNumber: string): Promise<WhatsAppProviderIdentityClaimRecord | null> {
    return this.getClaim(getZernioPhoneClaimId(phoneNumber));
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
        // DEFECT 2 FIX: For ALL providers (Meta and Zernio), a claim owned by any
        // disconnected connection is NOT reclaimable. Claims must be released
        // atomically by strong settlement (finalizeMetaCleanupOnStrongSettlement for Meta,
        // settleZernioCleanupInTransaction for Zernio).
        // This eliminates the crash window where:
        //   - connection is disconnected
        //   - provider claim is released
        //   - NO durable cleanup owner exists
        //
        // Zernio claims: disconnected claim requires D7 strong settlement proof
        if (claim.provider === 'zernio' || existingClaim.provider === 'zernio') {
          const isAccountClaim =
            claim.id.startsWith('claim_zernio_account_') ||
            existingClaim.id.startsWith('claim_zernio_account_');
          if (isAccountClaim) {
            throw new AppError(
              409,
              'ZERNIO_ACCOUNT_ALREADY_REGISTERED: Esta conta Zernio já está vinculada a outra conexão.',
              { code: 'ZERNIO_ACCOUNT_ALREADY_REGISTERED' }
            );
          }
          throw new AppError(
            409,
              'PROVIDER_PHONE_ALREADY_REGISTERED: Este número de telefone já está registrado em outra conexão ativa.',
              { code: 'PROVIDER_PHONE_ALREADY_REGISTERED' }
            );
        }

        // Meta Cloud API: claim is retained for D7 cleanup strong settlement
        // The claim cannot be reclaimed by a new connection until finalizeMetaCleanupOnStrongSettlement()
        // is called, which verifies durable provider cleanup proof before releasing the claim.
        throw new AppError(
          409,
          'PROVIDER_PHONE_ALREADY_REGISTERED: Este número de telefone já está registrado em outra conexão ativa.',
          { code: 'PROVIDER_PHONE_ALREADY_REGISTERED' }
        );
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