import crypto from 'crypto';
import { AppError } from '../../middleware/error-handler';
import { ZernioHttpClient } from './zernio-http-client';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppOutboundDispatchRepository } from '../../repositories/WhatsAppOutboundDispatchRepository';
import { OrganizationRepository } from '../../repositories/OrganizationRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppProviderIdentityVerificationService } from './whatsapp-provider-identity-verification.service';
import {
  normalizeToE164,
  isProviderIdentityMaterialized,
  WhatsAppConnectionRecord,
} from './whatsapp.types';
import {
  formatZernioParticipantId,
  ZernioWhatsAppTemplate,
  WhatsAppOutboundDispatchRecord,
  ZernioError,
} from './zernio.types';

export class WhatsAppOutboundService {
  constructor(
    private readonly outboundRepo: WhatsAppOutboundDispatchRepository = new WhatsAppOutboundDispatchRepository(),
    private readonly connectionRepo: WhatsAppConnectionRepository = new WhatsAppConnectionRepository(),
    private readonly claimRepo: WhatsAppProviderIdentityClaimRepository = new WhatsAppProviderIdentityClaimRepository(),
    private readonly orgRepo: OrganizationRepository = new OrganizationRepository(),
    private readonly zernioClient: ZernioHttpClient = new ZernioHttpClient(),
    private readonly whatsappConnectionService: WhatsAppConnectionService = new WhatsAppConnectionService(),
    providerIdentityVerifier?: WhatsAppProviderIdentityVerificationService
  ) {
    this.providerIdentityVerifier = providerIdentityVerifier ?? new WhatsAppProviderIdentityVerificationService(claimRepo);
  }

  private readonly providerIdentityVerifier: WhatsAppProviderIdentityVerificationService;

  async verifyApprovedTemplate(params: {
    accountId: string;
    templateName: string;
    templateLanguage: string;
  }): Promise<ZernioWhatsAppTemplate> {
    const templates = await this.zernioClient.listWhatsAppTemplates({
      accountId: params.accountId,
      name: params.templateName,
      language: params.templateLanguage,
      status: 'APPROVED',
      limit: 5,
    });

    const matched = templates.find(
      (t) =>
        t.name === params.templateName &&
        t.language.toLowerCase() === params.templateLanguage.toLowerCase() &&
        t.status.toUpperCase() === 'APPROVED'
    );

    if (!matched) {
      throw new AppError(
        400,
        `TEMPLATE_NOT_APPROVED: Template '${params.templateName}' (${params.templateLanguage}) não encontrado ou não está APPROVED no Zernio.`,
        {
          code: 'TEMPLATE_NOT_APPROVED',
          templateName: params.templateName,
          templateLanguage: params.templateLanguage,
        }
      );
    }

    return matched;
  }

