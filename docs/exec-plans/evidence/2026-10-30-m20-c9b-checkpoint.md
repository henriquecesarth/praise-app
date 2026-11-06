---
tags:
  - louvaio
  - m20
  - checkpoint
  - handoff
status: checkpoint
---

# M20-C9B — checkpoint e migração entre computadores

Data: 2026-10-30. Objetivo exclusivo: preservar a WIP publicável no GitHub e permitir retomada em outro computador. **Não continuar a implementação do PDF nesta execução.**

## Referência de recuperação

- Repositório público: `henriquecesarth/praise-app`.
- Branch de origem: `feat/m20-phase-2a-android-share`.
- HEAD base antes do checkpoint: `e3c4902e0d8786e164ea0686486c564f9dea1578`.
- Referência remota planejada: tag anotada `m20-c9b-checkpoint-20261030`.
- O SHA definitivo é o commit apontado pela tag: `git rev-parse m20-c9b-checkpoint-20261030^{commit}`. Não confundir o SHA do objeto da tag anotada com o SHA do commit.
- Publicação autorizada somente dessa tag; nenhum push em `main`, force-push, merge, promoção ou deployment. A comprovação do push e do clone limpo deve constar da entrega desta execução; não presumir sucesso apenas pela existência deste documento.

## Estado confirmado de homologação

| Área | Estado / origem da evidência |
|---|---|
| Backend e Web Preview | Funcionando; confirmado pelo proprietário e pelas verificações C9B |
| Login e autenticação | PASS; login e perfil HTTP 200, sete verificações reportadas PASS pelo operador |
| WAF | PASS externo: dez POSTs vazios HTTP 400, décimo primeiro HTTP 429; sem bypass, cookies ou credenciais reais |
| Firebase Staging | Projeto exclusivo `louvaio-staging`, banco `(default)`; guardas Preview, JWT e allowlist preservados |
| Índice do repertório | `songs`, escopo `COLLECTION`, `ministry_id ASC`, `updated_at DESC`, `__name__ DESC`; índice `CICAgOjXh4EK`, criado isoladamente e confirmado READY |
| Consulta ao repertório | HTTP 200 observado em logs após criação do índice, `2026-10-30T19:43:46.423Z` |
| Listagem Smart Chords | HTTP 200 em leitura autenticada sem cache, `2026-10-30T19:47:16.321Z`; respostas 304 anteriores eram revalidações de cache |
| Importação e alinhamento por texto | PASS, confirmação de homologação do proprietário nesta solicitação |
| Salvamento, reabertura e persistência | PASS, confirmação do proprietário; criação HTTP 201 e listagem HTTP 200 também observadas em logs anteriores |
| Vínculo Smart Chords ↔ Repertório | PASS, confirmação de homologação do proprietário |
| Transposição | PASS, confirmação de homologação do proprietário |

Backend homologado: `https://praise-qfx0vflvn-henriquecesarths-projects.vercel.app`, deployment `dpl_RrFL9sHamR4sPUb36jaXQt1XaFUL`. Projeto Vercel Backend: `praise-app`; Web: `praise-app-m7tn`. Não confundir projeto Vercel com projeto Firebase.

As evidências acima não significam que toda a WIP foi novamente testada nesta migração. Testes e builds anteriores são preservados nos checkpoints; não repetir suítes de produto apenas para criar commit/tag.

## Pendência que deve orientar a retomada

**PDF NÃO CONCLUÍDO.** O PDF baixado apresenta traços/sublinhados e diferenças em relação à pré-visualização.

- Investigar `web/src/components/SmartChordsWorkspace.tsx`, em especial o caminho de exportação e os estilos do elemento `printable-sheet-pdf`.
- Preservar o processamento no navegador; não introduzir serviço/backend de PDF como parte desta pendência.
- Comparar pré-visualização e arquivos PDF reais curtos, médios e longos.
- Reutilizar `web/e2e/smart-chord-pdf-review.spec.ts` e `web/scripts/review-smart-chord-pdf.mjs` quando pertinentes; testes existentes não substituem revisão visual dos PDFs reais.
- Não interpretar os PASS de importação, alinhamento e transposição como conclusão da exportação PDF.

## Inventário e preservação

- Inventário inicial: 70 arquivos rastreados modificados, zero staged e 116 arquivos novos; 127 entradas no status resumido, que agrupa diretórios.
- Mudanças distribuídas entre Backend, Web, Mobile, workflows manuais e documentação. Preservar também mudanças anteriores fora de C9B; não fazer limpeza ou refatoração incidental.
- Runtime de agentes consultado: somente `/root` ativo; nenhum agente filho concorrente. Processos externos independentes: **Unknown / Not yet verified**.
- Código de aquisição HTML/CifraClub, fixtures de teste, controles Preview, integração Android, testes e scripts reprodutíveis fazem parte da seleção publicável.
- PDFs/imagens gerados para revisão, captura HTTP bruta, snapshot de banco e relatório bruto de execução ficam fora do Git público. Seus arquivos locais originais são mantidos; eles não são necessários para instalar dependências ou compilar o código.
- Identificadores privados de dispositivo em documentos/evidências são substituídos por marcador somente nas versões preparadas para publicação. Os arquivos originais permanecem no working tree local. Essa diferença intencional de privacidade não é perda de código ou de alterações funcionais.
- A seleção é por lista explícita de arquivos; não usar `git add .` para incluir artefatos não auditados.

