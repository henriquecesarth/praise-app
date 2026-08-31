# Baseline de Desempenho, Mapeamento de Consultas e Hardening Final Pré-Lançamento — LouvAIO

**Data do Snapshot**: 2026-08-29  
**Versão**: 4.0.0 (Reconciliação Final Pós-Otimização: Premium 300/1.500, Egress Decomposto, Index-Entry Billing Derivado, Tipo Persistido e Governança de Busca)  
**Status**: Concluído e Reconciliado  
**Documentos de Referência**:  
- `docs/operations/cost-model.md` (v3.2.0)  
- `docs/business/commercial-pricing-strategy.md` (v3.0.0)  
- `backend/firestore.indexes.json`  
- `firebase.json` (Raiz — canônico) e `backend/firebase.json` (Cópia local)  
- `docs/exec-plans/active/2026-08-29-pre-launch-cost-scalability-optimization.md`  

---

## 1. Histórico e Evolução Arquitetural em Três Estágios

| Aspecto | Estado Original (Baseline Antes) | Implementação Intermediária (Offset) | Estado Final Hardened (Cursor + Select) |
|---|---|---|---|
| **Paginação de Músicas (`GET /songs`)** | Scan total em memória ($O(S)$ reads a cada request) | Server-side `.offset().limit()` | **Cursor-Based Pagination** (`startAfter(updated_at, id)`) com ordenação composta estável (`updated_at DESC, __name__ DESC`) |
| **Documentos Buscados (`limit=20`)** | $S$ documentos | 20 documentos | **Até 21 documentos** (`limit + 1` para detectar `hasMore`) |
| **Custo de Página Profunda (Ex: Pág. 75 / 1.500 músicas)** | ~1.500 reads | ~1.500 reads (offset fatura documentos pulados) | **$\le 21$ reads** (estritamente limitado ao tamanho da página) |
| **Index Entry Reads em Paginação** | 0 | 0 | **Derivado de regras oficiais: seek direto sem leituras adicionais de entradas** `[Derived]` |
| **Projeção de Dados (`GET /songs`)** | Entidade completa (~3,5 KiB/música com letras e cifras) | Entidade completa | **`SongSummary` DTO + `query.select(...)`** (~0,35 KiB/música, -90% egress no Firestore e na Vercel) |
| **Contadores (`GET /counts`)** | 4 scans integrais com `.get()` (~1.746 reads em Premium) | `.count().get()` | **4 chamadas `.count().get()`**, faturadas estritamente a 1 read por 1.000 entradas de índice por agregação (Total: 4 a 6 reads) |
| **Integrantes (`GET /members`)** | 1 query + $M$ gets individuais ($N+1$ round trips) | Batch lookup com `db.getAll()` | **1 RPC Batch via `db.getAll()`** (reduz $N$ round trips de rede para 1; document reads permanecem $M$) |
| **Comentários de Escalas (`GET /comments`)** | Scan irrestrito de todo o histórico | Limite de 50 mensagens recentes | **Limite de 50 + suporte a cursor `olderCursor`** (inversão cronológica e preservação de histórico completo) |
| **Fallback em Caso de Índice Ausente** | Inexistente (código original não usava índices) | Fallback silencioso para full scan em memória | **Erro estruturado em Produção (`INDEX_REQUIRED_OR_QUERY_ERROR`)** (sem fallback silencioso) + log sanitizado |
| **Configuração de Deploy de Índices** | Nenhuma | Nenhuma | **`firebase.json` e `backend/firestore.indexes.json`** versionados para `firebase deploy --only firestore:indexes` |
| **Bootstrap Autenticado** | 6 endpoints disparados em paralelo no carregamento | 6 endpoints disparados | **Carregamento sob demanda por rota**: Dashboard só carrega contadores, classificações e escalas; repertório carrega sob demanda |

---

## 2. Derivação Exata da Matemática de Paginação e Billing do Firestore

