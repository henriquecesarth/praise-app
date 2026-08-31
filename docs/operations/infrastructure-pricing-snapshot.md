# Snapshot Oficial de Preços de Infraestrutura — LouvAIO

**Data do Snapshot**: 2026-08-29  
**Versão**: 3.0.0 (Reconciliação Final de Infraestrutura)  
**Moeda Base dos Provedores**: USD (Dólar Americano)  
**Câmbio Utilizado**: **1 USD = 5,19 BRL** (Cotação mid-market em 2026-08-29; Fontes: Wise, Xe, Trading Economics)  
**Status**: Fase de Auditoria e Modelagem Financeira Concluída  

---

## 1. Fontes Oficiais Consultadas

Todas as tarifas foram coletadas exclusivamente das fontes oficiais de documentação e precificação:
- **Google Cloud / Cloud Firestore**: [`https://cloud.google.com/firestore/pricing`](https://cloud.google.com/firestore/pricing)
- **Google Cloud / VPC Network Pricing**: [`https://cloud.google.com/vpc/network-pricing`](https://cloud.google.com/vpc/network-pricing)
- **Firebase / Identity Platform**: [`https://cloud.google.com/identity-platform/pricing`](https://cloud.google.com/identity-platform/pricing) e [`https://firebase.google.com/pricing`](https://firebase.google.com/pricing)
- **Vercel Platform & Compute**: [`https://vercel.com/docs/pricing`](https://vercel.com/docs/pricing) e [`https://vercel.com/pricing`](https://vercel.com/pricing)

---

## 2. Região e Configuração de Infraestrutura

`[Observed from code]` / `[Unknown / must verify in provider dashboards]`
- **Região do Firestore**: `Firestore region: UNKNOWN / must verify in Firebase Console`.
  - *Cenário US*: `us-central1` (Iowa) / Multi-região US.
  - *Cenário São Paulo*: `southamerica-east1` (São Paulo).
- **Região da Função Vercel**: `Repository-configured function region: not explicitly set; Platform default for new projects: iad1; Actual deployed project setting: UNKNOWN until Dashboard verification`.
- **Status do Firebase Authentication / Identity Platform**: `Identity Platform status: UNKNOWN / must verify in Firebase Console`.
  - *Como verificar*: Acesse `Firebase Console > Authentication > Settings`. Se o botão *"Fazer upgrade para o Identity Platform"* estiver visível, o projeto está na versão padrão gratuita de e-mail/senha.

---

## 3. Tabela A — Catálogo Oficial de Tarifas dos Provedores (Normalizado)

`[Observed Pricing]`

| Provedor | Componente / Recurso | Franquia Incluída | Preço Overage (USD) | Unidade Normalizada | Região | Nível de Confiança | Fonte Oficial |
|---|---|---|---|---|---|:---:|---|
| **Google Cloud** | Firestore Reads (US) | 50.000 reads/dia (1,5M/mês) | **$0,30** | por 1M reads ($0,03/100k) | `us-central1` | Alto | [Cloud Firestore](https://cloud.google.com/firestore/pricing) |
| **Google Cloud** | Firestore Writes (US) | 20.000 writes/dia (600k/mês)| **$0,90** | por 1M writes ($0,09/100k)| `us-central1` | Alto | [Cloud Firestore](https://cloud.google.com/firestore/pricing) |
| **Google Cloud** | Firestore Deletes (US)| 20.000 deletes/dia (600k/mês)| **$0,10** | por 1M deletes ($0,01/100k)| `us-central1` | Alto | [Cloud Firestore](https://cloud.google.com/firestore/pricing) |
| **Google Cloud** | Firestore Storage (US)| 1 GiB gratuito | **$0,18** | por GiB-mês ($0,0002466/GiB-h)| `us-central1` | Alto | [Cloud Firestore](https://cloud.google.com/firestore/pricing) |
| **Google Cloud** | Firestore Reads (SP) | 50.000 reads/dia (1,5M/mês) | **$0,45** | por 1M reads ($0,045/100k)| `southamerica-east1`| Alto | [Cloud Firestore](https://cloud.google.com/firestore/pricing) |
| **Google Cloud** | Firestore Writes (SP) | 20.000 writes/dia (600k/mês)| **$1,35** | por 1M writes ($0,135/100k)| `southamerica-east1`| Alto | [Cloud Firestore](https://cloud.google.com/firestore/pricing) |
| **Google Cloud** | Firestore Deletes (SP)| 20.000 deletes/dia (600k/mês)| **$0,15** | por 1M deletes ($0,015/100k)| `southamerica-east1`| Alto | [Cloud Firestore](https://cloud.google.com/firestore/pricing) |
| **Google Cloud** | Firestore Storage (SP)| 1 GiB gratuito | **$0,25** | por GiB-mês ($0,0003425/GiB-h)| `southamerica-east1`| Alto | [Cloud Firestore](https://cloud.google.com/firestore/pricing) |
| **Google Cloud** | Internet Egress (Tier 1: 0-1 TB) | 10 GiB/mês gratuito | **$0,12** | por GiB excedente | Worldwide (Premium Tier) | Alto | [VPC Network Pricing](https://cloud.google.com/vpc/network-pricing) |
| **Google Cloud** | Internet Egress (Tier 2: 1-10 TB)| — | **$0,11** | por GiB excedente | Worldwide (Premium Tier) | Alto | [VPC Network Pricing](https://cloud.google.com/vpc/network-pricing) |
| **Google Cloud** | Internet Egress (Tier 3: 10 TB+) | — | **$0,08** | por GiB excedente | Worldwide (Premium Tier) | Alto | [VPC Network Pricing](https://cloud.google.com/vpc/network-pricing) |
| **Firebase Auth** | E-mail/Senha (Padrão) | Ilimitado / Gratuito base | **$0,00** | por MAU | Global | Alto | [Firebase Pricing](https://firebase.google.com/pricing) |
| **Identity Platform**| E-mail/Senha (Tier 1) | Até 50.000 MAU free | **$0,0055** | por MAU (50k – 100k) | Global | Alto | [Identity Platform](https://cloud.google.com/identity-platform/pricing) |
| **Identity Platform**| E-mail/Senha (Tier 2) | — | **$0,0046** | por MAU (100k – 1M) | Global | Alto | [Identity Platform](https://cloud.google.com/identity-platform/pricing) |
| **Identity Platform**| E-mail/Senha (Tier 3) | — | **$0,0032** | por MAU (1M – 10M) | Global | Alto | [Identity Platform](https://cloud.google.com/identity-platform/pricing) |
| **Vercel Pro** | Plataforma Base | Inclui 1 seat + $20 usage credit | **$20,00** | por seat/mês | Global | Alto | [Vercel Pricing](https://vercel.com/docs/pricing) |
| **Vercel Compute** | Invocations | 1.000.000 incluídas | **$0,60** | por 1M excedentes | `iad1` (US-East) | Alto | [Vercel Pricing](https://vercel.com/docs/pricing) |
| **Vercel Compute** | Active CPU (Fluid) | 4 CPU-horas incluídas | **$0,128** | por CPU-hora excedente | `iad1` (US-East) | Alto | [Vercel Pricing](https://vercel.com/docs/pricing) |
| **Vercel Compute** | Provisioned Memory | 360 GB-horas incluídas | **$0,0106** | por GB-hora excedente | `iad1` (US-East) | Alto | [Vercel Pricing](https://vercel.com/docs/pricing) |
| **Vercel Edge** | Edge Requests | 10.000.000 requests incluídas | **$2,00** | por 1M excedentes | Anycast Global | Alto | [Vercel Pricing](https://vercel.com/docs/pricing) |
| **Vercel Network** | Fast Origin Transfer (FOT)| 10 GB/mês incluídos | **$0,06** | por GB excedente | Anycast Global | Alto | [Vercel Pricing](https://vercel.com/docs/pricing) |
| **Vercel Network** | Fast Data Transfer (FDT) | 1 TB (1.000 GB)/mês incluído | **$0,15** | por GB excedente | Anycast Global | Alto | [Vercel Pricing](https://vercel.com/docs/pricing) |

---

## 4. Ordem e Metodologia de Faturamento Vercel Pro

A cobrança da Vercel segue estritamente a sequência operacional oficial:

```
                  CONSUMO BRUTO DE RECURSOS (Usage)
                                  │
                                  ▼
      DEDUÇÃO DE ALOCAÇÕES INCLUÍDAS POR RECURSO (Included Allocations)
      - Invocations: 1M
      - Active CPU: 4h
      - Provisioned Memory: 360 GB-h
      - Edge Requests: 10M
      - Fast Origin Transfer: 10 GB
      - Fast Data Transfer: 1.000 GB (1 TB)
                                  │
                                  ▼
          USO BRUTO FATURÁVEL (Billable Infrastructure Usage)
          (Soma dos excedentes multiplicados pelas tarifas unitárias)
                                  │
                                  ▼
             APLICAÇÃO DO CRÉDITO MENSAL PRO ($20 Credit)
             Vercel Usage Overage = max(0, Billable Usage - $20.00)
                                  │
                                  ▼
             FATURA FINAL DA VERCEL (Total Vercel Invoice)
             Total = Platform Base Fee ($20.00) + Vercel Usage Overage
```
