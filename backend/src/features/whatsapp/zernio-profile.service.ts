import { AppError } from '../../middleware/error-handler';
import {
  ZernioProfile,
  EnsureProfileOptions,
  ZernioError,
  buildZernioProfileName,
  buildZernioProfileIdempotencyKey,
} from './zernio.types';
import { ZernioHttpClient } from './zernio-http-client';

export class ZernioProfileService {
  constructor(private readonly client: ZernioHttpClient = new ZernioHttpClient()) {}

  async ensureProfileForConnection(
    connectionId: string,
    options?: EnsureProfileOptions
  ): Promise<ZernioProfile> {
    const expectedName = buildZernioProfileName(connectionId);
    const idempotencyKey = buildZernioProfileIdempotencyKey(connectionId);
    const maxTimeoutRetries = options?.maxTimeoutRetries ?? 1;

    let candidateProfile: ZernioProfile | null = null;
    let attempts = 0;

    while (attempts <= maxTimeoutRetries) {
      attempts++;
      try {
        candidateProfile = await this.client.createProfile(
          { name: expectedName },
          {
            ...options,
            idempotencyKey,
          }
        );
        break;
      } catch (err: any) {
        // Network timeout retry with identical body and idempotency key
        if (err instanceof ZernioError && err.kind === 'TIMEOUT' && attempts <= maxTimeoutRetries) {
          if (options?.deadline && !options.deadline.hasRemaining(1_500)) {
            throw err;
          }
          continue;
        }

        // 409 Conflict handling
        if (err instanceof ZernioError && err.statusCode === 409) {
          return await this.recoverFromConflict(connectionId, expectedName, err, options);
        }

        // All other errors (including 422, 401, 402, 5xx) fail closed
        throw err;
      }
    }

    if (!candidateProfile) {
      throw new AppError(
        500,
        'ZERNIO_PROFILE_CREATION_FAILED: Falha inesperada ao obter perfil candidato.',
        {
          code: 'ZERNIO_PROFILE_CREATION_FAILED',
        }
      );
    }

    // Step 5: Verify the candidate profile via GET /profiles/{profileId}
    const verifiedProfile = await this.client.getProfile(candidateProfile._id, options);

    // Step 6: Assert returned profile._id == candidate profile ID and returned profile.name == expectedName
    if (verifiedProfile._id !== candidateProfile._id || verifiedProfile.name !== expectedName) {
      throw new AppError(
        409,
        'ZERNIO_PROFILE_IDENTITY_MISMATCH: Perfil verificado diverge da identidade esperada.',
        {
          code: 'ZERNIO_PROFILE_IDENTITY_MISMATCH',
          candidateId: candidateProfile._id,
          verifiedId: verifiedProfile._id,
          expectedName,
          verifiedName: verifiedProfile.name,
        }
      );
    }

    // Step 7: Return verified profile
    return verifiedProfile;
  }

  private async recoverFromConflict(
    _connectionId: string,
    expectedName: string,
    err: ZernioError,
    options?: EnsureProfileOptions
  ): Promise<ZernioProfile> {
    const isConflict = this.isProfileNameConflict(err);

    // Case A: IDEMPOTENCY KEY STILL IN FLIGHT
    if (!isConflict) {
      throw new AppError(
        409,
        'ZERNIO_OPERATION_IN_FLIGHT: A criação do perfil ainda está em processamento pelo provedor.',
        {
          code: 'ZERNIO_OPERATION_IN_FLIGHT',
          retryable: true,
        }
      );
    }

    // Case B: PROFILE NAME CONFLICT
    // Subcase B1: existingProfileId is available
    const existingProfileId = err.safeDetails?.existingProfileId as string | undefined;
    if (
      existingProfileId &&
      typeof existingProfileId === 'string' &&
      existingProfileId.trim().length > 0
    ) {
      const candidate = await this.client.getProfile(existingProfileId.trim(), options);
      if (candidate._id !== existingProfileId.trim() || candidate.name !== expectedName) {
        throw new AppError(
          409,
          'ZERNIO_PROFILE_IDENTITY_MISMATCH: O perfil existente possui nome ou ID divergente do esperado.',
          {
            code: 'ZERNIO_PROFILE_IDENTITY_MISMATCH',
          }
        );
      }
      return candidate;
    }

    // Subcase B2: existingProfileId is unavailable -> fallback to exact name lookup
    const lookupCandidate = await this.client.findProfileByExactName(expectedName, options);
    if (!lookupCandidate) {
      throw new AppError(
        404,
        'ZERNIO_PROFILE_RECOVERY_FAILED: Não foi possível localizar o perfil conflitante pelo nome.',
        {
          code: 'ZERNIO_PROFILE_RECOVERY_FAILED',
        }
      );
    }

    // Then GET the candidate by ID and verify again
    const verified = await this.client.getProfile(lookupCandidate._id, options);
    if (verified._id !== lookupCandidate._id || verified.name !== expectedName) {
      throw new AppError(
        409,
        'ZERNIO_PROFILE_IDENTITY_MISMATCH: O perfil recuperado diverge da identidade esperada.',
        {
          code: 'ZERNIO_PROFILE_IDENTITY_MISMATCH',
        }
      );
    }

    return verified;
  }

  private isProfileNameConflict(err: ZernioError): boolean {
    if (err.safeDetails?.existingProfileId) {
      return true;
    }
    const code = err.providerCode?.toLowerCase() || '';
    if (
      code.includes('profilenameconflict') ||
      code.includes('profile_name_conflict') ||
      code.includes('nameconflict')
    ) {
      return true;
    }
    const message = err.message.toLowerCase();
    if (
      message.includes('profile name conflict') ||
      message.includes('already exists with name') ||
      message.includes('name is already in use')
    ) {
      return true;
    }
    return false;
  }
}