### 2.1 Distinção Conceitual de Métricas de Paginação
- **Page Size**: 20 documentos (volume solicitado pelo cliente para exibição).
- **Documents Fetched**: Até 21 documentos (a query backend executa `.limit(limit + 1)` para detectar deterministamente se há próxima página sem disparar uma query de contagem adicional).
- **Document Reads Billed**:
  - Em páginas intermediárias (`hasMore = true`): **21 document reads**.
  - Na última página (`hasMore = false`): **Entre 1 e 20 document reads**.
- **Index Entry Reads**:
  - `[Index Entry Billing: Derived / Not Measured]`
  - O Firestore fatura document reads e index-entry read operations como métricas de cobrança distintas quando index-entry billing se aplica. Na query paginada com composite index `(ministry_id, updated_at, __name__)`, o cursor executa seek contíguo. Como Query Explain ainda não foi executado sob carga instrumentada em ambiente dedicado, registra-se formalmente `Index Entry Billing = Derived / Not Measured`.
- **Total Billed Read Operations**: **21 document reads** em páginas intermediárias; **$\le 20$ document reads** na página final (mais eventuais index-entry read operations computadas separadamente sob regra oficial quando aplicável).

---

## 3. Tabela de Custo Real por Página (Página 1, Página 2 e Página Profunda)

| Plano Comercial | Base de Músicas ($S$) | Page Size | Docs Buscados (Pág 1 / Pág 2 / Deep) | Document Reads (Pág 1 / Pág 2 / Deep) | Index Entry Reads | Total Billed Read Ops (Pág 1 / Pág 2 / Deep) | Economia vs. Offset em Deep Page |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Free** | 50 | 20 | 21 / 21 / 8 | 21 / 21 / 8 | Derived 0 | **21 / 21 / 8 ops** | -84,0% (8 vs 50 reads) |
| **Lite** | 100 | 20 | 21 / 21 / 20 | 21 / 21 / 20 | Derived 0 | **21 / 21 / 20 ops** | -80,0% (20 vs 100 reads) |
| **Essential** | 200 | 20 | 21 / 21 / 20 | 21 / 21 / 20 | Derived 0 | **21 / 21 / 20 ops** | -90,0% (20 vs 200 reads) |
| **Pro** | 500 | 20 | 21 / 21 / 20 | 21 / 21 / 20 | Derived 0 | **21 / 21 / 20 ops** | **-96,0%** (20 vs 500 reads) |
| **Premium (Comercial)** | 1.500 | 20 | 21 / 21 / 20 | 21 / 21 / 20 | Derived 0 | **21 / 21 / 20 ops** | **-98,7%** (20 vs 1.500 reads) |
| **Enterprise (Stress)** | 3.000 | 20 | 21 / 21 / 20 | 21 / 21 / 20 | Derived 0 | **21 / 21 / 20 ops** | **-99,3%** (20 vs 3.000 reads) |

> **Conclusão**: Com a paginação por cursor, o custo de leitura permanece estritamente $O(1)$ ($\le 21$ reads por página) independentemente da profundidade acessada (página 1 ou página 150).

---

## 4. Análise de Necessidade do `orderBy(__name__, 'desc')`

- **Comportamento do Firestore**: O Firestore inclui implicitamente `__name__` como desempate final em todos os índices.
- **Necessidade no SDK**: Para que o método `.startAfter(cursorTimestamp, cursorDocId)` funcione de forma determinística quando há múltiplos documentos com o mesmo `updated_at`, a query precisa declarar explicitamente o segundo campo de ordenação (`FieldPath.documentId()`).
- **Impacto de Custo**: Como ambos os campos (`updated_at` e `__name__`) seguem a mesma direção (`DESC`) e estão indexados no composite index `[ministry_id ASC, updated_at DESC, __name__ DESC]`, a ordenação composta é executada diretamente pelo índice sem custo de ordenação em memória ou varredura de entradas extras de índice.
- **Decisão**: **Manter `orderBy(FieldPath.documentId(), 'desc')` explícito** para garantir 100% de estabilidade e ausência de duplicações/omissões entre páginas.

---

## 5. Medição e Redução de Egress (Firestore $\to$ Vercel e Vercel $\to$ Browser)

