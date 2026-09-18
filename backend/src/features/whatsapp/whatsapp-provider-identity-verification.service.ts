import { AppError } from '../../middleware/error-handler';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import {
  getClaimId,
  getZernioAccountClaimId,
  getZernioPhoneClaimId,
  normalizeToE164,
  WhatsAppConnectionRecord,
  WhatsAppProviderIdentityClaimRecord,
} from './whatsapp.types';

export class WhatsAppProviderIdentityVerificationService {
  constructor(
    private readonly claimRepo: WhatsAppProviderIdentityClaimRepository = new WhatsAppProviderIdentityClaimRepository()
  ) {}

  async verifyProviderIdentityClaims(params: {
    connection: WhatsAppConnectionRecord;
    organizationId: string;
    transaction?: FirebaseFirestore.Transaction;
  }): Promise<void> {
    const { connection, organizationId, transaction } = params;
    if (connection.organization_id !== organizationId) {
      this.throwInvalidClaim();
    }

    if (connection.provider === 'meta_cloud_api') {
      const providerPhoneNumberId = connection.provider_phone_number_id?.trim();
      if (!providerPhoneNumberId) {
        this.throwInvalidClaim();
      }

      const claim = await this.getClaim(getClaimId('meta_cloud_api', providerPhoneNumberId), transaction);
      this.assertClaimOwner({
        claim,
        provider: 'meta_cloud_api',
        providerIdentity: providerPhoneNumberId,
        organizationId,
        connectionId: connection.id,
      });
      return;
    }

    if (connection.provider === 'zernio') {
      const providerAccountId = connection.provider_account_id?.trim();
      if (!providerAccountId || !connection.phone_number) {
        this.throwInvalidClaim();
      }

      let canonicalPhoneNumber: string;
      let accountClaimId: string;
      let phoneClaimId: string;
      try {
        canonicalPhoneNumber = normalizeToE164(connection.phone_number);
        if (connection.phone_number !== canonicalPhoneNumber) {
          this.throwInvalidClaim();
        }
        accountClaimId = getZernioAccountClaimId(providerAccountId);
        phoneClaimId = getZernioPhoneClaimId(canonicalPhoneNumber);
      } catch {
        this.throwInvalidClaim();
      }

      const [accountClaim, phoneClaim] = await Promise.all([
        this.getClaim(accountClaimId!, transaction),
        this.getClaim(phoneClaimId!, transaction),
      ]);
      this.assertClaimOwner({
        claim: accountClaim,
        provider: 'zernio',
        providerIdentity: providerAccountId,
        organizationId,
        connectionId: connection.id,
      });
      this.assertClaimOwner({
        claim: phoneClaim,
        provider: 'zernio',
        providerIdentity: canonicalPhoneNumber!,
        organizationId,
        connectionId: connection.id,
      });
      return;
    }

    this.throwInvalidClaim();
  }

  private async getClaim(
    claimId: string,
    transaction?: FirebaseFirestore.Transaction
  ): Promise<WhatsAppProviderIdentityClaimRecord | null> {
    if (transaction) {
      return this.claimRepo.getClaimInTransaction(transaction, claimId);
    }
    return this.claimRepo.getClaim(claimId);
  }

  private assertClaimOwner(params: {
    claim: WhatsAppProviderIdentityClaimRecord | null;
    provider: WhatsAppConnectionRecord['provider'];
    providerIdentity: string;
    organizationId: string;
    connectionId: string;
  }): void {
    const { claim, provider, providerIdentity, organizationId, connectionId } = params;
    if (
      !claim ||
      claim.provider !== provider ||
      claim.provider_phone_number_id !== providerIdentity ||
      claim.organization_id !== organizationId ||
      claim.connection_id !== connectionId
    ) {
      this.throwInvalidClaim();
    }
  }

  private throwInvalidClaim(): never {
    throw new AppError(400, 'Claim de identidade do provedor inválido ou ausente.', {
      code: 'INVALID_PROVIDER_CLAIM',
    });
  }
}
