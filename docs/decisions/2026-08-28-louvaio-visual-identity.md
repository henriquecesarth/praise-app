# Decisão Arquitetural: Adoção da Identidade Visual Oficial LouvAIO

- **Data**: 2026-08-28
- **Status**: Aceita e Implementada
- **Contexto**: A aplicação passou por reformulação visual e reposicionamento de marca, evoluindo de Praise App para LouvAIO, com pacote oficial de ativos de branding, paleta de cores corporativa, tokens centralizados e PWA atualizado.

## Decisão

1. **Paleta Oficial**:
   - **Verde Escuro (`#0F2A1F`)**: Cor institucional para Sidebar, BottomNav ativo no tema escuro, cabeçalhos de peso e áreas institucionais.
   - **Terracota (`#B85A3C` / `#C96F52` no Dark)**: Ações primárias (`.btn-primary`), CTAs, badges ativas, foco de acessibilidade e estados selecionados.
   - **Creme (`#F5EFE6` / `#0B1913` no Dark)**: Fundo amplo das telas (`--bg-main`), cartões de superfície e sensação serena/acolhedora.
   - **Preto (`#121212` / `#F5EFE6` no Dark)**: Texto de alta ênfase (`--text-main`).

2. **Ativos de Marca em `/public/branding/`**:
   - `/branding/logos/logo-primary.png`: superfícies claras (login e interfaces claras);
   - `/branding/logos/logo-inverse.png`: superfícies escuras (sidebar institucional e modo noturno);
   - `/branding/logos/logo-compact-white.png`: sidebar recolhida e ícone compacto;
   - `/branding/pwa/icon-192.png`, `/branding/pwa/icon-512.png`, `/branding/pwa/icon-maskable-512.png`: ícones do manifesto PWA;
   - `/branding/icons/app-icon-terracotta-1024.png` e favicons (`favicon.ico`, `apple-touch-icon.png`).

3. **Arquitetura de Estilos e Tokens**:
   - Tokens definidos em `web/src/styles/louvaio-brand.css` e consumidos por `web/src/index.css`.
   - Objeto TypeScript tipado em `web/src/theme/louvaioTheme.ts`.
   - Proibição estrita de `overflow-x: hidden` global para mascarar transbordamentos.

4. **Contenção Responsiva e Acessibilidade**:
   - Matriz validada em 6 viewports (320px, 360px, 375px, 390px, 412px, 430px) nos modos Light e Dark;
   - Touch targets mínimos de 44×44px;
   - Suporte a safe areas (`env(safe-area-inset-*)`).

## Consequências

- O produto possui identidade visual premium, musical e serena, alinhada à marca LouvAIO;
- Todos os contratos de API, autenticação e regras de negócio permaneceram 100% inalterados;
- 100% de aprovação na suíte de testes Playwright E2E e unitários.
