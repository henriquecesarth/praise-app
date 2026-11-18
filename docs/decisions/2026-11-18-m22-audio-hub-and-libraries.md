# Decision: M22 — Central de Áudio e Bibliotecas (Separação Local Web + R2 Privado + Bibliotecas Ministerial e LouvAIO)

## Status

Accepted pelo proprietário em 2026-11-18.

Substitui parcialmente o ADR [`2026-11-16-v3-musical-local-first-package.md`](./2026-11-16-v3-musical-local-first-package.md) exclusivamente quanto à existência de biblioteca pessoal persistente e à proibição de armazenamento central: **não haverá biblioteca pessoal persistente**, e as faixas pré-processadas serão armazenadas de forma privada em **Cloudflare R2** sob controle estrito de autorização do backend LouvAIO.

Preserva os princípios de zero servidor GPU, zero API paga de separação, vínculo canônico por `(ministryId, songId, canonicalVersionId)` e proteção estrita multi-tenant/RBAC.

## Context

O LouvAIO necessita de um separador musical integrado ao fluxo de repertório e ensaio que permita:
1. Separar gravações em **6 faixas** (`vocals`, `drums`, `bass`, `guitar`, `piano`, `other`) com custo zero de GPU ou API de inferência em servidor.
2. Evitar reprocessamento de IA durante ensaios e cultos: a separação ocorre uma única vez no navegador do operador autorizado, e os membros reproduzem os arquivos pré-processados.
3. Unificar a experiência em torno de duas bibliotecas persistentes bem definidas (**Biblioteca Ministerial** e **Biblioteca LouvAIO**), sem criar bibliotecas pessoais paralelas nem duplicar armazenamento físico desnecessariamente.
4. Reaproveitar integralmente a arquitetura existente de autenticação, RBAC, isolamento por `ministryId`, vínculos por `SongVersion` canônica, `SubscriptionService`, `plans.config.ts`, `billing_plan_changes` e integração Asaas.

## Decision

### Decisões Definitivas (1–10)

1. **Processamento inicial exclusivamente Web com Demucs ONNX 6 faixas**: a separação inicial utiliza `htdemucs_6s` em formato ONNX (`vocals`, `drums`, `bass`, `guitar`, `piano`, `other`), executada exclusivamente no cliente Web.
2. **Inferência 100% local no navegador**: execução via `onnxruntime-web` (WASM/WebGPU) diretamente no navegador do usuário, sem servidor GPU e sem API paga de separação.
3. **Somente duas bibliotecas persistentes**: **Biblioteca Ministerial** e **Biblioteca LouvAIO**.
4. **Proibição de biblioteca pessoal**: não implementar biblioteca pessoal persistente de áudio separado (nem local permanente por usuário fora de staging/cache transitório, nem no servidor).
5. **Biblioteca Ministerial compartilhada por ministério**: pertence ao ministério (`ministryId` canônico, preservando aliases legados `groupId` somente onde contratos existentes exigirem), sendo compartilhada apenas entre membros ativos e autorizados daquele ministério via RBAC e validação anti-IDOR no backend.
6. **Biblioteca LouvAIO global e com gate comercial**: catálogo global administrado pela plataforma e disponibilizado aos ministérios conforme direitos vigentes de assinatura avaliados pelo `SubscriptionService`.
7. **Compatibilidade financeira nativa**: o acesso à Biblioteca LouvAIO integra-se ao sistema financeiro existente (`backend/src/config/plans.config.ts`, `SubscriptionService`, `billing_plan_changes` e provedor Asaas), preferencialmente como add-on ou benefício incluído em determinados planos, mantendo o Asaas como autoridade financeira e o backend como autoridade de entitlements.
8. **Armazenamento privado em Cloudflare R2**: na etapa de persistência, as faixas processadas são armazenadas em objetos privados no Cloudflare R2, acessados exclusivamente mediante autorização emitida pelo backend (URLs pré-assinadas de curta duração ou proxy autorizado, jamais bucket público).
9. **Reprodução pré-processada sem reexecutar IA**: o player e o mixer multi-faixa reproduzem diretamente os stems pré-processados persistidos, sem nova inferência de IA durante a reprodução.
10. **Associação ao repertório ministerial**: músicas de ambas as bibliotecas podem ser associadas ao repertório do ministério com vínculo explícito à versão canônica da música (`songId` + `canonicalVersionId`).

### Requisitos Arquiteturais e Fronteiras

1. **Separação estrita entre Metadados, Controle de Acesso e Armazenamento Físico**:
   - **Armazenamento físico (Cloudflare R2 privado)**: armazena apenas blobs de áudio identificados por chave endereçada por conteúdo/perfil (ex.: hash SHA-256 da gravação original + identificador/hash do modelo e perfil de codec), sem autoridade de tenant ou assinatura no objeto.
   - **Catálogo e deduplicação controlada**: se uma mesma gravação/perfil já existir no R2, os bytes físicos não são duplicados desnecessariamente, **mas a reutilização jamais concede acesso automático**. Cada registro de biblioteca (`ministry_audio_tracks` ou `louvaio_audio_tracks`) exige vínculo explícito, proveniência/direitos registrados e autorização própria no backend.
   - **Metadados (Firestore)**: registram título, artista, versão musical de referência, `sourceSha256`, `modelId`, `modelVersion`, `stemSpecs` (6 faixas com `codec`, `sampleRate`, `totalFrames`, `byteLength`, `stemSha256`), referência ao blob deduplicado e vínculos com `(ministryId, songId, canonicalVersionId)`.
   - **Controle de Acesso (Backend Express)**: aplica autenticação Firebase/JWT, verificação de associação ativa ao ministério, RBAC (admin vs. member para upload/associação/remoção vs. leitura/reprodução), anti-IDOR (HTTP 404 fail-closed em cross-tenant) e avaliação de assinatura via `SubscriptionService` antes de emitir credenciais temporárias de leitura/upload.
