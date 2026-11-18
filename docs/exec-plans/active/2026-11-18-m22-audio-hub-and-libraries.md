# M22 — Central de Áudio e Bibliotecas (Demucs ONNX 6 Faixas + R2 + Bibliotecas Ministerial e LouvAIO)

## Objective

Entregar o separador musical integrado ao LouvAIO com processamento 100% local no navegador Web (`htdemucs_6s` ONNX em 6 faixas: `vocals`, `drums`, `bass`, `guitar`, `piano`, `other`), reprodução pré-processada sem reexecutar IA e exatamente duas bibliotecas persistentes (**Biblioteca Ministerial** e **Biblioteca LouvAIO**) apoiadas em Cloudflare R2 privado, RBAC/anti-IDOR e `SubscriptionService` / Asaas existentes.

## Context

- ADR normativo: [docs/decisions/2026-11-18-m22-audio-hub-and-libraries.md](../../decisions/2026-11-18-m22-audio-hub-and-libraries.md).
- Branch / worktree base: `fix/louvaio-audit-remediation-20261113` em `.worktrees/louvaio-audit-remediation` (base `4976f720c50873c9d62da05ecbd7abb9d70a52ce`).
- Premissa obrigatória: **resultados simulados nunca contam como evidência de separação real**. Cada etapa avança com validação executável real e revisão independente via Codex (`feature-reviewer` / `billing-reviewer` conforme a fronteira).

## Current Behavior

- Existe base de teoria musical e transporte/vínculo local de ensaio (`web/src/audio/local-audio-transport.ts`, `web/src/audio/song-version-audio-binding.ts`) e plano de assinatura/billing no backend (`plans.config.ts`, `SubscriptionService`, `BillingService` + Asaas).
- Não existe ainda motor de separação ONNX de 6 faixas no navegador, nem backend/armazenamento R2 para Bibliotecas Ministerial e LouvAIO.

## Desired Behavior

- **M22-A (Etapa atual)**: Motor Web local agnóstico a modelo com `htdemucs_6s` ONNX real (`onnxruntime-web`), separação de áudio real em 6 stems (`vocals`, `drums`, `bass`, `guitar`, `piano`, `other`), harness de teste/benchmark e provas reais em Chromium com métricas de tempo, RTF, memória e hashes distintos por stem.
- **M22-B**: Worker Web dedicado + pipeline de normalização/compressão/empacotamento cliente, progresso cancelável, gerenciamento de orçamento de RAM e mixer pré-processado de 6 faixas sincronizadas integrado ao transporte/player de versão (sem biblioteca pessoal persistente).
- **M22-C (após auditoria arquitetural prévia)**: Análise formal do backend, Firestore, permissões/RBAC e contratos existentes; modelagem de dados de metadados, deduplicação controlada por SHA-256 + modelo, cliente/assinatura privada Cloudflare R2 (presigned URLs de TTL curto e política de cancelamento/revogação) e endpoints autorizados da **Biblioteca Ministerial** compartilhada por `ministryId`.
- **M22-D**: Integração da **Biblioteca Ministerial** no frontend Web, associação de gravações/versões ao repertório ministerial por `(ministryId, songId, canonicalVersionId)`, reprodução direta de arquivos pré-processados no R2 sem reexecutar IA e proteção anti-IDOR/troca de tenant/sessão.
- **M22-E (após auditoria arquitetural prévia de billing/Asaas)**: Análise formal de `plans.config.ts`, `SubscriptionService`, `billing_plan_changes`, webhooks/reconciliador Asaas e UX de plano; modelagem e implementação do entitlement da **Biblioteca LouvAIO** (add-on e/ou benefício incluído em planos específicos), catálogo global administrado pela plataforma, emissão de acesso condicionada à assinatura e comportamento fail-closed/grace em inadimplência e cancelamento.
- **M22-F**: Integração completa da **Biblioteca LouvAIO** no Web + associação ao repertório ministerial + homologação E2E de revogação/expiração de URLs, deduplicação entre gravações idênticas sem vazamento de autorização e revisão independente final (`feature-reviewer` + `billing-reviewer`).

