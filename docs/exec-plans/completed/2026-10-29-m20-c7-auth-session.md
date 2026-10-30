# M20-C7 — autenticação e sessão

Base: C6 em `../evidence/2026-10-29-m20-c6-review.md`. Branch
`feat/m20-phase-2a-android-share`, HEAD `e3c4902e0d8786e164ea0686486c564f9dea1578`.
WIP existente preservado. Sem commit, deploy, alterações remotas ou dispositivo.

## Contrato e responsáveis

- `/root/auth_fix`: único escritor de repository/notifier/interceptor/ApiClient
  mobile e testes de autenticação; fencing de intenção, geração e identidade real
  Firebase, com recuperação limitada de cancelamentos.
- `/root/secondary`: fixtures JWT Preview e mkdir do workflow staging.
- `/root/security_review`: revisão independente somente leitura de auth/share.
- Principal: integração, regressão dirigida de Share, evidência e entrega.

## Verificação

Testes dirigidos: login/signup atrasados após logout, logins concorrentes,
troca A/B, `/auth/me` obsoleto, geração normal, falha/recuperação e Share
pendente sem ministério. Verificar disponibilidade de Emulator local;
nenhuma escrita de produção. Análise estática, diff/check e revisão separada.
Não repetir C4C/C5D. Implementação, testes controlados e revisão concluídos:
59 auth, 16 Share, 17 JWT e 32 revalidações PASS; análise estática PASS.
SDK real/emulator BLOCKED no carregamento Chrome/CanvasKit; próximo gate
dirigido documentado na evidência C7. Fonte/review PASS não aprova release.

## Gate

Somente liberar próxima homologação se os fences forem demonstrados pelos
testes e revisão. Release e configuração hospedada: **Unknown / Not yet verified**.