2. **Identificação explícita de versões musicais**:
   - Todo vínculo ao repertório ministerial deve apontar para `(ministryId, songId, canonicalVersionId)` validado contra o repositório de repertório, reutilizando a resolução canônica de `SongVersion` estabelecida em T10 (`smart_chord_version.ts` / `song-version-audio-binding.ts`), evitando associações ambíguas entre versões distintas de uma mesma música.
3. **Ciclo de assinatura, expiração de URLs e revogação**:
   - URLs assinadas de leitura/upload no R2 têm TTL curto e escopo restrito ao objeto autorizado.
   - Downgrade, inadimplência (`past_due`), `grace`, `restricted_over_limit`, suspensão administrativa ou cancelamento seguem a regra de `AGENTS.md`: **nunca apagar dados do ministério automaticamente**; aplicar bloqueio de novas adições/acesso à Biblioteca LouvAIO conforme `SubscriptionService`, negar emissão de novas URLs ao perder entitlement e tratar falhas/incertezas de provedor de forma fail-closed.
4. **Frontend desacoplado e extensível para novos modelos**:
   - A camada de inferência local define um contrato agnóstico de modelo (`AudioSeparationModelDescriptor`, registro de modelos e adaptador de sessão ONNX) de modo que futuros modelos (novas arquiteturas Demucs, RoFormer, quantizações ou execução WebGPU/WASM) sejam adicionados sem acoplar UI, transporte de áudio ou persistência a um único checkpoint.

## Alternatives Considered

- **Inferência em servidor GPU ou API externa paga**: rejeitada pelas decisões 1 e 2 por custo recorrente incompatível com o modelo SaaS atual e latência operacional.
- **Biblioteca pessoal persistente (local ou nuvem)**: rejeitada pelas decisões 3 e 4 para simplificar UX, evitar fragmentação de acervo entre membros do mesmo ministério e concentrar compartilhamento na Biblioteca Ministerial.
- **Bucket R2 público ou URLs permanentes em Firestore**: rejeitado por impossibilitar revogação no cancelamento de assinatura, remoção de membro ou troca de ministério, além de expor conteúdo protegido fora do controle RBAC.
- **Duplicar módulo próprio de cobrança para a Biblioteca LouvAIO**: rejeitado pelo requisito de reutilizar `plans.config.ts`, `SubscriptionService`, `billing_plan_changes` e Asaas.

## Consequences

- O cliente Web assume o custo computacional da separação local (`onnxruntime-web`), exigindo validação real de desempenho, uso de memória e compatibilidade de operadores ONNX em navegador real (escopo imediato de **M22-A**).
- Armazenamento em R2 e cobrança/entitlement da Biblioteca LouvAIO permanecem adiados até a conclusão da análise prévia das estruturas existentes de backend, Firestore, Asaas e permissões (prevista no ExecPlan antes de **M22-C** e **M22-E**).
- Nenhuma biblioteca pessoal de áudio será adicionada ao produto; o protótipo local T7–T10 em `.worktrees/louvaio-audit-remediation` (`/pacotes-ensaio`, `RehearsalPackageLibraryView.tsx`, `rehearsal-package-library.ts`) permanece preservado de forma congelada apenas durante a etapa M22-A/B/C para não quebrar fluxos existentes antes da entrega da Biblioteca Ministerial:
  - **Componentes reaproveitados**: `rehearsal-package-validator.ts` (utilitários de integridade/hash), `song-version-audio-binding.ts` (resolução canônica de `SongVersion` e generation fencing da sessão global) e `local-audio-transport.ts` / `GlobalRehearsalAudioMiniPlayer.tsx`.
  - **Critério de descontinuação sem perda de dados (M22-D / M22-F)**: ao habilitar a **Biblioteca Ministerial** em M22-D e concluir a homologação em M22-F, a superfície de catálogo pessoal `/pacotes-ensaio` será aposentada; antes da remoção da rota, usuários com pacotes locais existentes mantêm opção explícita de exportação local unidirecional (`.louvaio-rehearsal.zip`) e upload autorizado para a Biblioteca Ministerial do ministério alvo, sem apagamento silencioso de dados locais existentes.

## Evidence

- Especificação do proprietário: `# LouvAIO — M22: Central de Áudio e Bibliotecas` (2026-11-18).
- Estruturas inspecionadas como ponto de partida: `backend/src/config/plans.config.ts`, `backend/src/features/subscriptions/subscription.service.ts`, `backend/src/features/billing/`, `backend/src/features/repertoire/`, `web/src/audio/song-version-audio-binding.ts`, `web/src/audio/local-audio-transport.ts`.
- ExecPlan de execução incremental: [`docs/exec-plans/active/2026-11-18-m22-audio-hub-and-libraries.md`](../exec-plans/active/2026-11-18-m22-audio-hub-and-libraries.md).
