import { writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const deploymentUrl = 'https://praise-app-m7tn-mtjbm28yk-henriquecesarths-projects.vercel.app';
const paths = [
  '/',
  '/cifras',
  '/cifras/nova',
  '/cifras/m20-c14-smoke/editar',
  '/assets/index-BVS6yUjl.js',
  '/assets/index-MUD_a2Sn.css'
];

const results = [];

for (const p of paths) {
  const url = `${deploymentUrl}${p}`;
  const res = spawnSync('npx', ['--yes', 'vercel', 'curl', '-s', '-i', url], { encoding: 'utf8', shell: true });
  const output = res.stdout || '';
  const firstLine = output.split('\r\n')[0] || output.split('\n')[0] || '';
  const statusMatch = firstLine.match(/HTTP\/[\d.]+ (\d+)/);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : 200; // vercel curl might strip header if -i not passed or curl output
  
  const hasAssets = output.includes('/assets/index-BVS6yUjl.js') && output.includes('/assets/index-MUD_a2Sn.css');
  const hasHtmlRoot = output.includes('<div id="root"></div>');
  const hasFix = p.includes('.js') ? output.includes('paddingRight:"12px"') : null;

  results.push({
    path: p,
    outputLength: output.length,
    hasHtmlRoot: p.includes('.js') || p.includes('.css') ? null : hasHtmlRoot,
    hasAssets: p.includes('.js') || p.includes('.css') ? null : hasAssets,
    hasFix: p.includes('.js') ? hasFix : null
  });
}

mkdirSync('docs/exec-plans/evidence/m20-c14-r9-1', { recursive: true });
writeFileSync('docs/exec-plans/evidence/m20-c14-r9-1/pre-alias-smoke.json', JSON.stringify(results, null, 2));
console.log('Pre-alias smoke results:', JSON.stringify(results, null, 2));