  async resolveSenderConnection(params: {
    ministryId?: string;
    organizationId?: string;
    connectionId?: string;
  }): Promise<WhatsAppConnectionRecord> {
    if (params.ministryId) {
      const resolution = await this.whatsappConnectionService.resolveWhatsAppConnection(params.ministryId);
      if (!resolution.success || !resolution.connection) {
        throw new AppError(
          400,
          'WHATSAPP_NO_SENDER_CONNECTION: Nenhuma conexão WhatsApp ativa disponível para o ministério.',
          { code: resolution.code || 'NO_CONNECTION_AVAILABLE' }
        );
      }
      return resolution.connection;
    }

    if (params.organizationId) {
      const org = await this.orgRepo.getOrganizationById(params.organizationId);
      if (!org) {
        throw new AppError(404, 'Organização não encontrada.');
      }

      const targetConnId = params.connectionId || org.default_whatsapp_connection_id;
      if (!targetConnId) {
        throw new AppError(
          400,
          'WHATSAPP_NO_SENDER_CONNECTION: Organização não possui conexão WhatsApp configurada.',
          { code: 'NO_CONNECTION_AVAILABLE' }
        );
      }

      const conn = await this.connectionRepo.getConnectionById(targetConnId);
      if (!conn || conn.organization_id !== params.organizationId) {
        throw new AppError(
          400,
          'WHATSAPP_NO_SENDER_CONNECTION: Conexão WhatsApp não encontrada na organização.',
          { code: 'NO_CONNECTION_AVAILABLE' }
        );
      }

      if (conn.status !== 'connected') {
        throw new AppError(
          400,
          'WHATSAPP_SENDER_NOT_ACTIVE: Conexão WhatsApp não está no status connected.',
          { code: 'CONNECTION_NOT_ACTIVE' }
        );
      }

      if (!isProviderIdentityMaterialized(conn)) {
        throw new AppError(
          400,
          'WHATSAPP_SENDER_NOT_MATERIALIZED: Identidade do provedor não materializada.',
          { code: 'CONNECTION_NOT_ACTIVE' }
        );
      }

      try {
        await this.providerIdentityVerifier.verifyProviderIdentityClaims({
          connection: conn,
          organizationId: params.organizationId,
        });
      } catch (err) {
        if (!(err instanceof AppError) || (err.details as { code?: string } | undefined)?.code !== 'INVALID_PROVIDER_CLAIM') {
          throw err;
        }
        throw new AppError(
          400,
          'WHATSAPP_CLAIM_INVALID: Claim da conexão inválido ou não pertence à organização.',
          { code: 'CONNECTION_NOT_ACTIVE' }
        );
      }

      const usage = await this.whatsappConnectionService.getOrganizationCapacityUsage(params.organizationId);
      if (!usage.canSendMessages) {
        const code =
          usage.connectionAccessMode === 'suspended'
            ? 'WHATSAPP_SUSPENDED'
            : usage.connectionAccessMode === 'restricted_over_limit'
            ? 'RESTRICTED_OVER_LIMIT'
            : 'WHATSAPP_SEND_RESTRICTED';
        throw new AppError(
          400,
          `WHATSAPP_SENDER_COMMERCIALLY_RESTRICTED: Envio de WhatsApp não autorizado pela assinatura (${code}).`,
          { code }
        );
      }

      return conn;
    }

    throw new AppError(400, 'ministryId ou organizationId deve ser fornecido para resolver o remetente.');
  }

