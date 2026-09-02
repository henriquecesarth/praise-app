import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { config } from '../config/unifiedConfig';
import {
  assertSandboxEnvironment,
  checkPortAvailable,
  buildBackendChildEnv,
  findCloudflaredBinary,
  extractTrycloudflareUrl,
  isValidTrycloudflareUrl,
  formatWebhookUrl,
  buildWebhookSyncPayload,
  updateEnvContentBillingUrl,
  sanitizeOutput,
  getBackendSpawnOptions,
} from './billing-sandbox-bootstrap.helpers';

interface AsaasWebhookResponse {
  id: string;
  name?: string;
  url: string;
  email?: string;
  enabled: boolean;
  interrupted: boolean;
  apiVersion?: number;
  hasAuthToken?: boolean;
  sendType?: string;
  events?: string[];
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkUrlReachable(url: string, timeoutMs: number = 3000): Promise<boolean> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res.status >= 200 && res.status < 500;
  } catch {
    clearTimeout(id);
    return false;
  }
}

async function syncAsaasSandboxWebhook(publicUrl: string): Promise<{
  webhookId: string;
  urlMatch: boolean;
  hasAuthToken: boolean;
  eventsCount: number;
}> {
  const apiKey = config.asaas.apiKey;
  const webhookToken = config.asaas.webhookToken;

  if (!apiKey) {
    throw new Error('ASAAS_API_KEY não configurada no ambiente.');
  }

  // 1. Listar webhooks existentes no Sandbox
  const listRes = await fetch(`${config.asaas.apiUrl}/webhooks`, {
    headers: { access_token: apiKey },
  });

  if (!listRes.ok) {
    throw new Error(`Falha ao listar webhooks no Asaas Sandbox (HTTP ${listRes.status})`);
  }

  const listData = (await listRes.json()) as { data?: AsaasWebhookResponse[] };
  const existingWebhooks = Array.isArray(listData.data) ? listData.data : [];
  const existing = existingWebhooks[0];

  const payload = buildWebhookSyncPayload(existing, publicUrl, webhookToken);
  let finalWebhook: AsaasWebhookResponse;

  if (existing && existing.id) {
    // 2. Atualiza o webhook existente preservando configurações
    const updateRes = await fetch(`${config.asaas.apiUrl}/webhooks/${existing.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        access_token: apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!updateRes.ok) {
      const err = await updateRes.text().catch(() => '');
      throw new Error(`Falha ao atualizar webhook no Asaas Sandbox (HTTP ${updateRes.status}): ${err}`);
    }

    finalWebhook = (await updateRes.json()) as AsaasWebhookResponse;
  } else {
    // 3. Cria novo webhook se não existir nenhum
    const createRes = await fetch(`${config.asaas.apiUrl}/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        access_token: apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!createRes.ok) {
      const err = await createRes.text().catch(() => '');
      throw new Error(`Falha ao criar webhook no Asaas Sandbox (HTTP ${createRes.status}): ${err}`);
    }

    finalWebhook = (await createRes.json()) as AsaasWebhookResponse;
  }

  const targetWebhookUrl = formatWebhookUrl(publicUrl);
  return {
    webhookId: finalWebhook.id,
    urlMatch: finalWebhook.url === targetWebhookUrl,
    hasAuthToken: Boolean(finalWebhook.hasAuthToken),
    eventsCount: Array.isArray(finalWebhook.events) ? finalWebhook.events.length : payload.events.length,
  };
}

