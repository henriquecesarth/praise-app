import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';

const SAFE_ROOTS = ['backend/', 'web/', 'mobile/'];
const PROTECTED = /(^|\/)(?:\.git|\.env(?:\..*)?|key\.properties|[^/]*\.keystore|[^/]*\.jks|node_modules)(?:\/|$)/i;

export function validateBranch(branch) {
  if (typeof branch !== 'string' || !/^[a-z0-9][a-z0-9._/-]{1,140}$/i.test(branch) ||
      branch.includes('..') || branch.includes('//') || branch.endsWith('/') || branch.endsWith('.lock')) {
    throw new Error('Unsafe or invalid base branch name');
  }
  return branch;
}

export function validateOwnedPath(path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('..') ||
      path.startsWith('/') || path.includes(':') || PROTECTED.test(path) ||
      !SAFE_ROOTS.some(prefix => path.startsWith(prefix))) {
    throw new Error('Forbidden ownership path: ' + String(path));
  }
  return path;
}

function overlaps(a, b) {
  const left = a.toLowerCase().replace(/\/+$/, '');
  const right = b.toLowerCase().replace(/\/+$/, '');
  return left === right || left.startsWith(right + '/') || right.startsWith(left + '/');
}

export function validateManifest(manifest, expectedIssue, expectedBase) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Manifest must be an object');
  if (!Number.isSafeInteger(manifest.issue) || manifest.issue <= 0 || manifest.issue !== expectedIssue) {
    throw new Error('Manifest issue does not match --issue');
  }
  if (manifest.base !== expectedBase) throw new Error('Manifest base does not match --base');
  validateBranch(manifest.base);
  if (typeof manifest.repo !== 'string' || !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(manifest.repo)) {
    throw new Error('Expected GitHub owner/repo');
  }
  if (!Array.isArray(manifest.tasks) || manifest.tasks.length < 1 || manifest.tasks.length > 4) {
    throw new Error('Provide 1-4 independent implementation tasks');
  }
  if (manifest.tasks.length > 1 && (!manifest.contractFile || typeof manifest.contractFile !== 'string')) {
    throw new Error('Parallel writers require a reviewed, fixed contractFile');
  }
  const ids = new Set();
  const owners = [];
  for (const task of manifest.tasks) {
    if (!task || typeof task !== 'object' || !/^[a-z][a-z0-9-]{0,39}$/.test(task.id || '') || ids.has(task.id)) {
      throw new Error('Task ids must be distinct lowercase safe identifiers');
    }
    ids.add(task.id);
    if (typeof task.goal !== 'string' || task.goal.length < 15 || task.goal.length > 4000) {
      throw new Error('Every task needs a detailed goal (15-4000 characters)');
    }
    if (!Array.isArray(task.paths) || task.paths.length < 1 || task.paths.length > 12) {
      throw new Error('Every task needs explicit owned paths');
    }
    for (const value of task.paths) {
      validateOwnedPath(value);
      for (const old of owners) {
        if (overlaps(value, old.path)) {
          throw new Error('Overlapping writers: ' + task.id + ':' + value + ' and ' + old.task + ':' + old.path);
        }
      }
      owners.push({ task: task.id, path: value });
    }
    if (task.dependsOn && task.dependsOn.length) throw new Error('V2 writer batch requires independent tasks (dependencies unsupported)');
  }
  const targets = manifest.validation || [];
  if (!Array.isArray(targets) || targets.some(x => !['backend', 'web', 'mobile'].includes(x)) || new Set(targets).size !== targets.length) {
    throw new Error('Validation must be a unique subset of backend/web/mobile');
  }
  if (manifest.contractFile) {
    const p = manifest.contractFile;
    if (typeof p !== 'string' || !/^docs\/[a-z0-9_./-]+\.md$/i.test(p) || p.includes('..')) {
      throw new Error('contractFile must be Markdown below docs/');
    }
  }
  return manifest;
}

export function validateChangedPaths(changed, owned) {
  const forbidden = changed.filter(path => {
    if (PROTECTED.test(path)) return true;
    const normal = path.toLowerCase();
    return !owned.some(p => {
      const allowed = p.toLowerCase();
      return allowed.endsWith('/') ? normal.startsWith(allowed) : normal === allowed;
    });
  });
  if (forbidden.length) throw new Error('Agent touched non-owned files: ' + forbidden.join(', '));
  if (!changed.length) throw new Error('Agent made no detectable source changes');
}