Com a implementação de `query.select(...)` no `RepertoireRepository.ts`:
- **Caso Anterior (Caso A)**: Firestore transferia o documento completo para o backend Node.js (Vercel), e o backend projetava `SongSummary` para o browser.
- **Caso Final (Caso B)**: Firestore transfere **apenas os campos projetados** via `query.select(...)` para o backend Node.js, e o backend envia `SongSummary` para o browser.

### Comparativo de Egress (Para Lote de 20 Músicas):

| Fluxo de Rede | Documento Completo (Antes) `[Derived]` | SongSummary Projetado (Depois) `[Derived]` | Redução Real de Egress | Classificação |
|---|:---:|:---:|:---:|:---:|
| **Firestore $\to$ Vercel Backend** | ~70,0 KiB (3,5 KiB/doc com letras/cifras) | **~7,0 KiB** (0,35 KiB/doc) | **-90,0%** | `[Derived from Schema]` |
| **Vercel Backend $\to$ Browser PWA** | ~70,0 KiB | **~7,0 KiB** | **-90,0%** | `[Derived from Schema]` |

---

## 6. Modelagem e Decisão Final de Busca Textual (`filters.search`)

### 6.1 Matriz de Campos da Busca Textual Atual

| Campo de Busca | Comportamento Atual | Valor de Negócio / Intenção do Usuário | Compatível com Firestore Nativo? |
|---|---|---|---|
| `title` | Substring case-insensitive | **Crítico**: Busca por nome da música digitado pelo músico. | Parcial (suporta prefixo `>=`, `<=`; não substring arbitrária) |
| `artist` | Substring case-insensitive | **Alto**: Busca por banda, cantor ou ministério. | Parcial (suporta prefixo; não substring) |
| `lyrics` | Substring case-insensitive | **Médio-Alto**: Busca por trecho memorizado da letra do louvor. | **Não** (requer scan completo ou engine full-text dedicado) |

### 6.2 Estratégias Analisadas

1. **Strategy A (Full Scan Isolado no Ministério com Debounce)**:
   - *Mecanismo*: Busca em memória restrita às músicas do ministério quando `filters.search` está presente. Listagens normais usam cursor.
   - *Prós*: Preserva 100% da experiência de busca em letras e títulos; zero complexidade de infraestrutura.
   - *Contras*: $O(S)$ reads por busca.
2. **Strategy B (Prefix Search Normalizado)**:
   - *Mecanismo*: Campos indexados `normalized_title` e `normalized_artist` com query de range (`>= q` e `< q + \uf8ff`).
   - *Prós*: Custo de leitura fixo $O(\text{limit})$.
   - *Contras*: Não busca em letras e não encontra substrings no meio de palavras.
3. **Strategy C (Token Index Interno no Firestore)**:
   - *Mecanismo*: Array de n-grams/tokens em cada documento de música.
   - *Prós*: Busca substring sem full scan.
   - *Contras*: Alta amplificação de escritas no Firestore, aumento de tamanho dos documentos e limite de index entries por documento.
4. **Strategy D (External Search Engine — Typesense / Algolia)**:
   - *Mecanismo*: Sincronização de catálogo para motor de busca externo.
   - *Prós*: Full-text de alta qualidade, tolerância a erros de digitação e alta velocidade.
   - *Contras*: Adiciona serviço externo, custo fixo e complexidade de sincronização. Reservado para roadmap.

### 6.3 Modelo de Custo e Sensibilidade da Busca Textual no Plano Premium (300M / 1.500S / R$ 214,90)

