# P1 — Regressão musical independente

Base exclusiva: origin/release/m20-r16-web-backend, 29d09f1b2cf1d94aa8f5e84d77f906a6a88ae6f8.
Branch: parallel/regression-musical-20261107. Nenhum merge, deploy ou acesso a produção.

## Plano
1. Auditar utilitário musical, contratos API, repositórios e testes existentes.
2. Adicionar fixtures musicais e testes de lacunas sem duplicar cobertura existente.
3. Demonstrar defeitos antes de corrigir; aplicar mudanças mínimas em utilitários/backend.
4. Validar builds, testes web/backend isolados e Git; publicar commits e confirmar remoto.
5. Entregar handoff para cherry-pick seletivo na baseline M21/D2-A.

## Auditoria inicial
- Smart Chords: já cobre progressões, tablaturas, fontes e roundtrip simples; faltam transposição de raízes minúsculas aceitas pelo parser e preservação de linhas somente com espaços.
- Repertório: API web representa versões, mas schemas HTTP removem versions/notes e createSong não persiste esses campos; listagem projeta apenas metadados legados. Correção completa exige harmonizar contratos e projeção: diferida para segunda-feira, sem introduzir feature parcial.
- Repertório: faltam testes de atualização parcial e remoção explícita de classificação preservando metadados.
- Escalas: já cobre duplicatas, duração, conflitos civis e CreateScheduleModal; faltam testes de ordem de músicas/programação e limpeza explícita de participantes na persistência.
- Isolamento pessoal/canônico: smart_chord.feature.test.ts e smart_chord_repertoire_link.test.ts já cobrem anti-IDOR, portabilidade e não compartilhamento; reutilizar regressão existente.
- Vitest web: jsdom; backend: projeto demo e hosts locais de emulador. Novos testes de persistência substituirão Firebase por mocks.
- Playwright: 12 combinações de viewport/tema, preview local e Chrome; sem alteração de UI planejada.

## Resultado
Concluído localmente: 39 casos novos (37 aprovados, 2 falhas esperadas documentadas); três defeitos reproduzidos e corrigidos. Web: 620 aprovados. Backend relevante: 187 aprovados e 2 falhas esperadas. Builds backend e Web local (--mode test) aprovados. Build Web padrão bloqueado pela guarda de publicação existente. Playwright Gate 2: 8 aprovados, API simulada. Nenhuma alteração de UI/áudio.

Commits de implementação: fd5c3c3184cc9449d933ce3460b3b657d33db3fd e 65c1ce9a15cc9270fdc46d1aab07c62cc13d12af. Entrega documental e publicação na branch autorizada são os passos finais; confirmação de SHA remoto consta do relatório final.

Handoff: docs/development/PARALLEL_WORK_HANDOFF_20261107.md. Correção ampla de versões, concorrência real e integração física do Firestore permanecem pendentes conforme handoff. Revisão de diff e varredura de padrões de segredos sem ocorrências. Sem alterações em MEMORY.md: decisões e limites específicos desta entrega ficam no handoff para evitar conflito com o estado antigo.
