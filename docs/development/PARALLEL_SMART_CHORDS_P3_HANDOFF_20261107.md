# P3 — Robustez de Notação Avançada — 2026-11-07

Base: `parallel/smart-chords-notation-20261107` no commit `6267adf13e5c8a663f7d418342f9dd696240274e`.
Branch: `parallel/smart-chords-notation-p3-20261107`.

## Alterações

- Parser de progressões reconhece acordes completos com extensões em parênteses: `C7(b9)`, `F#m7(b5)`, `C(add9)` e `C(add9)/E`, mantendo o sufixo durante transposição.
- Diferencia um acorde opcional `(Am)` de uma extensão, inclusive em `C(Am)`.
- Evita classificar progressões com hífen como tablatura; mantém linhas de tablatura com técnicas intactas.
- Inclui `web/src/utils/smart_chord_notation.robustness.test.ts` com 19 fixtures e 1.000 combinações determinísticas, verificando tokens, offsets, anotações e transposição.
- Arquivos modificados/criados apenas no motor independente e seu teste. Nenhuma ligação com editor, PDF ou persistência.

## Validação realizada

- TypeScript estrito (`tsc --strict --target ES2022 --module commonjs`) sobre o parser e as funções auxiliares de acorde **extraídas literalmente do arquivo atual do repositório**: PASS.
- Script local de validação Node com 19 fixtures, quatro verificações adicionais e 1.000 combinações: **1.023 verificações aprovadas**.
- Importante: o teste local utiliza cópia dos métodos empregados pelo parser, não build integral do repositório nem Vitest. Os testes Vitest foram adicionados e **ainda não foram executados no repositório completo** (dependências do projeto não disponíveis neste ambiente e acesso git local externo indisponível).
- Build Web, compilação geral, Playwright, integração visual, Android/iOS, PDF e persistência: **Unknown / Not yet verified**.
- Nenhum merge e nenhuma promoção para produção.
- O push para a branch disparou automaticamente deployments de prévia no Vercel (target=null). Dois foram cancelados; os demais precisam ser inspecionados. Produção não foi promovida manualmente.

## Para integração na segunda-feira

1. Preservar e publicar o trabalho local do M21/D2-A no computador antigo, inclusive os 674 registros WIP.
2. Validar a branch P3 com `cd web && npm ci && npm test && npm run build -- --mode test` num checkout limpo e isolado, sem dados de produção.
3. Comparar o parser e seus testes com o D2-A antes de aplicar cherry-pick; evitar substituição de arquivos em massa.
4. Verificar editor visual, alinhamento de anotações em fonte menor, ancoragem de notas acima do acorde, round-trip, PDF, salvamento e reabertura.
5. Continuar testando variantes não reconhecidas e não ativar o recurso por padrão sem os gates reais.

## Limites

A P3 protege a sintaxe e melhora a transposição em um motor isolado. Não torna o Cifrador completo, não resolve o comportamento visual e não certifica deploy.