## Scope

### In Scope (Etapa Imediata: M22-A)

- Documentação ADR, ExecPlan M22-A..F e registro durável em `MEMORY.md`.
- Instalação de `onnxruntime-web` em `web/` e cache local do modelo `htdemucs_6s_fp16weights.onnx` fora do repositório Git (`~/.cache/louvaio-models/`, SHA-256 verificado).
- Implementação do módulo `web/src/audio/separation/demucs-onnx-separator.ts` (contrato agnóstico a modelo + pipeline `htdemucs_6s` overlap-add + decoder/encoder WAV + telemetria real).
- Implementação de harness de benchmark `web/src/audio/separation/DemucsOnnxBenchmarkHarness.tsx`.
- Testes unitários em `web/src/audio/separation/demucs-onnx-separator.test.ts`.
- Teste real em navegador Chromium via Playwright (`web/e2e/m22a-demucs-onnx-browser.spec.ts`) executando inferência real do modelo ONNX e salvando evidência de benchmark em `docs/exec-plans/evidence/m22-a/browser-benchmark-report.json`.
- Revisão independente read-only via Codex (`feature-reviewer`).

### Out of Scope (Reservado para M22-B..F)

- Criação de endpoints HTTP, coleções Firestore, integração Cloudflare R2 ou alterações de planos/Asaas nesta etapa M22-A.
- Implementação de biblioteca pessoal persistente (proibida pela arquitetura M22).
- Alterações em rotas/fluxos móveis Flutter nesta etapa inicial Web.
- Commit, push, PR, merge ou deploy sem autorização expressa.

## Architecture Impact

- **M22-A**: adiciona dependência `onnxruntime-web` em `web/package.json` e módulo isolado sob `web/src/audio/separation/`, preservando rotas de produção, backend, Firestore e billing intactos.
- **M22-B..F**: exigirão análise prévia explícita de `backend/src/features/**`, `firestore.indexes.json`, `firestore.rules`, `plans.config.ts`, `SubscriptionService` e `AsaasProvider` antes de criar coleções, buckets ou produtos comerciais.

## Implementation Plan

- [x] **M22-0 (Documentação Arquitetural)**: Criar ADR M22, ExecPlan M22-A..F e registrar decisão durável em `MEMORY.md`.
- [x] **M22-A (Inferência Web 6 Faixas + Benchmark Real)**:
  - [x] Instalar `onnxruntime-web` em `web/` e validar checksum do modelo `htdemucs_6s_fp16weights.onnx` fora do Git.
  - [x] Implementar `demucs-onnx-separator.ts` com contrato extensível para modelos futuros e 6 stems canônicos (`vocals`, `drums`, `bass`, `guitar`, `piano`, `other`).
  - [x] Implementar `DemucsOnnxBenchmarkHarness.tsx` e testes unitários determinísticos (`demucs-onnx-separator.test.ts`).
  - [x] Executar inferência real no Chromium (Playwright) sobre áudio composto (mix composto por samples CC0 reais `upright-kw` + camadas sintetizadas de baixo/bateria/guitarra/voz em WAV 44.1 kHz estéreo, sem stems isolados de referência) e gravar métricas reais.
  - [x] Validar `tsc --noEmit`, testes Vitest, build Vite (`--mode test`) e revisão independente read-only no Codex.
- [ ] **M22-B (Web Worker + Mixer 6 Faixas + Pipeline de Áudio Cliente)**:
  - [ ] Offload de inferência para Web Worker sem congelar a UI principal, suporte progressivo WebGPU/WASM e cache explícito de modelo (Cache API/OPFS com exibição de quota).
  - [ ] Codec de armazenamento/transporte eficiente (ex.: FLAC/Opus ou WAV após medição real de tamanho/alinhamento) e mixer de 6 stems integrado ao player de versão canônica.
