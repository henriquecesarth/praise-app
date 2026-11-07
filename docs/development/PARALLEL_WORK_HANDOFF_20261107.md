# P1 — Handoff de regressão musical, 07/11/2026

Branch independente: `parallel/regression-musical-20261107`.
Base exclusiva confirmada por fetch: `release/m20-r16-web-backend`, `29d09f1b2cf1d94aa8f5e84d77f906a6a88ae6f8`.
Nenhum merge, deploy, alteração de main, M21, áudio ou redesign. Nenhum acesso a dados de produção.

## Commits de implementação

1. `fd5c3c3184cc9449d933ce3460b3b657d33db3fd` — preserva espaços/tabs em linhas vazias na transposição e normaliza raízes minúsculas já aceitas pelo parser.
2. `65c1ce9a15cc9270fdc46d1aab07c62cc13d12af` — evita defaults de criação em atualizações parciais de escalas e acrescenta regressões de persistência, permissões e contrato Web do repertório.
3. Commit documental: `docs: record parallel musical regression handoff`; localize com `git log --oneline -- docs/development/PARALLEL_WORK_HANDOFF_20261107.md` (não há autorreferência de SHA).

## Arquivos e testes

- `web/src/utils/smart_chord.ts`: duas correções mínimas, sem alteração de parser/renderizador ou UI.
- `web/src/utils/smart_chord.parallel.test.ts`: 14 casos; extensões, inversões, raízes minúsculas, transposição negativa/positiva e além da oitava, espaços/tabs, âncoras silábicas, anotações, tablaturas e conversão/serialização de folha mista.
- `web/src/api.repertoire.parallel.test.ts`: 6 casos HTTP simulados; múltiplas versões, criação, edição e remoção de versão secundária, IDs/metadados/classificações, patch de título e compatibilidade legada. Esses testes validam o cliente, não persistência end-to-end de versões.
- `backend/src/features/schedules/schedule.types.ts`: remove os defaults apenas no schema de atualização; criação continua com duração 120 e visibilidade true.
- `backend/src/repositories/musical.parallel.test.ts`: 9 casos aprovados de atualização parcial, ownership, classificação, ordenação, remoção de participantes e preservação de atribuição; 2 casos `it.fails` reproduzem as lacunas HTTP de versões/notes.
- `backend/src/features/schedules/schedule.permissions.parallel.test.ts`: 8 casos exercitam o RBAC real das rotas (membro não escreve, admin escreve e membro lê), com lookup ministerial simulado.
- Documentação: este handoff, `docs/development/testing.md` e `docs/exec-plans/completed/parallel-regression-musical-20261107.md`.

Total novo: **39 casos, sendo 37 aprovados e 2 falhas esperadas explícitas**. Não confundir as falhas esperadas com suporte backend a versões.

## Defeitos reproduzidos e corrigidos

- `c#m7 + 1`, `bb/F + 2`, `g/b - 2` eram aceitos, mas não transpostos corretamente. Esperados musicais: Dm7, C/G, F/A. Testes falharam antes da normalização da raiz.
- Transpor uma folha apagava conteúdo de linhas somente com espaços/tabs, inclusive com zero semitons. Testes falharam antes de recuperar o texto original dessas linhas.
- Editar somente título de escala com duração 240 e isVisible false gravava 120 e true. Teste schema → repository com documento em memória falhou antes da remoção dos defaults no update.

## Auditoria, lacunas e limites

- Suítes existentes já cobrem progressões, tablaturas, fontes, vínculos canônicos, portabilidade pessoal, anti-IDOR e isolamento por usuário/ministério. Foram executadas as regressões existentes em vez de duplicá-las.
- Conflitos de disponibilidade já têm cobertura de intervalos, adjacência, meia-noite, calendário e duração. Não foi alterada sua política consultiva.
- **Pendente para segunda-feira:** Web envia `versions`/`notes`, mas createSongSchema/updateSongSchema removem esses campos; createSong também não os persiste, e a projeção da listagem não os inclui. Os dois `it.fails` mantêm a reprodução executável. Solução completa exige revisar schemas, persistência, projeção, classificações por versão e consumidores junto à baseline recuperada; não foi implementada parcialmente.
- Concorrência entre edições simultâneas do mesmo array de versões e integração física Firestore: **Unknown / Not yet verified**. Mocks não comprovam transações reais. Não foi introduzido contrato de revisão/optimistic locking.
- Não houve teste de fontes em dispositivo físico nem validação de motores de áudio.
- Regressão backend limitada aos módulos relevantes; suíte backend completa não executada. Integração física de emulador não executada: **BLOCKED — infraestrutura de emulador não provisionada nesta tarefa**.

