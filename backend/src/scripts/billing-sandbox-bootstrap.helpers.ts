import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import { execSync } from 'child_process';

export const ALLOWED_SANDBOX_HOSTNAMES = ['sandbox.asaas.com', 'api-sandbox.asaas.com'];

export const REQUIRED_WEBHOOK_EVENTS = [
  'CHECKOUT_CREATED',
  'CHECKOUT_PAID',
  'CHECKOUT_EXPIRED',
  'CHECKOUT_CANCELED',
  'PAYMENT_REFUNDED',
  'PAYMENT_CONFIRMED',
  'SUBSCRIPTION_UPDATED',
  'SUBSCRIPTION_INACTIVATED',
  'PAYMENT_DELETED',
  'PAYMENT_OVERDUE',
  'SUBSCRIPTION_DELETED',
  'SUBSCRIPTION_CREATED',
  'PAYMENT_RECEIVED',
];

/**
 * Validação estrita por URL parse do hostname e protocolo Sandbox do Asaas.
 * Bloqueia estritamente produção, lookalikes e protocolos não-HTTPS.
 */
export function isSandboxEnvironment(env: {
  asaasEnv?: string;
  apiUrl?: string;
  nodeEnv?: string;
}): boolean {
  if (env.nodeEnv === 'production') {
    return false;
  }
  if (env.asaasEnv !== 'sandbox') {
    return false;
  }
  if (!env.apiUrl || typeof env.apiUrl !== 'string') {
    return false;
  }

  try {
    const parsed = new URL(env.apiUrl);
    if (parsed.protocol !== 'https:') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_SANDBOX_HOSTNAMES.includes(hostname);
  } catch {
    return false;
  }
}

/**
 * Garante fail-closed se o ambiente for produção ou não-sandbox.
 */
export function assertSandboxEnvironment(env: {
  asaasEnv?: string;
  apiUrl?: string;
  nodeEnv?: string;
}): void {
  if (!isSandboxEnvironment(env)) {
    throw new Error(
      'PRODUCTION_ENVIRONMENT_BLOCKED: O script billing:sandbox só pode ser executado em ambiente Sandbox com hostname oficial (ex: sandbox.asaas.com). Abortando imediatamente para proteger recursos de produção.'
    );
  }
}

/**
 * Verifica se uma porta TCP está livre para uso local.
 */
export async function checkPortAvailable(port: number, host: string = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

/**
 * Constrói o objeto de variáveis de ambiente para o processo filho do backend com BILLING_PUBLIC_API_URL injetada.
 */
export function buildBackendChildEnv(
  baseEnv: NodeJS.ProcessEnv,
  publicUrl: string
): NodeJS.ProcessEnv {
  const cleanUrl = publicUrl.trim().replace(/\/+$/, '');
  return {
    ...baseEnv,
    BILLING_PUBLIC_API_URL: cleanUrl,
  };
}

/**
 * Extrai a URL HTTPS do Cloudflare Quick Tunnel a partir da saída de log do cloudflared.
 */
export function extractTrycloudflareUrl(text: string): string | null {
  if (!text || typeof text !== 'string') {
    return null;
  }
  const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
  return match ? match[0] : null;
}

/**
 * Valida se uma URL pertence estritamente ao domínio trycloudflare.com e usa HTTPS.
 */
export function isValidTrycloudflareUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  return /^https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com\/?$/.test(url.trim());
}

/**
 * Constrói a URL canônica de webhook para o Asaas a partir da URL base pública.
 */
export function formatWebhookUrl(publicBaseUrl: string): string {
  const clean = publicBaseUrl.trim().replace(/\/+$/, '');
  return `${clean}/api/v1/billing/webhooks/asaas`;
}

/**
 * Constrói as URLs canônicas de retorno de checkout para o gateway Asaas.
 */