- [ ] **M22-C (Auditoria Prévia + Backend Ministerial + R2 Privado)**:
  - [ ] Auditar repositórios, middlewares RBAC/anti-IDOR, índices Firestore e padrões de upload/signed URL existentes antes de codificar.
  - [ ] Implementar metadados Firestore, deduplicação controlada por SHA-256 + perfil de modelo, autorização de acesso privada ao Cloudflare R2 (TTL curto) e CRUD da **Biblioteca Ministerial**.
- [ ] **M22-D (Frontend Biblioteca Ministerial + Associação ao Repertório)**:
  - [ ] Fluxo Web de separação -> revisão -> publicação na Biblioteca Ministerial (sem biblioteca pessoal).
  - [ ] Associação ao repertório ministerial por `(ministryId, songId, canonicalVersionId)` e reprodução direta dos stems no R2 sem reexecutar IA.
  - [ ] Migração não destrutiva da superfície `/pacotes-ensaio`: disponibilizar exportação local `.louvaio-rehearsal.zip` / importação assistida para a **Biblioteca Ministerial** preservando dados locais existentes antes de descontinuar a lista pessoal.
- [ ] **M22-E (Auditoria Prévia Billing/Asaas + Biblioteca LouvAIO + Entitlements)**:
  - [ ] Auditar `plans.config.ts`, `SubscriptionService`, `billing_plan_changes`, `AsaasProvider` e reconciliador antes de modelar o add-on/benefício da Biblioteca LouvAIO.
  - [ ] Implementar catálogo global administrado pela plataforma, gating por assinatura/entitlement, tratamento de expiração/cancelamento/grace/revogação e revisão independente via `billing-reviewer` no Codex.
- [ ] **M22-F (Integração Final Biblioteca LouvAIO + Repertório + Homologação E2E)**:
  - [ ] Integrar Biblioteca LouvAIO ao Web e à associação com repertório ministerial.
  - [ ] Critério de aceite de catálogo único/duas bibliotecas: aposentar a rota de catálogo pessoal `/pacotes-ensaio` (mantendo utilitários de transporte/resolução de `SongVersion`) após garantia de exportação/migração não destrutiva dos pacotes locais pré-existentes.
  - [ ] Executar suíte E2E de revogação de acesso, TTL de URLs, isolamento cross-tenant, deduplicação autorizada e revisão independente final via Codex.

## Files Expected to Change (M22-A)

- `AGENTS.md`, `GEMINI.md`, `docs/development/multi-agent-workflow.md`, `.codex/config.toml`, `.codex/agents/*.toml` (alinhamento da regra obrigatória de revisão no Codex e modelo `gpt-6.2-sol` / `high`)
- `MEMORY.md` (decisão durável M22)
- `docs/decisions/2026-11-18-m22-audio-hub-and-libraries.md`
- `docs/exec-plans/active/2026-11-18-m22-audio-hub-and-libraries.md`
- `docs/exec-plans/evidence/m22-a/browser-benchmark-report.json`
- `web/package.json`, `web/package-lock.json`
- `web/playwright.config.ts` (exclusão do benchmark pesado da suíte padrão), `web/playwright.m22a.config.ts` (configuração opt-in isolada)
- `web/src/audio/separation/demucs-onnx-separator.ts`
- `web/src/audio/separation/DemucsOnnxBenchmarkHarness.tsx`
- `web/src/audio/separation/DemucsOnnxBenchmarkHarness.test.tsx`
- `web/src/audio/separation/demucs-onnx-separator.test.ts`
- `web/src/audio/separation/onnxruntime-web.d.ts`
- `web/e2e/m22a-demucs-onnx-browser.spec.ts`

## Tests & Validation (M22-A)

- `npx --no-install tsc --noEmit` (`web/`)
- `npx --no-install tsc --noEmit --target ES2020 --module ESNext --moduleResolution bundler --jsx react-jsx --skipLibCheck --strict --noUnusedLocals --noUnusedParameters --allowImportingTsExtensions src/audio/separation/onnxruntime-web.d.ts playwright.m22a.config.ts e2e/m22a-demucs-onnx-browser.spec.ts` (`web/`)
- `npm test -- --run src/audio/separation/demucs-onnx-separator.test.ts src/audio/separation/DemucsOnnxBenchmarkHarness.test.tsx` (`web/`)
- `npm run build -- --mode test` (`web/`)
- `LOUVAIO_UPDATE_M22A_EVIDENCE=1 npx --no-install playwright test --config=playwright.m22a.config.ts` (`web/`) — inferência ONNX real no Chromium, sem mocks de saída de separação.
- Revisão independente read-only via **Codex** (`feature-reviewer`).