  async sendProactiveTemplate(params: {
    dispatchId: string;
    ministryId?: string;
    organizationId?: string;
    connectionId?: string;
    recipientPhone: string;
    templateName: string;
    templateLanguage: string;
    templateParams?: unknown[] | Record<string, unknown>;
  }): Promise<WhatsAppOutboundDispatchRecord> {
    const cleanDispatchId = params.dispatchId?.trim();
    if (!cleanDispatchId) {
      throw new AppError(400, 'dispatchId é obrigatório.');
    }

    const recipientE164 = normalizeToE164(params.recipientPhone);
    const participantId = formatZernioParticipantId(recipientE164);

    const conn = await this.resolveSenderConnection(params);
    if (conn.provider !== 'zernio' || !conn.provider_account_id) {
      throw new AppError(400, 'Conexão resolvida não é um provedor Zernio válido com provider_account_id.');
    }

    // Step 1: Verify approved template
    await this.verifyApprovedTemplate({
      accountId: conn.provider_account_id,
      templateName: params.templateName,
      templateLanguage: params.templateLanguage,
    });

    // Step 2: Fingerprint calculation
    const requestFingerprint = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          accountId: conn.provider_account_id,
          recipient: participantId,
          templateName: params.templateName,
          templateLanguage: params.templateLanguage,
          templateParams: params.templateParams || null,
        })
      )
      .digest('hex');

    // Step 3: Prepare dispatch intent
    await this.outboundRepo.prepareDispatch({
      id: cleanDispatchId,
      organizationId: conn.organization_id,
      ministryId: params.ministryId || conn.assigned_ministry_id || null,
      connectionId: conn.id,
      providerAccountId: conn.provider_account_id,
      recipientE164,
      recipientParticipantId: participantId,
      dispatchKind: 'proactive_template',
      templateName: params.templateName,
      templateLanguage: params.templateLanguage,
      templateParams: params.templateParams,
      requestFingerprint,
    });

    // Step 4: Atomically acquire dispatch execution rights
    const acquisition = await this.outboundRepo.acquireDispatchExecution({
      dispatchId: cleanDispatchId,
      organizationId: conn.organization_id,
      requestFingerprint,
      connectionId: conn.id,
    });

    if (acquisition.outcome === 'terminal' || acquisition.outcome === 'outcome_unknown') {
      return acquisition.record;
    }

    if (acquisition.outcome === 'in_progress') {
      throw new AppError(
        409,
        'WHATSAPP_DISPATCH_IN_PROGRESS: O despacho já está em processamento por outra execução ativa.',
        {
          code: 'WHATSAPP_DISPATCH_IN_PROGRESS',
          dispatchId: cleanDispatchId,
        }
      );
    }

    // Step 5: Provider HTTP call (only when outcome === 'acquired')
    try {
      const response = await this.zernioClient.createWhatsAppTemplateConversation({
        accountId: conn.provider_account_id,
        participantId,
        templateName: params.templateName,
        templateLanguage: params.templateLanguage,
        templateParams: params.templateParams,
      });

      return await this.outboundRepo.markAccepted(cleanDispatchId, {
        providerMessageId: response.providerMessageId,
        providerConversationId: response.providerConversationId,
        executionId: acquisition.executionId,
      });
    } catch (err: any) {
      const isAmbiguous =
        err instanceof ZernioError &&
        (err.kind === 'TIMEOUT' ||
          err.statusCode === 500 ||
          err.statusCode === 502 ||
          err.statusCode === 503 ||
          err.statusCode === 504 ||
          err.kind === 'TRANSIENT_PROVIDER_ERROR');

      if (isAmbiguous) {
        await this.outboundRepo.markOutcomeUnknown(
          cleanDispatchId,
          `AMBIGUOUS_PROVIDER_SEND: ${err.message}`
        );
        throw new AppError(504, `WHATSAPP_SEND_OUTCOME_UNKNOWN: ${err.message}`, {
          code: 'WHATSAPP_SEND_OUTCOME_UNKNOWN',
          dispatchId: cleanDispatchId,
          originalError: err,
        });
      }

      const errCode = err?.providerCode || err?.code || 'SEND_FAILED';
      const errType = err?.providerType || 'provider_error';
      await this.outboundRepo.markFailed(cleanDispatchId, {
        type: errType,
        code: String(errCode),
        message: err.message,
      });
      throw err;
    }
  }

  async sendExistingConversationText(params: {
    dispatchId: string;
    conversationId: string;
    ministryId?: string;
    organizationId?: string;
    connectionId?: string;
    messageText: string;
  }): Promise<WhatsAppOutboundDispatchRecord> {
    const cleanDispatchId = params.dispatchId?.trim();
    if (!cleanDispatchId) {
      throw new AppError(400, 'dispatchId é obrigatório.');
    }

    const cleanConversationId = params.conversationId?.trim();
    if (!cleanConversationId) {
      throw new AppError(400, 'conversationId é obrigatório.');
    }

    const cleanMessageText = params.messageText?.trim();
    if (!cleanMessageText) {
      throw new AppError(400, 'messageText não pode ser vazio.');
    }

    const conn = await this.resolveSenderConnection(params);
    if (conn.provider !== 'zernio' || !conn.provider_account_id) {
      throw new AppError(400, 'Conexão resolvida não é um provedor Zernio válido com provider_account_id.');
    }

    const providerIdempotencyKey =
      'idemp_' + crypto.createHash('sha256').update(cleanDispatchId).digest('hex').substring(0, 32);

    const requestFingerprint = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          accountId: conn.provider_account_id,
          conversationId: cleanConversationId,
          messageText: cleanMessageText,
        })
      )
      .digest('hex');

    await this.outboundRepo.prepareDispatch({
      id: cleanDispatchId,
      organizationId: conn.organization_id,
      ministryId: params.ministryId || conn.assigned_ministry_id || null,
      connectionId: conn.id,
      providerAccountId: conn.provider_account_id,
      recipientE164: '',
      recipientParticipantId: '',
      dispatchKind: 'existing_conversation_text',
      messageText: cleanMessageText,
      requestFingerprint,
      providerIdempotencyKey,
    });

    const acquisition = await this.outboundRepo.acquireDispatchExecution({
      dispatchId: cleanDispatchId,
      organizationId: conn.organization_id,
      requestFingerprint,
      connectionId: conn.id,
    });

    if (acquisition.outcome === 'terminal' || acquisition.outcome === 'outcome_unknown') {
      return acquisition.record;
    }

    if (acquisition.outcome === 'in_progress') {
      throw new AppError(
        409,
        'WHATSAPP_DISPATCH_IN_PROGRESS: O despacho já está em processamento por outra execução ativa.',
        {
          code: 'WHATSAPP_DISPATCH_IN_PROGRESS',
          dispatchId: cleanDispatchId,
        }
      );
    }

    try {
      const response = await this.zernioClient.sendWhatsAppConversationMessage({
        conversationId: cleanConversationId,
        accountId: conn.provider_account_id,
        message: cleanMessageText,
        idempotencyKey: providerIdempotencyKey,
      });

      return await this.outboundRepo.markAccepted(cleanDispatchId, {
        providerMessageId: response.providerMessageId,
        providerConversationId: response.providerConversationId || cleanConversationId,
        executionId: acquisition.executionId,
      });
    } catch (err: any) {
      // Provider 409: Idempotency-Key still processing on provider side
      if (err instanceof ZernioError && (err.statusCode === 409 || err.kind === 'CONFLICT')) {
        await this.outboundRepo.markOutcomeUnknown(
          cleanDispatchId,
          `PROVIDER_IDEMPOTENCY_IN_FLIGHT: A chave de idempotência ainda está em processamento no provedor (HTTP 409).`
        );
        throw new AppError(
          409,
          `WHATSAPP_DISPATCH_PROVIDER_IN_FLIGHT: A mensagem ainda está em processamento no provedor.`,
          {
            code: 'WHATSAPP_DISPATCH_PROVIDER_IN_FLIGHT',
            dispatchId: cleanDispatchId,
            originalError: err,
          }
        );
      }

      const isAmbiguous =
        err instanceof ZernioError &&
        (err.kind === 'TIMEOUT' ||
          err.statusCode === 500 ||
          err.statusCode === 502 ||
          err.statusCode === 503 ||
          err.statusCode === 504 ||
          err.kind === 'TRANSIENT_PROVIDER_ERROR');

      if (isAmbiguous) {
        await this.outboundRepo.markOutcomeUnknown(
          cleanDispatchId,
          `AMBIGUOUS_EXISTING_CONVERSATION_SEND: ${err.message}`
        );
        throw new AppError(504, `WHATSAPP_SEND_OUTCOME_UNKNOWN: ${err.message}`, {
          code: 'WHATSAPP_SEND_OUTCOME_UNKNOWN',
          dispatchId: cleanDispatchId,
          originalError: err,
        });
      }

      const errCode = err?.providerCode || err?.code || 'SEND_FAILED';
      const errType = err?.providerType || 'provider_error';
      await this.outboundRepo.markFailed(cleanDispatchId, {
        type: errType,
        code: String(errCode),
        message: err.message,
      });
      throw err;
    }
  }
}