## Segurança da publicação

- Nunca incluir `.env`, Service Account, PEM privado, tokens, bypasses, logs privados, caches, builds ou arquivos pessoais/de usuários.
- `.env.example` e configurações cliente Firebase já rastreadas são referências de configuração; não são Service Accounts. Não acrescentar novas credenciais privadas para tornar o clone executável.
- A auditoria usa nomes de arquivos, tipos de ocorrência e linhas; valores de segredos não devem aparecer na saída nem neste checkpoint.
- Workflows revisados: quatro somente `workflow_dispatch`; os dois restantes têm `push.branches` restritos a branches de validação. Nenhum possui gatilho de tag. A tag não deve iniciar esses workflows.
- O segredo de bypass exposto anteriormente pertence ao Backend `praise-app`; rotação concluída: **Unknown / Not yet verified**. Não reproduzir seu valor nem presumir rotação concluída.
- Exposição do Preview histórico `praise-f1271jy7o`: causa específica ainda **Unknown / Not yet verified**; não remover proteções sem autorização.
- Recusa hospedada de segunda identidade staging válida fora da allowlist: **Unknown / Not yet verified**, pois não há resultado confirmado dessa execução no histórico disponível. Isso não altera os sete PASS de autenticação do usuário autorizado.
- O diagnóstico temporário Preview de `UserRepository.ts` continua na WIP; retirada posterior exige revisão e autorização própria de publicação.

## Recuperar em outro computador

```powershell
git clone --branch m20-c9b-checkpoint-20261030 https://github.com/henriquecesarth/praise-app.git praise-app-m20-c9b
cd praise-app-m20-c9b
git rev-parse HEAD
git switch -c resume/m20-c9b-pdf
```

Criar uma branch nova a partir da tag evita confundir a branch remota antiga com o commit do checkpoint. A branch remota de origem não é atualizada por um push exclusivo de tag.

Instalação posterior, no computador de destino: usar os manifests/lockfiles preservados (`npm ci` em `backend/` e `web/`; `flutter pub get` em `mobile/`). Conferir versões locais de Node/npm, Flutter/Dart, JDK e Android SDK antes de executar builds. Não iniciar serviços contra Production por ausência de configuração local.

Dependências locais fora do Git:

1. Credenciais e variáveis privadas: configurar por canal privado/console autorizado; nunca transportar pelo Git público. O backend deve continuar usando somente staging para homologação.
2. Sessões Firebase CLI, Vercel CLI e GitHub CLI: autenticar novamente no novo computador; não copiar caches de autenticação, `.env.local` com OIDC ou segredos de bypass.
3. `mobile/android/local.properties`, SDKs, emuladores e ferramentas do computador: regenerar localmente. Arquivos específicos de configuração staging/QA devem ser provisionados separadamente se necessários.
4. Helpers temporários `louvaio-c9b-login.py` e `louvaio-c9b-compare.py`: ficam no diretório temporário do computador original, fora da árvore de produto. Não são dependências de build; não incluí-los com identificadores pessoais ou credenciais.
5. PDFs reais, screenshots e capturas excluídos da publicação: se ainda necessários à análise visual, transferir por canal privado autorizado ou gerar novamente com os scripts e fixtures. Não afirmar que esses artefatos privados são recuperáveis pelo clone público.
6. O índice Firestore é configuração remota já criada; o clone preserva sua declaração, mas não duplica nem implanta índices automaticamente.

## Validação obrigatória da referência publicada

Verificar a tag anotada e seu commit com `git ls-remote` e com a API GitHub. Em clone limpo separado, conferir SHA, árvore de arquivos, manifests/lockfiles, fixtures, scripts PDF, este documento e painel Obsidian; comparar blobs com a seleção auditada. O clone não pode receber arquivos da pasta original para disfarçar dependências ausentes. Verificar novamente segredos e arquivos proibidos na árvore recuperada. Confirmar que `main` não mudou por ação desta execução e que nenhum workflow de tag/deployment foi disparado pelo checkpoint.

## Documentos relacionados

- [[00-PAINEL|Painel Obsidian]]
- [[exec-plans/evidence/2026-10-30-m20-c9b-web-preview-preflight|Histórico C9B, segurança, WAF e diagnóstico]]
- [[exec-plans/evidence/2026-10-29-m20-c9a-backend-preview-deployment|Publicação inicial do Backend Preview]]
- [[exec-plans/active/2026-10-27-m20-phase-2-7-real-image-import|ExecPlan de importação por imagem]]
- [[exec-plans/active/2026-10-28-m20-direct-html-import-proof|Aquisição HTML e importação]]
- [[operations/m20-phase-2-6-firebase-staging|Isolamento Firebase Staging]]
- [[01-CONTEXTO-ATUAL|Contexto operacional]]

Após concluir a preservação e a validação remota, **parar**. A próxima sessão poderá retomar exclusivamente a pendência PDF mediante solicitação do proprietário.