## Risks

- **Tamanho de pesos (`136.4 MB` para `htdemucs_6s_fp16weights.onnx`) e binários WASM (`onnxruntime-web`)**: pesos não devem entrar no Git nem no precache automático do Workbox; devem ser baixados sob demanda/cache explícito.
- **Compatibilidade de operadores WebGPU vs WASM**: `htdemucs_6s` pode exigir `ConstantOfShape` folding para WebGPU; WASM serve como baseline determinístico enquanto o benchmark mede tempo real e viabilidade de WebGPU.
- **Memória e bloqueio da thread principal**: inferência na main thread em M22-A serve para validar o pipeline e medir RTF real; em M22-B deve ser movida para Web Worker dedicado antes de integração na UX de produção.
- **Falso positivo de separação**: testes simulados não validam compatibilidade real do grafo ONNX com o runtime do navegador; o gate M22-A exige execução real contra o modelo `.onnx` no Chromium.

## Decisions

- Uso inicial de `StemSplitio/htdemucs-6s-onnx` (`htdemucs_6s_fp16weights.onnx`, MIT, `136.428.532` bytes, SHA-256 `7ce55792e2231c93fbf92de95f5fd5b3a5e6c89f7db690dfd693e8f1dce56869`) fora do Git para M22-A, mantendo interface agnóstica para variantes WebGPU (`kramp/htdemucs-6s-webgpu-onnx`) ou modelos futuros.
- Ordem canônica de exibição/domínio no LouvAIO: `['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']`, mapeada explicitamente a partir da saída do tensor `htdemucs_6s` `['drums', 'bass', 'other', 'vocals', 'guitar', 'piano']`.

## Progress Notes

