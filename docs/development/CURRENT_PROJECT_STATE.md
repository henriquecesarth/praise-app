# LouvAIO — Estado Atual do Projeto (`CURRENT_PROJECT_STATE.md`)

**Última atualização:** 2026-11-09
**Branch de Continuidade:** `handoff/louvaio-workstation-migration`
**Repositório:** `https://github.com/henriquecesarth/praise-app` (Visibilidade: **PÚBLICO**)

---

## 1. Visão Geral por Plataforma (Web, Backend e Android)

| Camada | Estado Atual | Baseline / Checkpoint de Referência | Observações |
| :--- | :--- | :--- | :--- |
| **Backend (`backend/`)** | Operacional e Certificado (R16) | `release/m20-r16-web-backend` (`29d09f1`) | API Express + TypeScript + Firestore. Rotas de Repertório, Smart Chords, Preferências de Usuário (`chordFontFamily`, `chordLineSpacingPx`), Escalas, Liturgias, WhatsApp e Billing Asaas V1. |
| **Web (`web/`)** | Operacional com M20 R16 + M21 Vocal + Design D2-A | `29d09f1` + `f3aed6cd` (M21) + `D2-A` | SPA/PWA React 19 + Vite + Tailwind v4. Inclui módulo de Exercícios Vocais (M21 com 14 samples FreePats Upright Piano KW) e implementação completa do **D2-A** (Design System v1.0 + Leitor Musical Dedicado com Rolagem Automática). |
| **Android / Flutter (`mobile/`)** | Operacional e Homologado (M20 + M21 Vocal R4) | `release/m20-r16-android-production` (`11b5797`) + `f3aed6cd` (M21) | Cliente Flutter com paridade de Repertório/SmartChords M20 e player nativo de Exercícios Vocais M21 (`just_audio`, 14 samples WAV em `mobile/assets/audio/upright-kw/`), homologado em aparelho físico Android (`SM-S911B`). |

---

## 2. Estado dos Marcos Recentes (M20, M21, D1 e D2-A)

### 2.1. Marco M20 (Repertório, Smart Chords, Preferências, PDF A4 e Android Share)
- **Status:** **CONCLUÍDO E CERTIFICADO EM PRODUÇÃO (R16)**.
- **Web/Backend R16:** Commit `29d09f1b2cf1d94aa8f5e84d77f906a6a88ae6f8` (`release/m20-r16-web-backend`).
- **Android M20 Production:** Commit `11b57976b56130d79ecbe032f8b442358fc8f796` (`release/m20-r16-android-production`).
- **Integração Unificada Web+Backend+Mobile M20:** Commit `4e4690eb2d0032c485a571c81c0a2a2f2e06e9b0`.

### 2.2. Marco M21 (Módulo de Exercícios Vocais — Web & Android)
- **Status:** **IMPLEMENTADO E HOMOLOGADO LOCALMENTE (Checkpoints R3 e R4)**.
- **Checkpoint M21 R3:** Commit `f3aed6cdb487f965985f2cfcce5d89d414af5e3b`.
- **Recursos incluídos:**
  - Motor de piano amostrado (`web/src/audio/sampled-piano.ts`, `mobile/lib/features/vocal/` e `mobile/android/app/src/main/kotlin/com/louvaio/louvaio_mobile/vocal/`) usando 14 amostras reais **FreePats Upright Piano KW** (CC0) de MIDI `48` a `88`.
  - 14 arquivos WAV presentes em `web/public/audio/upright-kw/` e em `mobile/assets/audio/upright-kw/` (mais `README.md`, `cc0.txt`, `readme.txt`, `manifest.json`).
  - Evidências de homologação em dispositivo Android real (`SM-S911B`) e Web registradas em `docs/exec-plans/2026-11-06-m21-2-r2-android-handoff.md` e `docs/exec-plans/evidence/m21-2/`.

### 2.3. Fase Design D1 (Auditoria Visual, Design System v1.0 e Prototipagem)
- **Status:** **CONCLUÍDA E APROVADA PELO PROPRIETÁRIO**.
- **Checkpoint D1:** Commit `dfe3b96120dff6d61da4e112f15241296bf6d940` (`m21-vocal-checkpoint-r4-d1`).
- **Artefatos em `docs/design/`:**
  - `docs/design/LouvAIO_Design_System_v1_0.md`
  - `docs/design/D1_Auditoria_Visual_e_Inventario.md`
  - `docs/design/D1_Especificacao_Repertorio_e_Cifras.md`
  - `docs/design/D1_Design_Review_Package.md`
  - `docs/design/prototypes/repertorio-desktop-mobile.html`
  - `docs/design/prototypes/cifras-inteligentes-desktop-mobile.html`