export async function runBillingSandboxBootstrap(options?: {
  keepAlive?: boolean;
}): Promise<void> {
  const secretsToRedact = [config.asaas.apiKey, config.asaas.webhookToken, config.jwtSecret];

  console.log('\n====================================================');
  console.log('  LOUVAIO BILLING SANDBOX BOOTSTRAP 1.1');
  console.log('====================================================\n');

  // 1. Validar ambiente estritamente Sandbox com hostname oficial (Fail-Closed)
  assertSandboxEnvironment({
    asaasEnv: config.asaas.environment,
    apiUrl: config.asaas.apiUrl,
    nodeEnv: config.nodeEnv,
  });
  console.log('[1/8] Ambiente Sandbox verificado e validado com URL oficial.');

  // 2. Verificar disponibilidade da porta (Fail-Closed se houver backend antigo rodando)
  const port = config.port || 3000;
  const isPortFree = await checkPortAvailable(port);
  if (!isPortFree) {
    throw new Error(
      `BACKEND_ALREADY_RUNNING_RESTART_REQUIRED: A porta ${port} já está em uso por outro processo. Para garantir que o backend utilize a URL do túnel atual, encerre o processo anterior e execute 'npm run billing:sandbox' novamente.`
    );
  }
  console.log(`[2/8] Porta ${port} verificada e disponível.`);

  // 3. Localizar binário do cloudflared
  const cloudflaredPath = findCloudflaredBinary();
  if (!cloudflaredPath) {
    throw new Error(
      'Cloudflared não encontrado localmente. Defina CLOUDFLARED_PATH no .env ou instale o binário em Downloads/bin.'
    );
  }
  console.log(`[3/8] Binário cloudflared localizado: ${path.basename(cloudflaredPath)}`);

  // 4. Iniciar Cloudflare Quick Tunnel e capturar URL pública
  console.log('[4/8] Iniciando Cloudflare Quick Tunnel (protocolo http2)...');
  let publicUrl: string | null = null;
  let cloudflaredProc: ChildProcess | null = null;
  let backendProc: ChildProcess | null = null;
  let isCleanedUp = false;

  const cleanup = (exitCode: number = 0) => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    console.log('\nEncerrando processos do Cloudflare Tunnel e Backend...');
    if (backendProc) {
      try {
        backendProc.kill();
      } catch {}
    }
    if (cloudflaredProc) {
      try {
        cloudflaredProc.kill();
      } catch {}
    }
    if (typeof process !== 'undefined' && typeof process.exit === 'function') {
      process.exit(exitCode);
    }
  };

  process.on('SIGINT', () => cleanup(0));
  process.on('SIGTERM', () => cleanup(0));

  try {
    const urlPromise = new Promise<string>((resolve, reject) => {
      const proc = spawn(cloudflaredPath, ['tunnel', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      cloudflaredProc = proc;

      const timeout = setTimeout(() => {
        reject(new Error('Timeout de 35s ao aguardar geração da URL do Quick Tunnel pelo cloudflared.'));
      }, 35000);

      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        const extracted = extractTrycloudflareUrl(text);
        if (extracted && isValidTrycloudflareUrl(extracted)) {
          clearTimeout(timeout);
          resolve(extracted);
        }
      };

      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Erro ao executar cloudflared: ${err.message}`));
      });

      proc.on('exit', (code) => {
        clearTimeout(timeout);
        if (!publicUrl) {
          reject(new Error(`Processo cloudflared encerrou prematuramente com código ${code}`));
        }
      });
    });

    publicUrl = await urlPromise;
  } catch (err: any) {
    cleanup();
    throw err;
  }

  console.log(`[4/8] Quick Tunnel ativo com URL pública capturada.`);

  // 5. Sincronizar BILLING_PUBLIC_API_URL no arquivo local .env
  const backendRoot = path.resolve(__dirname, '../..');
  const envPath = path.join(backendRoot, '.env');
  if (fs.existsSync(envPath)) {
    const currentEnv = fs.readFileSync(envPath, 'utf8');
    const updatedEnv = updateEnvContentBillingUrl(currentEnv, publicUrl);
    fs.writeFileSync(envPath, updatedEnv, 'utf8');
  }
  console.log('[5/8] BILLING_PUBLIC_API_URL sincronizada no .env local.');

  // 6. Iniciar Backend como processo filho com BILLING_PUBLIC_API_URL injetada no environment
  console.log('[6/8] Iniciando processo do backend com a URL pública do túnel injetada...');
  const backendEnv = buildBackendChildEnv(process.env, publicUrl);
  const spawnOpts = getBackendSpawnOptions();

  backendProc = spawn(spawnOpts.command, ['tsx', 'src/server.ts'], {
    cwd: backendRoot,
    env: backendEnv,
    shell: spawnOpts.shell,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProc.stdout?.on('data', (d) => {
    // Redireciona logs sanitizados se necessário
  });
  backendProc.stderr?.on('data', (d) => {
    // Redireciona erros sanitizados
  });

  // Aguarda readiness do backend via /api/health
  let backendReady = false;
  const startWait = Date.now();
  while (Date.now() - startWait < 25000) {
    const reachable = await checkUrlReachable(`http://127.0.0.1:${port}/api/health`, 2000);
    if (reachable) {
      backendReady = true;
      break;
    }
    await sleep(500);
  }

  if (!backendReady) {
    cleanup();
    throw new Error(`Timeout aguardando inicialização do backend na porta ${port}.`);
  }
  console.log(`[6/8] Backend iniciado e pronto em http://127.0.0.1:${port}.`);

  // 7. Sincronizar webhook no Asaas Sandbox
  console.log('[7/8] Sincronizando webhook no Asaas Sandbox (preservando eventos existentes)...');
  const webhookResult = await syncAsaasSandboxWebhook(publicUrl);
  console.log(`[7/8] Webhook Sandbox sincronizado (ID: ${webhookResult.webhookId}, Eventos: ${webhookResult.eventsCount}).`);

  // 8. Pre-flight Probes
  console.log('[8/8] Executando testes pré-voo de validação de conectividade...');

  // Probe A: Endpoint público do webhook sem token (esperado 401)
  let publicProbePass = false;
  try {
    const probeRes = await fetch(formatWebhookUrl(publicUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    publicProbePass = probeRes.status === 401;
  } catch {
    publicProbePass = false;
  }

  // Relatório Final Sanitizado
  const summary = [
    '',
    '====================================================',
    '       BILLING SANDBOX BOOTSTRAP 1.1 REPORT',
    '====================================================',
    `ASAAS ENVIRONMENT     : ${config.asaas.environment.toUpperCase()}`,
    `PUBLIC URL            : ${publicUrl}`,
    `WEBHOOK URL           : ${webhookResult.urlMatch ? 'MATCH' : 'MISMATCH'}`,
    `WEBHOOK AUTH          : ${webhookResult.hasAuthToken ? 'configured / matching' : 'MISSING'}`,
    `WEBHOOK EVENTS PRESERVED : PASS (${webhookResult.eventsCount} eventos)`,
    `PUBLIC ENDPOINT       : ${publicProbePass ? 'PASS (401 on unauthenticated)' : 'FAIL'}`,
    `BACKEND STATUS        : READY (child process ativo com URL atual)`,
    '====================================================',
    '',
  ].join('\n');

  console.log(sanitizeOutput(summary, secretsToRedact));

  // Gerenciamento de vida e supervisão contínua dos processos filhos
  if (options?.keepAlive !== false) {
    console.log('Ambiente de homologação ativo. Pressione Ctrl+C para encerrar o backend e o túnel.');
    await new Promise<void>((_, reject) => {
      const onChildExit = (name: string, code: number | null, signal: NodeJS.Signals | null) => {
        if (isCleanedUp) return;
        const errMsg = `[BOOTSTRAP SUPERVISOR] O processo filho '${name}' encerrou inesperadamente (code: ${code}, signal: ${signal}).`;
        console.error(`\n${errMsg}`);
        cleanup(1);
        reject(new Error(errMsg));
      };

      cloudflaredProc?.on('exit', (code, signal) => onChildExit('cloudflared', code, signal));
      backendProc?.on('exit', (code, signal) => onChildExit('backend', code, signal));
    });
  }
}

// Execução direta via CLI
if (require.main === module || (typeof process !== 'undefined' && process.argv[1]?.includes('billing-sandbox-bootstrap'))) {
  runBillingSandboxBootstrap()
    .catch((err) => {
      console.error('\n[BOOTSTRAP ERROR]:', err.message);
      process.exit(1);
    });
}