export function evaluateCodex(stdout, stderr, exitCode) {
  const items = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { items.push(JSON.parse(line)); } catch { /* diagnostic text */ }
  }
  const complete = items.some(event => event.type === 'turn.completed');
  const failed = items.some(event => event.type === 'turn.failed' || event.type === 'error');
  const nestedFailure = /collab spawn failed|no rollout found for thread|subagent spawn failed/i.test(stdout + '\n' + stderr);
  const authFailure = /model_not_found|not supported when using Codex|authentication failed|unauthorized/i.test(stdout + '\n' + stderr);
  const transientModelRefresh = /failed to refresh available models: request timed out/i.test(stderr);
  return {
    PROCESS_OK: exitCode === 0,
    TASK_OK: exitCode === 0 && complete && !failed && !authFailure,
    DELEGATION_OK: !nestedFailure,
    EVIDENCE_COMPLETE: complete && items.length > 0,
    warnings: [
      ...(nestedFailure ? ['Codex internal subagent invocation failed'] : []),
      ...(authFailure ? ['Codex model/authentication error'] : []),
      ...(transientModelRefresh ? ['Transient model-refresh timeout'] : [])
    ]
  };
}

export function evaluateAgy(stdout, stderr, exitCode) {
  let value;
  try { value = JSON.parse(stdout.trim()); } catch { value = null; }
  const clean = !/error:.*(permission denied|auth failed|sandbox failed)/i.test(stderr);
  return {
    PROCESS_OK: exitCode === 0,
    TASK_OK: exitCode === 0 && value?.status === 'SUCCESS' && clean,
    DELEGATION_OK: null,
    EVIDENCE_COMPLETE: Boolean(value && typeof value === 'object' && 'status' in value),
    warnings: clean ? [] : ['Antigravity emitted a permission/authentication/sandbox error']
  };
}

export async function runProcess(command, args, options = {}) {
  const { cwd, timeoutMs = 900000, outputDir, name, env = process.env } = options;
  if (!outputDir || !name) throw new Error('outputDir and name required');
  await mkdir(outputDir, { recursive: true });
  const stdoutPath = outputDir + '/' + name + '.stdout.txt';
  const stderrPath = outputDir + '/' + name + '.stderr.txt';
  const out = createWriteStream(stdoutPath, { flags: 'wx' });
  const err = createWriteStream(stderrPath, { flags: 'wx' });
  const begin = Date.now();
  let timedOut = false, aborted = false, child;
  let stdout = '', stderr = '';
  const append = (current, chunk) => (current + String(chunk)).slice(-2_000_000);
  try {
    const result = await new Promise(resolve => {
      let settled = false;
      const finish = value => { if (!settled) { settled = true; resolve(value); } };
      try {
        child = spawn(command, args, { cwd, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) { finish({ code: null, error: String(e) }); return; }
      child.stdout.on('data', chunk => { out.write(chunk); stdout = append(stdout, chunk); });
      child.stderr.on('data', chunk => { err.write(chunk); stderr = append(stderr, chunk); });
      child.on('error', e => finish({ code: null, error: String(e) }));
      const timer = setTimeout(() => {
        timedOut = true;
        if (process.platform === 'win32' && child.pid) {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.on('error', () => child.kill('SIGKILL'));
        } else { child.kill('SIGKILL'); }
        setTimeout(() => finish({ code: null, error: 'Timeout or descendant did not exit' }), 15000).unref();
      }, timeoutMs);
      timer.unref?.();
      child.on('close', code => { clearTimeout(timer); finish({ code }); });
      if (options.signal) {
        const abort = () => { aborted = true; child.kill('SIGKILL'); };
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      }
    });
    return { exitCode: result.code, timedOut, aborted, spawnError: result.error || null,
      durationSeconds: Number(((Date.now() - begin) / 1000).toFixed(2)),
      stdoutPath, stderrPath, stdout, stderr };
  } finally {
    await Promise.all([
      new Promise(resolve => out.end(resolve)),
      new Promise(resolve => err.end(resolve))
    ]);
  }
}