## Validação executada

- Web `npm test`: **620 aprovados / 32 arquivos**.
- Backend, 10 arquivos relevantes: **179 aprovados + 2 falhas esperadas / 181 casos**; permissões, arquivo adicional: **8 aprovados**. Total: 187 aprovados + 2 falhas esperadas.
- Backend `npm run build`: aprovado.
- Web `npm run build`: **BLOCKED pela guarda existente**, `Verified publish environment required`.
- Web `npm run build -- --mode test`: aprovado; build local, sem habilitar identidade de publicação. Aviso de chunk acima de 500 kB permanece.
- Playwright `SMART_CHORD_GATE2_EVIDENCE_DIR=/private/tmp/p1-gate2 SMART_CHORD_SKIP_SCREENSHOTS=1 npm run test:e2e -- --config playwright.gate2.config.ts`: **8 aprovados**, Chrome, 1920/1366/768/390, claro/escuro, Vite local e API interceptada. Não equivale à suíte E2E completa nem a homologação de produção. A execução precisou liberação do sandbox para escutar na porta local 4175.
- `git diff --check`: aprovado; revisão de diff e varredura por padrões de chaves/tokens/atribuições sensíveis sem ocorrências nos arquivos entregues. Gitleaks não instalado; verificação não equivale a auditoria de todo o histórico.
- Dependências existentes reutilizadas; sem instalação ou alteração de lockfiles.

Reprodução da regressão backend:

```sh
cd backend
npm test -- src/repositories/musical.parallel.test.ts src/repositories/RepertoireRepository.test.ts src/repositories/ScheduleRepository.test.ts src/features/schedules/schedule.feature.test.ts src/features/schedules/schedule.permissions.parallel.test.ts src/features/availability/conflict-engine.test.ts src/features/availability/availability-time.test.ts src/features/smart_chords/smart_chord.feature.test.ts src/features/smart_chords/smart_chord_repertoire_link.test.ts src/features/smart_chords/smart_chord_normalizer.test.ts src/features/smart_chords/portuguese_syllabifier.test.ts
```

## Integração seletiva na segunda-feira, 09/11/2026

Preservar primeiro o computador antigo e seus 674 registros WIP. Não executar os comandos abaixo sobre workspace sujo. Recuperar e identificar a baseline M21/D2-A antes de iniciar; seu SHA final é **Unknown / Not yet verified**. Não presumir que R16 contém M20 integrado `4e4690eb`, M21 `f3aed6cd` ou homologações posteriores.

Após backup e recuperação da baseline, em checkout limpo e branch de integração própria:

```sh
git fetch origin parallel/regression-musical-20261107
git status --short
# <baseline-recuperada> deve ser confirmada no computador antigo.
git switch -c integration/p1-musical <baseline-recuperada>
git show --stat fd5c3c3184cc9449d933ce3460b3b657d33db3fd
git cherry-pick fd5c3c3184cc9449d933ce3460b3b657d33db3fd
git show --stat 65c1ce9a15cc9270fdc46d1aab07c62cc13d12af
git cherry-pick 65c1ce9a15cc9270fdc46d1aab07c62cc13d12af
```

Selecionar apenas os commits úteis após comparar com a baseline recuperada. Não há merge automático. Em conflito, revisar cada trecho ou usar `git cherry-pick --abort`; nunca substituir arquivos inteiros da baseline pelo conteúdo R16.

Riscos de conflito: utilitário smart_chord.ts pode ter evoluído no leitor D2-A; schedule.types.ts depende de Zod 4 e da API removeDefault; testes de contrato podem divergir se M21 já corrigiu versões. Se os `it.fails` passarem na baseline recuperada, convertê-los em testes normais e ampliar persistência end-to-end com mocks antes de integrar. App.tsx, SongDetail.tsx e SmartChordsWorkspace.tsx não foram modificados.

Reexecutar builds locais, Web Vitest, regressão backend acima e Playwright relevante após cada integração. Comparar SHA remoto da entrega com `git ls-remote origin refs/heads/parallel/regression-musical-20261107`; a confirmação final de publicação será registrada no relatório da execução.
