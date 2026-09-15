import dotenv from 'dotenv';
import { z } from 'zod';
import { AppError } from '../middleware/error-handler';

dotenv.config();

function sanitizePrivateKey(key?: string): string {
  if (!key) return '';
  // Trata quebras de linha em chaves privadas PEM vindas de variáveis de ambiente
  return key.replace(/\\n/g, '\n');
}

const DEFAULT_DEV_JWT_SECRET = 'praise-app-jwt-secret-key-change-in-production';

const configSchema = z.object({
  port: z.coerce.number().default(3000),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  jwtSecret: z.string().default(DEFAULT_DEV_JWT_SECRET),
  firebaseWebApiKey: z.string().optional(),
  corsOrigin: z.string().optional(),
  firebase: z.object({
    projectId: z.string().optional(),
    clientEmail: z.string().optional(),
    privateKey: z.string().optional(),
    databaseURL: z.string().optional(),
  }),
  defaultMinistryId: z.string().default('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
  platformAdminSecret: z.string().optional(),
  billingTimezone: z.string().default('America/Sao_Paulo'),
  billingReconciliationEnabled: z.boolean().default(true),
  billingReconciliationIntervalMinutes: z.coerce.number().default(15),
  webAppUrl: z.string().default('http://localhost:5173'),
  billingPublicApiUrl: z.string().optional(),
  whatsappTokenEncryptionKey: z.string().optional(),
  metaAppId: z.string().optional(),
  metaAppSecret: z.string().optional(),
  metaConfigId: z.string().optional(),
  metaGraphApiVersion: z.string().regex(/^v[0-9]+(\.[0-9]+)?$/).default('v26.0'),
  cronSecret: z.string().optional(),
  internalOperatorSecret: z.string().optional(),
  zernioApiKey: z.string().min(1).optional(),
  zernioWebhookSecret: z.string().min(1).optional(),
  asaas: z.object({
    apiUrl: z.string().default('https://sandbox.asaas.com/api/v3'),
    apiKey: z.string().optional(),
    webhookToken: z.string().optional(),
    environment: z.enum(['sandbox', 'production']).default('sandbox'),
  }),
}).refine((cfg) => {
  if (cfg.nodeEnv === 'production' && cfg.jwtSecret === DEFAULT_DEV_JWT_SECRET) {
    return false;
  }
  return true;
}, {
  message: 'JWT_SECRET inseguro detectado em ambiente de produção. Forneça uma chave secreta exclusiva via variável de ambiente.',
  path: ['jwtSecret'],
});

const rawConfig = {
  port: process.env.PORT,
  nodeEnv: process.env.NODE_ENV,
  jwtSecret: process.env.JWT_SECRET,
  firebaseWebApiKey: process.env.FIREBASE_WEB_API_KEY,
  corsOrigin: process.env.CORS_ORIGIN,
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: sanitizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  },
  defaultMinistryId: process.env.DEFAULT_MINISTRY_ID,
  platformAdminSecret: process.env.PLATFORM_ADMIN_SECRET,
  billingTimezone: process.env.BILLING_TIMEZONE || 'America/Sao_Paulo',
  billingReconciliationEnabled: process.env.BILLING_RECONCILIATION_ENABLED !== 'false' && process.env.NODE_ENV !== 'test',
  billingReconciliationIntervalMinutes: process.env.BILLING_RECONCILIATION_INTERVAL_MINUTES || 15,
  webAppUrl: process.env.WEB_APP_URL || 'http://localhost:5173',
  billingPublicApiUrl: process.env.BILLING_PUBLIC_API_URL,
  whatsappTokenEncryptionKey: process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY,
  metaAppId: process.env.META_APP_ID,
  metaAppSecret: process.env.META_APP_SECRET,
  metaConfigId: process.env.META_CONFIG_ID,
  metaGraphApiVersion: process.env.META_GRAPH_API_VERSION || 'v26.0',
  cronSecret: process.env.CRON_SECRET,
  internalOperatorSecret: process.env.INTERNAL_OPERATOR_SECRET,
  zernioApiKey: process.env.ZERNIO_API_KEY?.trim() || undefined,
  zernioWebhookSecret: process.env.ZERNIO_WEBHOOK_SECRET?.trim() || undefined,
  asaas: {
    apiUrl: process.env.ASAAS_API_URL || (process.env.ASAAS_ENVIRONMENT === 'production' ? 'https://api.asaas.com/v3' : 'https://sandbox.asaas.com/api/v3'),
    apiKey: process.env.ASAAS_API_KEY,
    webhookToken: process.env.ASAAS_WEBHOOK_TOKEN,
    environment: (process.env.ASAAS_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
  },
};

export const config = configSchema.parse(rawConfig);

export const ZERNIO_DEFAULT_BASE_URL = 'https://zernio.com/api/v1';

export function requireZernioApiKey(override?: string): string {
  const key = (override ?? config.zernioApiKey)?.trim();
  if (!key) {
    throw new AppError(500, 'ZERNIO_CONFIG_ERROR: ZERNIO_API_KEY não configurada no ambiente.', {
      code: 'ZERNIO_CONFIG_ERROR',
    });
  }
  return key;
}

export function requireZernioWebhookSecret(override?: string): string {
  const secret = (override ?? config.zernioWebhookSecret)?.trim();
  if (!secret) {
    throw new AppError(500, 'ZERNIO_CONFIG_ERROR: ZERNIO_WEBHOOK_SECRET não configurada no ambiente.', {
      code: 'ZERNIO_CONFIG_ERROR',
    });
  }
  return secret;
}


