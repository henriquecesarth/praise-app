# LouvAIO — D2-A: Design System v1.0 e Leitor Musical Profissional

**Data:** 2026-11-06 / 2026-11-09
**Workspace:** `<repo-root>`
**Status:** `PASS` (Validado com testes automatizados Vitest + build Vite + renderização e capturas reais em navegador Chromium via Playwright)

---

## 1. Escopo Executado (Missões 1 a 5)

### Missão 1 — Fundação do Design System v1.0
- **Arquivos atualizados:**
  - `web/src/styles/louvaio-brand.css`
  - `web/src/index.css`
  - `web/src/theme/louvaioTheme.ts`
  - `web/src/components/ui/FloatingInput.tsx`
  - `web/src/components/ui/FloatingSelect.tsx`
  - `web/src/components/ui/FloatingTextarea.tsx`
- **Padronizações aplicadas:**
  - **Marca:** `LouvAIO` (sem sufixo "2.0"), preservando logotipo oficial e paleta Verde Profundo (`#0F2A1F`), Terracota (`#B85A3C` / `#AE5235` acessível WCAG AA 5.02:1 no modo claro) e Creme (`#F5EFE6`).
  - **Superfícies e bordas:** Tokens semânticos `--bg-app`, `--bg-surface`, `--bg-surface-subtle`, `--bg-surface-elevated`, `--bg-sidebar`, `--border-subtle`, `--border-strong` e `--focus-ring`, mantendo aliases legados (`--bg-main`, `--surface-color`, `--border-color`, `--primary-color`) para zero regressão nos demais módulos.
  - **Campos de formulário e botões:** Contraste WCAG AA em `:root` e `.dark`, foco visível (`2px solid var(--focus-ring)`), suporte completo a `options` e `children` em `FloatingSelect`.

### Missão 2 — Leitor Musical Dedicado e Rolagem Automática
- **Arquivos atualizados/criados:**
  - `web/src/components/smart-chords/SmartChordReader.tsx`
  - `web/src/components/smart-chords/SmartChordToolbar.tsx`
  - `web/src/components/smart-chords/SmartChordsLibrary.tsx`
  - `web/src/components/SmartChordsWorkspace.tsx`
  - `web/src/components/smart-chords/workspace.css`
- **Entregas:**
  1. Ao selecionar uma cifra existente na biblioteca, o workspace abre diretamente no **Leitor Musical Dedicado (`data-workspace-mode="read"`)**, sem distrações de formulário.
  2. Cabeçalho compacto (`SmartChordToolbar`) com botão `← Biblioteca`, título da música, status de salvamento (`role="status"`), alternador `Editar` / `Visualizar`, `Exportar PDF`, `Salvar cifra` e menu `•••` (`Configurações do PDF` e `Excluir`).
  3. Transposição `-1` / `Reset` / `+1` com badges de `Tom Original` e `Tom Atual`.
  4. Controles de tamanho de fonte (`10px–24px`), espaçamento entre linhas (`0px–24px`, passo `2px`) e seletor de família tipográfica (`monospace`, `Arial`, `Times New Roman`, `Georgia`, `Verdana`, `Courier New`) agrupados no menu compacto `Aparência da leitura`.
  5. Alternância de tela cheia (`Tela cheia` / `Sair da tela cheia`) integrada à Fullscreen API com fallback seguro de container CSS (`data-reader-fullscreen="true"`).
  6. **Rolagem automática (`Rolagem: Iniciar / Pausar / Retomar / Parar`)** com velocidade ajustável (`1x` a `5x`, operando em `px/s` diretamente sobre o container real renderizado `data-testid="reading-sheet-scroll"`, sem duração fictícia de música).
  7. Sincronização automática com rolagem manual (roda do mouse, toque ou teclado), pausa automática quando a tela/aba fica inativa (`visibilitychange`, `blur`, troca para modo `Editar` ou abertura de modal) e término previsível ao atingir o fim do documento (`scrollTop >= scrollHeight - clientHeight`).
  8. Respeito integral a `prefers-reduced-motion: reduce` (bloqueia início automático por padrão, exibe aviso `Movimento reduzido ativo` com opção explícita de permitir/desativar a qualquer momento e tecla `Escape`).
  9. Cache local de leitura offline por usuário e ministério (`louvaio_offline_smart_chords:{userId}:{ministryId}`) acionado quando `navigator.onLine === false`.

### Missão 3 & 4 — Preservação Musical Obrigatória e Edição Separada
- **Alinhamento caractere a caractere:** Preservado integralmente via `rawToVisual` / `visualToRaw` com posicionamento absoluto do acorde acima da sílaba exata.
- **Edição inline de acordes:** Mantida diretamente sobre a sílaba, linha vazia, final de linha (`+`) e acordes de progressão de compassos (`|| Am7 | F9 | C | G/B | % ||`), com sugestões de campo harmônico.
- **Tablaturas e PDF A4:** Renderização monoespaçada de tablaturas (`[data-musical-tablature]`) e pré-visualização/exportação PDF A4 com margens de `10mm` (`190mm` úteis) sem regressão.
- **Separação estrita Editar vs. Visualizar:** Verificada via DOM/CSS computado (`inReadMode: editorDisplay = "none", readerDisplay = "flex"`; `inEditMode: editorDisplay = "flex", readerDisplay = "none"`). Nunca exibe 3 painéis simultâneos nem editor e preview lado a lado.

---

## 2. Evidências Reais de Validação (Missão 5)

- **Testes automatizados focados (Vitest):**
  - `src/components/ui/FloatingFields.test.tsx`: `PASS` (1/1)
  - `src/components/smart-chords/SmartChordToolbar.test.tsx`: `PASS` (2/2)
  - `src/components/smart-chords/SmartChordDedicatedReader.test.tsx`: `PASS` (5/5)
  - `src/components/SmartChordsWorkspace.test.tsx`: `PASS` (57/57)
  - **Total:** `4 passed (4), 65 passed (65)`.
- **Capturas reais do navegador (Playwright Chromium em `docs/exec-plans/evidence/d2-a/`):**
  - `01-desktop-library-light.png` (`1366×860`, Modo Claro, Biblioteca)
  - `02-desktop-reader-light.png` (`1366×860`, Modo Claro, Leitor Dedicado)
  - `03-desktop-reader-autoscroll-active.png` (`1366×860`, Rolagem Automática em execução)
  - `04-desktop-reader-dark.png` (`1366×860`, Modo Escuro, Leitor Dedicado)
  - `05-desktop-editor-light.png` (`1366×860`, Modo Claro, Editor Separado)
  - `06-mobile-library-light.png` (`390×844`, Mobile Biblioteca)
  - `07-mobile-reader-light.png` (`390×844`, Mobile Leitor Dedicado Claro — `hasHorizontalOverflow: false`)
  - `08-mobile-reader-dark.png` (`390×844`, Mobile Leitor Dedicado Escuro — `hasHorizontalOverflow: false`)
  - `d2a-browser-verification-report.json` (Métricas reais de alinhamento em `monospace`, `Arial` e `Georgia`, overflow `0px`, estados de rolagem e separação Editar/Visualizar).