### 2.4. Fase Design D2-A (Fundação do Design System e Leitor Musical Profissional)
- **Status:** **CONCLUÍDA E VALIDADA COM EVIDÊNCIAS REAIS (`PASS`)**.
- **Relatório e Evidências:** `docs/exec-plans/2026-11-06-d2-a-design-system-reader.md` e 8 capturas reais de navegador + JSON de métricas em `docs/exec-plans/evidence/d2-a/`.
- **Entregas realizadas em `web/src/`:**
  - Unificação dos tokens CSS e de tema (`web/src/styles/louvaio-brand.css`, `web/src/index.css`, `web/src/theme/louvaioTheme.ts`) com contraste WCAG AA garantido nos modos Claro (`:root`) e Escuro (`.dark`).
  - Padronização de campos flutuantes (`FloatingInput`, `FloatingSelect`, `FloatingTextarea`), botões e barras de ação.
  - **Leitor Musical Dedicado (`SmartChordReader.tsx`)**: abre automaticamente no modo `Visualizar` (`read`) ao selecionar uma cifra na biblioteca, apresentando cabeçalho compacto (`SmartChordToolbar.tsx`), transposição (`-1` / `Reset` / `+1`), controle de rolagem automática (`Iniciar`, `Pausar`, `Retomar`, `Parar` + velocidade `1x`–`5x` sobre o conteúdo real renderizado), modo de tela cheia (`Tela cheia`) e menu compacto `Aparência da leitura` (fonte, tamanho `10–24px`, espaçamento `0–24px`).
  - Preservação integral do alinhamento de acordes sobre a sílaba (`rawToVisual` / `visualToRaw`), edição inline de acordes na sílaba, tablaturas, progressões de compassos, exportação PDF A4 e separação estrita entre `Editar` e `Visualizar`.

---

## 3. Decisões de Design Aprovadas pelo Proprietário

1. **Marca:** `LouvAIO` (sem sufixo "2.0"). Preservar logotipo oficial e identidade Verde Profundo (`#0F2A1F`), Terracota (`#B85A3C` / `#AE5235`) e Creme (`#F5EFE6`).
2. **Referências:** Arquitetura de informação, listas densas e navegação discreta inspiradas no **Linear**; fluxos musicais, leitura de cifras e controles de palco inspirados no **Planning Center / Music Stand**.
3. **Separação estrita de fluxos em Cifras Inteligentes:** Biblioteca (`Minhas Cifras`), Leitor Dedicado (`Visualizar`) e Editor (`Editar`) operam como telas/modos exclusivos — **nunca** exibir 3 colunas simultâneas nem editor e preview fixos lado a lado.
4. **Intocabilidade da lógica musical e motores de áudio:** Preservar o posicionamento caractere a caractere de acordes sobre a sílaba, edição inline sem painel gigante opcional e não alterar o motor de áudio M21 (`sampled-piano.ts`).

---

## 4. Branches Paralelas P1–P8 do Smart Chords e PRs Relevantes

### Branches Paralelas no Remoto (`origin`) para Integração Seletiva Pós-Migração
- `origin/parallel/regression-musical-20261107` (`fd4abf27ce167093127f381127e88b992e0e0e36`)
- `origin/parallel/smart-chords-notation-20261107` (`6267adf13e5c8a663f7d418342f9dd696240274e`)
- `origin/parallel/smart-chords-notation-p3-20261107` (`604c3ef2a0c037db27bf44beb634e9e14d29bc7f`)
- `origin/parallel/smart-chords-p4-p6-20261107` (`3e8e2cfc38b3b43d5dfad30c047b0bf628974712`)
- `origin/parallel/smart-chords-p7-p8-20261107` (`1bac4f5529376dfb443f0eae8c517c4d8efefbad`)

> **Diretriz para integração P1–P8:** Integrar seletivamente os avanços de notação/parser musical e testes de regressão dessas branches sobre a linha de continuidade, **preservando o D2-A como referência para o leitor e editor visual**.

### PRs e Restrições de Governança
- **PRs #21, #22 e #23:** Não modificar, fechar ou fazer merge sem autorização explícita.
- **Branch `main`:** Não fazer push direto ou merge sem autorização explícita.

---

## 5. Preservação WIP do Computador Anterior

- O workspace original `praise-app` possuía **674 registros WIP** (`git status --porcelain -uall`), compostos majoritariamente por 608 artefatos históricos em `docs/exec-plans/` (capturas, PDFs de comparação e logs locais das fases M19/M20) e rascunhos pré-R16 já superados pela baseline certificada `29d09f1` / `11b5797`.
- Como o repositório `henriquecesarth/praise-app` no GitHub é **PÚBLICO**, a branch de arquivo WIP bruta (`archive/wip-pre-workstation-migration-20261109`) **não foi publicada no GitHub** por segurança operacional e privacidade, sendo preservada integralmente em bundle Git local (`backups/wip-preservation-20261109/louvaio-wip-674-20261109.bundle`).
- Todo o código certificado M20 (Web/Backend R16 + Android M20), todo o módulo M21 Vocal (com os 14 samples FreePats), todos os documentos e protótipos D1, toda a implementação e evidências D2-A e todas as configurações de agentes (`AGENTS.md`, `GEMINI.md`, `.codex/`, `.agents/`) estão **100% incluídos na branch de continuidade `handoff/louvaio-workstation-migration`**.

---

## 6. Próxima Tarefa Recomendada

1. No novo computador, validar a revisão visual proprietária do **D2-A** (Leitor Musical Dedicado e Design System v1.0).
2. Executar a **integração seletiva das branches paralelas P1–P8 do Smart Chords** sobre a branch de trabalho derivada de `handoff/louvaio-workstation-migration`, preservando a interface D2-A.
3. Iniciar a etapa **D2-B** (Redesign da Biblioteca de Repertório, filtros compactos e tela de detalhes/versões da música conforme `docs/design/D1_Especificacao_Repertorio_e_Cifras.md`).
