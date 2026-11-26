# Memória do projeto (decisões duráveis)

Histórico completo: `docs/history/MEMORY-ate-2026-11.md` (buscar trechos; não carregar inteiro). Regras de arquitetura e segurança: `AGENTS.md`. Decisões: `docs/decisions/`.

- Produto: LouvAIO (antes Praise App), gestão de ministérios de louvor.
- Marca: verde `#0F2A1F`, terracota `#B85A3C`, creme `#F5EFE6`, preto `#121212`.
- Áudio (M22, ADR `docs/decisions/2026-11-18-m22-audio-hub-and-libraries.md`): separação inicial só na Web, Demucs ONNX 6 faixas no navegador, sem GPU de servidor nem API paga.
- Só duas bibliotecas persistentes: Ministerial e LouvAIO (por assinatura); sem biblioteca pessoal.
- Stems em Cloudflare R2 privado, com acesso autorizado pelo backend.