| Frequência de Busca / Sessão | Buscas / Mês | Reads de Busca / Mês | Custo Busca (BRL) | Custo Não-Busca Direto (BRL) | Custo Total Direto Infra (BRL) | Direct Infra Ratio | Contribution after Direct Modeled Infra |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **1 busca / sessão** | 3.360 | 5.040.000 | R$ 28,43 | R$ 2,82 | **R$ 31,25 / mês** | **14,54%** | **R$ 183,65 / mês** |
| **2 buscas / sessão** | 6.720 | 10.080.000 | R$ 56,86 | R$ 2,82 | **R$ 59,68 / mês** | **27,77%** | **R$ 155,22 / mês** |
| **3 buscas / sessão** (Baseline) | 10.080 | 15.120.000 | R$ 85,28 | R$ 2,82 | **R$ 88,11 / mês** | **41,00%** | **R$ 126,79 / mês** |
| **4 buscas / sessão** | 13.440 | 20.160.000 | R$ 113,71 | R$ 2,82 | **R$ 116,53 / mês** | **54,23%** | **R$ 98,37 / mês** |
| **5 buscas / sessão** | 16.800 | 25.200.000 | R$ 142,14 | R$ 2,82 | **R$ 144,96 / mês** | **67,45%** | **R$ 69,94 / mês** |
| **10 buscas / sessão** | 33.600 | 50.400.000 | R$ 284,28 | R$ 2,82 | **R$ 287,10 / mês** | **133,60%** | **-R$ 72,20 / mês** (Déficit operacional de infra) |

### 6.4 Latência Estimada de Busca `[Assumption / Estimated]`
- Em uma base Premium de 1.500 músicas, o download compactado de dados consome **~120ms a 220ms** de latência de rede no Firestore e **~5ms** de CPU Node.js para filtragem em memória.
- Com o debounce de 300ms no cliente PWA, a busca dispara somente quando o usuário conclui a digitação.

### 6.5 Decisão Técnica Oficial de Busca (Search Decision 1 Aprovada)
- **Decisão**: Adotar **Strategy A (Full Scan com Debounce)** para o lançamento v1.
- **Justificativa Quantitativa**: No plano Premium (mensalidade de R$ 214,90), o custo mensal total direto de infraestrutura no baseline de 3 buscas/sessão é de **R$ 88,11 (41,00% do preço)**, preservando uma contribuição positiva direta de **R$ 126,79 / mês**. As quotas comerciais de catálogo (50 a 1.500 músicas) garantem que a base nunca cresça sem controle.

---

## 7. Segurança do Cursor Token e Isolamento de Tenant

- **Natureza do Token**: O cursor token é uma serialização opaca em base64url contendo `{ id, u, m }`. Não é um token criptograficamente assinado, mas sim um token de detalhe de implementação.
- **Garantia de Isolamento de Tenant**: O escopo de tenant **NÃO depende do cursor**. A query do Firestore aplica obrigatoriamente `.where('ministry_id', '==', authorizedMinistryId)` derivado do JWT e contexto autenticado. O campo `m` do cursor atua como camada de defesa adicional (fail-fast caso haja adulteração do token).

---

## 8. Persistência de Timestamp e Tipagem do Cursor

- **Tipo Persistido no Firestore**: `string` (formato ISO 8601 UTC gerado via `new Date().toISOString()`).
- **Tipo Serializado no Cursor**: `string` (campo `u` no JSON base64url).
- **Tipo Reconstruído na Query**: `string` (repassado diretamente a `query.startAfter(cursor.u, cursor.id)`).
- **Compatibilidade**: 100% alinhado com a semântica de ordenação lexicográfica e cronológica de strings ISO 8601 no Firestore.

---

## 9. Governança Operacional e Triggers de Revisão da Busca (Search Roadmap Triggers)

1. **Pre-Production Staging Gate**: Medição empírica de latência real sob carga (P50, P95, P99) em bases de 500, 1.500 e 3.000 músicas quando o ambiente de staging com Firestore dedicado estiver ativo.
2. **Search Revision Triggers**:
   - **Latência**: P95 de busca superior a 400ms em produção.
   - **Faturamento**: Componente de leituras de busca ultrapassar 50% do total da fatura do Firestore.
   - **Utilização**: Média de buscas por sessão observada nos logs superior a 4 buscas/sessão no plano Premium.
   - **Aproximação de Quota**: Organizações Premium acumulando mais de 1.200 músicas ativas.
   - **Migração Planejada**: Ativação da **Strategy B (Prefix Search Indexado)** ou **Strategy D (Typesense)** conforme o gatilho atingido.