export function getBillingCheckoutCallbacks(publicBaseUrl: string): {
  successUrl: string;
  cancelUrl: string;
  expiredUrl: string;
} {
  const clean = publicBaseUrl.trim().replace(/\/+$/, '');
  return {
    successUrl: `${clean}/api/v1/billing/checkout-return/success`,
    cancelUrl: `${clean}/api/v1/billing/checkout-return/cancel`,
    expiredUrl: `${clean}/api/v1/billing/checkout-return/expired`,
  };
}

/**
 * Monta o payload de sincronização do webhook do Asaas preservando configurações e lista de eventos existentes.
 */
export function buildWebhookSyncPayload(
  existingWebhook: {
    name?: string;
    email?: string;
    events?: string[];
    apiVersion?: number;
    sendType?: string;
  } | null | undefined,
  publicUrl: string,
  webhookToken?: string
): {
  name: string;
  url: string;
  email: string;
  authToken?: string;
  enabled: boolean;
  interrupted: boolean;
  apiVersion: number;
  sendType: string;
  events: string[];
} {
  const webhookUrl = formatWebhookUrl(publicUrl);
  const existingEvents = Array.isArray(existingWebhook?.events) ? existingWebhook!.events! : [];
  const mergedEvents = Array.from(new Set([...existingEvents, ...REQUIRED_WEBHOOK_EVENTS]));

  return {
    name: existingWebhook?.name || 'LouvAIO Sandbox Webhook',
    url: webhookUrl,
    email: existingWebhook?.email || 'dev@louvaio.local',
    ...(webhookToken ? { authToken: webhookToken } : {}),
    enabled: true,
    interrupted: false,
    apiVersion: existingWebhook?.apiVersion || 3,
    sendType: existingWebhook?.sendType || 'NON_SEQUENTIALLY',
    events: mergedEvents,
  };
}

/**
 * Atualiza ou adiciona a variável BILLING_PUBLIC_API_URL no conteúdo do arquivo .env preservando comentários e secrets.
 */
export function updateEnvContentBillingUrl(envContent: string, newPublicUrl: string): string {
  const cleanUrl = newPublicUrl.trim().replace(/\/+$/, '');
  const key = 'BILLING_PUBLIC_API_URL';
  const newLine = `${key}="${cleanUrl}"`;

  const regex = new RegExp(`^\\s*${key}=.*$`, 'm');
  if (regex.test(envContent)) {
    return envContent.replace(regex, newLine);
  }

  const endsWithNewline = envContent.endsWith('\n') || envContent.length === 0;
  return envContent + (endsWithNewline ? '' : '\n') + newLine + '\n';
}

/**
 * Localiza o executável do cloudflared na máquina local.
 */
export function findCloudflaredBinary(customPath?: string): string | null {
  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }

  const envPath = process.env.CLOUDFLARED_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  const isWindows = os.platform() === 'win32';
  const command = isWindows ? 'where.exe cloudflared' : 'which cloudflared';
  try {
    const stdout = execSync(command, { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    const firstLine = stdout.split(/\r?\n/)[0]?.trim();
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine;
    }
  } catch {}

  const home = os.homedir();
  const candidatePaths: string[] = isWindows
    ? [
        path.join(home, 'Downloads', 'cloudflared.exe'),
        path.join(home, 'AppData', 'Local', 'bin', 'cloudflared.exe'),
        path.join(home, 'bin', 'cloudflared.exe'),
        'C:\\Program Files\\cloudflared\\cloudflared.exe',
        'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
      ]
    : [
        path.join(home, 'Downloads', 'cloudflared'),
        path.join(home, 'bin', 'cloudflared'),
        path.join(home, '.local', 'bin', 'cloudflared'),
        '/usr/local/bin/cloudflared',
        '/opt/homebrew/bin/cloudflared',
      ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Sanitiza texto removendo quaisquer segredos conhecidos.
 */
export function sanitizeOutput(text: string, secrets: (string | undefined | null)[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) {
      result = result.split(secret).join('[REDACTED]');
    }
  }
  return result;
}
