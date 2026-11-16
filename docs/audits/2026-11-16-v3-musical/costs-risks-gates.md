# Custos, riscos, segurança e prontidão

## Matriz de custos

| Item | Custo monetário / recurso | Limite |
| --- | --- | --- |
| Separação CPU local | Sem API paga obrigatória; usa tempo, energia e RAM do proprietário | Medição real **Unknown / Not yet verified** |
| Modelos/runtime | Download inicial e espaço em disco; licenças podem restringir redistribuição | Sem instalação nesta fase |
| Áudio/stems no LouvAIO | Zero armazenamento/egress central adicional de áudio por desenho | Não significa que API/Firestore existentes tenham custo zero |
| Pacotes/backup local | Disco do usuário, cópias e transferência manual | Sem promessa de backup automático ou retenção garantida |
| Web/Android/iOS | Desenvolvimento, testes em aparelhos, possível licença de tooling/distribuição | Não há orçamento/horas aprovados; **Unknown / Not yet verified** |
| LAN futura | Sem servidor central de áudio; custo de implementação e segurança | Não implementada e fora do gate inicial |

Tamanho estimado e RAM: ver [ADR Local First](../../decisions/2026-11-16-v3-musical-local-first-package.md). Fórmulas, não benchmarks: PCM bytes = duração × sample rate × canais × bits/8; decode float32 = duração × sample rate × canais ×4 × número de stems. FLAC/tempo CPU não admitem taxa garantida antes da POC. Não converter alegação upstream de GPU em expectativa de desktop CPU.

## Matriz de riscos

| Risco | Impacto / probabilidade inicial | Mitigação e gate |
| --- | --- | --- |
| Grafia/enarmonia divergente TS/Dart | Alto / alta pela duplicação observada | Corpus comum e compatibilidade do parser antes de UI |
| Acorde não reconhecido tratado como errado | Médio / média | Resultado unsupported preserva literal; nenhum dado salvo reescrito |
| Vazamento entre conta/ministério/versão | Alto / média | Namespace, geração, testes de troca e vínculo explícito; pacote não confere RBAC |
| Mixer deriva/estala em seek ou loop | Alto / média | Relógio único, PCM normalizado, ensaio de 10 min e medição real |
| Browser/Android sem memória ou disco | Alto / alta para PCM completo | Orçamento prévio, decode incremental a investigar, staging/rollback e erro claro |
| OPFS apagado / permissão de arquivo revogada | Alto / média | Reabrir/reimportar, backup exportável; estado indisponível não vira catálogo vazio |
| ZIP malicioso/corrupção | Alto / média | Limites pelos bytes reais, caminhos seguros, CRC/hash e publicação atômica |
| Licenças de pesos / gravação | Alto / depende do checkpoint/corpus | Diligência por artefato, atribuição, direitos de uso/export; bloqueia distribuição sem clareza |
| Modelo arquivado / dependências incompatíveis | Médio / alta para legado | Versões/hashes fixos, POC isolada, candidato alternativo; sem mexer no produto |
| Baixa separação em música ao vivo | Alto / média | Escuta cega com casos reais autorizados e critérios de qualidade; não prometer instrumento isolado perfeito |
| Background/lockscreen/iOS não homologados | Médio / alta | Separar navegação de background, matriz de dispositivos; não prometer paridade antes do spike |
| Cópia exportada usada fora do direito | Alto / não quantificada | Consentimento informado; sem compartilhamento automático, sem falsa promessa de revogação/DRM |

## Segurança e direitos: limites concretos

Não acessar credenciais, dados reais ou Firestore de produção. Não implementar quota financeira nova, add-on ou mudança de billing. Player local não modifica direitos de uso da assinatura nem projeta novas permissões ministeriais. Função musical (vocal/violão etc.) não é papel de segurança. Cifra compartilhada sob R2.2 não autoriza divulgação de gravação.

Testes futuros precisam cobrir usuário A/B, ministério A/B, mesmo `songId` textual em namespaces distintos, versões excluídas/recriadas, logout durante decode, resposta obsoleta e entrada de manifesto forjada. Pacotes não devem provocar chamadas externas ou leitura de arquivos fora da seleção. Nenhum log de análise recebe áudio, caminhos pessoais, tokens ou nomes de participantes. Hash não autentica origem; sandbox local não protege contra dono/admin do aparelho. Revogação remota não recupera um ZIP exportado.