- **2026-11-18**: ADR e ExecPlan criados; iniciada execução da etapa M22-A na worktree `.worktrees/louvaio-audit-remediation`.
- **2026-11-18 (M22-A Diagnóstico ONNX WASM)**: `graphOptimizationLevel: 'all'` causou abort em 32-bit WASM (`230806360` / `Aborted()`) sobre os 13.138 nós de `htdemucs_6s_fp16weights.onnx`; ajustado o default de `createOrtWebSessionAdapter` para `'disabled'`, inicializando a sessão com sucesso.
- **2026-11-18 (M22-A Benchmark Real em Chromium — pós-remediações Codex #1, #2 e #3)**:
  - Evidência gravada em `docs/exec-plans/evidence/m22-a/browser-benchmark-report.json` (`recordedAt: 2026-11-18T17:44:20.703Z`) via `playwright.m22a.config.ts` (`LOUVAIO_UPDATE_M22A_EVIDENCE=1`).
  - Ambiente: `HeadlessChrome/157.0.0.0`, `hardwareConcurrency: 4`, `crossOriginIsolated: false` (WASM SIMD single-thread), `hasWebGpu: true`, `onnxruntime-web 1.21.0`.
  - Modelo: `htdemucs_6s_fp16weights.onnx` (`136.428.532` bytes medidos, SHA-256 `7ce55792e2231c93fbf92de95f5fd5b3a5e6c89f7db690dfd693e8f1dce56869` verificado obrigatoriamente em runtime).
  - Entrada: `8,5 s` (`374.850` frames @ `44.100 Hz` estéreo, 2 chunks com overlap de `85.995` frames).
  - Telemetria real (execução final pós-edição): `executionProvider: "wasm"`, `modelLoadMs: 34993.4`, `inferenceMs: 56142.0`, `encodeMs: 344.7`, `totalWallMs: 91602.8`, `rtf: 6.605`, `jsHeapUsedBytes: 115891533` (~110,5 MiB, `jsHeapSnapshotKind: "point_in_time_post_encode"`), `reconstructionMaxAbsError: 0.2192`.
  - Saída (6 faixas distintas, `374.850` frames / `1.499.444` bytes cada; os 6 blobs `blob:` lidos de volta no Chromium bateram 100% em tamanho e SHA-256):
    - `vocals`: RMS `0.01518`, Peak `0.14011`, SHA-256 `eadf5816f051e66d4a09317801c333870c468376488729e452815c8a7166bf5d`
    - `drums`: RMS `0.03470`, Peak `0.33978`, SHA-256 `2e3dc702f50fbcd57da642f9bad6bd3ea7bb07b87d4d8afae7355b3f89f68a17`
    - `bass`: RMS `0.04608`, Peak `0.20274`, SHA-256 `d7650529d1721dfb6aede833fe93e3bc41f68c4dfa03c721a1b7d0a3af01860d`
    - `guitar`: RMS `0.02459`, Peak `0.15413`, SHA-256 `dcf8814e349eefb0d07adde2da07fcbb4f6633334e8560e47c10c6809aa30df3`
    - `piano`: RMS `0.02392`, Peak `0.25886`, SHA-256 `108518e60e629cb26e06e0e652d5882739645924030f408f43bd58896e915eae`
    - `other`: RMS `0.02886`, Peak `0.14492`, SHA-256 `aa725c96234d64175c1dd66ce80b1aa259a6b5dffcbeca930d4b3252c0904cb0`
  - Remediações aplicadas após revisões Codex #1, #2, #3 e #4: exclusão do benchmark da suíte padrão Playwright + `playwright.m22a.config.ts` com saída HTML isolada em `test-results/m22a-html-report` dentro da pasta ignorada `web/test-results/` (L2/relatório irmão); check de cancelamento pós-`dispose()`, no `finally` de erro/limpeza com precedência de `CANCELLED` sobre falhas de inferência/`dispose()` pós-abort e liberação pós-abort caso `InferenceSession.create` resolva após cancelamento (L1); parser RIFF/WAVE único estrito exigindo `riffEnd === buffer.byteLength`, padding obrigatório em chunks ímpares e `18 + cbSize <= chunkSize` em `WAVE_FORMAT_EXTENSIBLE` (M1); validação estrita de finitude, `modelBytes` safe-integer em `(0, MAX_MODEL_BYTES]`, regex SHA-256, `typeof modelChecksumVerified === 'boolean'` (sem coerção de `null`) e vinculação da atestação (`modelId`/`modelVersion`/hash/bytes) ao `descriptor` usado na separação antes de `complete` (M2/atestação); validação pré-alocação de `maxBytes`/`maxModelBytes` e `maxFrames` seguro em `decodeWavToStereoFloat32` e `separateStereoAudio` (M3); snapshot imutável dos bytes do modelo e `snapshotModelDescriptor` congelando campos/arrays antes de hashing/verificação e atestando `modelChecksumVerified` apenas após comparação efetiva contra `expectedModelSha256` congelado (M4); verificação real dos 6 `blob:` URLs no Chromium e alinhamento integral para `gpt-6.2-sol` / `high`.
- **2026-11-18 (M22-A Encerramento + Remediações Codex #5, #6 e #7 + Revalidação Final)**:
  - Remediações aplicadas após revisões Codex #5, #6 e #7:
    - Vínculo estrito de contrato (`session.descriptor` + `inputNames`/`outputNames` + `rawOutputStemOrder` e `canonicalStemOrder`), `WeakMap` privado de módulo (`VERIFIED_ORT_SESSION_STAMPS`) ligando a sessão autenticada (`handle`, `runSegment` e `dispose` congelados e invocados via `reflectApply` capturado no módulo, imunes a sobrescrita de `.call`/`Reflect.apply`) exclusivamente às instâncias produzidas por `createOrtWebSessionAdapter`, leitura única de propriedades em `validateSessionAttestation` (evitando double-read de getter) e validação idêntica pré-chunk-0 e pré-`complete` (Achado 1 HIGH).
    - Validação de `buf.byteLength` efetivo e snapshot isolado de `Blob` em `resolveModelBytes` antes do hash e do carregamento no ORT (Achado 2 MEDIUM).
    - Bloqueio de reexecução no `DemucsOnnxBenchmarkHarness` (`isCleaningUp` / `inFlightRunRef`) após cancelar até a sessão pendente concluir limpeza/dispose (Achado 3 MEDIUM), com teste de regressão em `DemucsOnnxBenchmarkHarness.test.tsx`.
    - Uso de `absCosineSimilarity` e rotulagem explícita de estimativas de banda por filtros mono de 1ª ordem e natureza do fixture composto sem referência isolada (Achado 5 LOW) + import explícito de `CanonicalStemId` e checagem TypeScript reproduzível cobrindo `playwright.m22a.config.ts` e `e2e/m22a-demucs-onnx-browser.spec.ts` (Achados 4 MEDIUM e 6 LOW).
  - Revalidação final executada em `2026-11-18T19:55:00.802Z`: `tsc --noEmit` (`web/`), checagem TypeScript explícita de `onnxruntime-web.d.ts` + `playwright.m22a.config.ts` + `e2e/m22a-demucs-onnx-browser.spec.ts`, `14` testes Vitest (`demucs-onnx-separator.test.ts` 13/13 + `DemucsOnnxBenchmarkHarness.test.tsx` 1/1), `vite build --mode test` e Playwright `playwright.m22a.config.ts` (`LOUVAIO_UPDATE_M22A_EVIDENCE=1`, 1 passed em 1.8m).
  - Evidência atualizada em `docs/exec-plans/evidence/m22-a/browser-benchmark-report.json`: `executionProvider: "wasm"`, `modelLoadMs: 36859.5`, `inferenceMs: 57394.0`, `encodeMs: 350.1`, `totalWallMs: 94740.0`, `rtf: 6.752`, `jsHeapUsedBytes: 116047430` (~110,7 MiB, `point_in_time_post_encode`), `reconstructionMaxAbsError: 0.2192`.
  - Auditoria matemática entre os 6 stems (`stemDifferenceAudit`, 15 pares): `minPairwiseMaxAbsDiff: 0.144806`, `maxPairwiseCosineSimilarity: 0.072069`, `maxPairwiseAbsCosineSimilarity: 0.072069` (nenhum par idêntico ou invertido; estimativas de banda coerentes — ex.: `bass` com `92,98%` `<250 Hz` e `ZCR 143,6 Hz` vs. `vocals` com `60,16%` em médios e `ZCR 1984,4 Hz`).
  - Amostras WAV gravadas fora do Git em `web/test-results/m22a-audio-samples/` (`input-mix.wav`, `vocals.wav`, `drums.wav`, `bass.wav`, `guitar.wav`, `piano.wav`, `other.wav`, `1.499.444` bytes cada) para avaliação auditiva humana, sem alegar qualidade perceptual apenas pelos hashes/métricas.
  - Achado de engenharia para **M22-B**: em WASM single-thread (`crossOriginIsolated: false`), o RTF observado variou de `6.605x` a `6.871x`, reforçando a prioridade de offload para Web Worker + avaliação comparativa de WASM multithread e WebGPU em **M22-B**.

## Final Result

Etapas M22-0 e M22-A implementadas, remediadas após revisões Codex #5/#6/#7 e revalidadas em `2026-11-18T19:55:00.802Z` (inferência real de 6 stems em Chromium com `htdemucs_6s_fp16weights.onnx`, auditoria acústica dos 15 pares com `maxPairwiseAbsCosineSimilarity: 0.072069` e amostras WAV em `web/test-results/m22a-audio-samples/`, `tsc --noEmit` + checagem do spec/config, 14 testes Vitest e build Vite `--mode test`); submetidas à revisão independente final no Codex para commit local de M22-A. Pendentes as etapas subsequentes M22-B..F.