## Gates para iniciar Fase 1

| Gate | Estado nesta Fase 0 | Evidência / próximo responsável |
| --- | --- | --- |
| G0 Base e escopo | PASS | Git/worktrees/HEAD confirmados; [snapshot](git-reference.json); só documentos novos |
| G1 Aprovação técnica dos ADRs e recorte | NOT_EXECUTED | Proprietário/arquitetura precisam escolher tarefas e aceitar contratos propostos; esta entrega não inicia implementação |
| G2 Vocabulário/corpus musical | NOT_EXECUTED | Proposta existe; executor e revisor validam gramática, políticas de spelling e JSON neutro |
| G3 Alvo de plataformas e recursos | NOT_EXECUTED | Escolher Android mínimo/browser e aparelhos, confirmar teto de RAM, background e pitch-preserving |
| G4 Diligência de áudio/pesos | BLOCKED para execução/distribuição da POC | Checkpoint e corpus autorizados ainda não definidos; nada impede plano de teoria independente |
| G5 Execução POC e medições | NOT_EXECUTED | [Protocolo](separation-poc.md); requer autorização futura, hardware e corpus |
| G6 Pacote e transporte homologados | NOT_EXECUTED | Implementação e testes futuros; condição para player/mixer integrado, não para iniciar especificação |

Prontidão: Fase 0 documental entregue; Fase 1 pode ser autorizada incrementalmente começando pelo contrato/corpus, sem esperar inferência. Player completo e separação não estão prontos para promessa de produto. A ausência de licença confirmada é bloqueador do artefato específico, não proibição inferida de toda pesquisa nem de teoria musical.

## Decisões abertas

1. Ratificar núcleos TS/Dart por contrato versus adoção limitada de Tonal após spike; nenhuma instalação aprovada.
2. Confirmar grafia musical padrão, conjunto inicial de cifras/diagramas e proveniência do catálogo de violão.
3. Selecionar hardware/browser/Android mínimos e definir se iOS é apenas compatibilidade de contrato ou entrega da primeira fase.
4. Ratificar FLAC mestre + WAV baseline e perfil compacto Opus opcional, limites v1, retenção e experiência de backup.
5. Escolher checkpoint autorizado e corpus; fixar budgets/qualidade antes da POC.
6. Confirmar escopo de background/lockscreen e velocidade com pitch preservado; dependem de spike sem degradar M21.
7. Aprovar política de conteúdo offline: arquivo pessoal local continua disponível, vínculo ministerial exige contexto autorizado; revogação de exportações não é tecnicamente garantida.

## Validação desta entrega

Testes/builds de produto, inferência, Android/iOS/browser real, instalações e chamadas de produção: **NOT_EXECUTED**. Fontes externas consultadas, sem escrita em serviços externos.

Validação documental **PASS**: nove arquivos novos; JSON parseável; links relativos existentes; `git diff --check` exit 0 e verificação de whitespace dos arquivos não rastreados por `git -c core.autocrlf=false diff --no-index --check -- NUL <arquivo>` sem diagnósticos. Neste último comando, exit 1 sem diagnóstico representa existência de conteúdo novo, não erro de whitespace. Diff de arquivos rastreados vazio, HEAD preservado. Busca limitada de padrões de chaves privadas/tokens nos nove documentos: zero ocorrências; não é certificação completa de ausência de secrets. Nenhum arquivo de código, dependência ou schema alterado.

Revisão independente `/root/review_v3`, papel `feature-reviewer`: **PASS**, sem achados abertos. Amostrou evidências de versões, parsers/fixtures, M21, PWA e leitura R2.2; confirmou os nove documentos e 19 worktrees. Duas inconsistências de planejamento corrigidas e rechecadas: T1 não depende mais do gate G2 que sua própria revisão entrega; T2 declara `chordTones` e testes consumidos por T3. Nenhum teste/build ou escrita realizado pelo revisor. Modelo configurado do papel: `gpt-6.1-sol` / high; identidade efetiva de inferência: **Unknown / Not yet verified**.
