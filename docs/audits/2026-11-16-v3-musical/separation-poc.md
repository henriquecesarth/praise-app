# Protocolo: separação local CPU, quatro faixas

Status: proposta independente. Execução **NOT_EXECUTED**. Não baixar modelos, instalar runtimes, processar áudio, integrar backend ou acessar produção na Fase 0.

## Comparação de candidatos

| Família / opção | Quatro saídas e CPU | Custos / riscos | Posição |
| --- | --- | --- | --- |
| Demucs `htdemucs` | vocals/drums/bass/other; CPU documentada | Código MIT; repositório original arquivado. Fixar checkpoint, verificar termos dos pesos separadamente | Candidato inicial, condicionado à diligência |
| Demucs `htdemucs_ft` / modelos anteriores | Fine tuning e alternativas da família | Mais trabalho computacional; comparar somente se baseline justificar | Segunda rodada; não começar com modelos de mais categorias |
| Open-Unmix `umxhq` | Quatro stems, PyTorch, offline | Código MIT, memória e termos do checkpoint precisam verificar. `umxl` declara CC BY-NC-SA 4.0 e não pode ser tratado como livre para qualquer uso | Comparador inicial, condicionado à licença específica |
| Spleeter 4stems | CPU e TensorFlow | Dependências/compatibilidade a reproduzir. Artigo declara MIT para código/modelos; confirmar licença aplicável ao peso escolhido, sem deduzir de dataset | Terceiro candidato opcional |
| UVR / checkpoints comunitários MDX/VR/RoFormer | Ferramenta/ecossistema, capacidade varia por checkpoint | Não é um modelo único; diferentes licenças, memória e alvos | Só avaliar checkpoint identificável após baseline |

“Gratuito” não é garantia de redistribuição/uso comercial. Distinguir código, pesos, dataset e áudio do usuário. Licença comercial/redistribuição do checkpoint Demucs exato e `umxhq`: **Unknown / Not yet verified** nesta auditoria, sem afirmar proibição. Download de pesos pode exigir rede uma vez; inferência deverá funcionar offline sem API paga. Não embutir pesos no Pacote de Ensaio.

Fontes primárias: [Demucs](https://github.com/facebookresearch/demucs), [licença Demucs](https://github.com/facebookresearch/demucs/blob/main/LICENSE), [Open-Unmix](https://github.com/sigsep/open-unmix-pytorch), [FAQ de memória](https://github.com/sigsep/open-unmix-pytorch/blob/master/docs/faq.md), [Spleeter](https://github.com/deezer/spleeter), [artigo Spleeter](https://github.com/deezer/spleeter/blob/master/paper.md), [UVR](https://github.com/Anjok07/ultimatevocalremovergui). Consultadas 2026-11-16. Números promocionais GPU e estimativas upstream não serão usados como resultado CPU do LouvAIO.

## Preparação fora do produto, após autorização futura

1. Criar pasta isolada fora do checkout de execução e virtualenv/runtime próprio; não alterar package.json/pubspec/backend nem usar credenciais. Fixar versões de Python/runtime/decoder, lock e hashes de pesos/fontes. Configurar CPU explicitamente e registrar ausência de CUDA/GPU usada; nenhuma chave de API.
2. Hardware de referência proposto: computador x64, >=4 cores, 16 GiB RAM, SSD com >=20 GiB livres; comparação opcional em 8 GiB após baseline. CPU/modelo de máquina real, SO, energia, threads, temperatura e RAM disponível: **Unknown / Not yet verified** até coletar. Alvo precisa ser aceito antes de medir.
3. Corpus de seis gravações próprias/autorizadas: voz+violão, banda densa, gravação ao vivo com reverberação, voz suave/coral, caso com bateria/baixo claros e caso sem um instrumento alvo. Misturar clips de 30 s/60 s e faixas integrais 3–6 min. Não reutilizar áudio real do usuário sem consentimento; guardar direitos e hashes localmente.
4. Quando houver multitracks originais autorizados, criar mix de referência conhecido para métricas objetivas. Sem referência, SDR/SI-SDR = **Unknown / Not yet verified**, não estimar por “ouvido”. Nenhuma obtenção automática de catálogo protegido/dataset.

## Execução e medição futura

Cada candidato usa os mesmos inputs e perfil de saída WAV PCM baseline, 44,1 kHz estéreo; preservar entrada, documentar resample/ganho/normalização e compensação de atraso. Fixar parâmetros, segmentação/overlap, seed e threads; não exigir bit-exatidão de inferência sem teste. Processar serialmente. Uma execução fria (inclui carregamento) e aquecimento identificado, depois três execuções medidas por item; registrar todas, mediana e amplitude.

Log por run: id/versões/hash, segundos de entrada, tempo de load/inferência/encode/total, RTF=`wallSeconds/inputSeconds`, pico RSS e RAM do sistema, CPU user/system e utilização com convenção explícita (100% por core versus agregado), erros/OOM, disco temporário/pico, bytes de modelos/stems/pacote, sample rate/canais/frames/offset de cada stem. Avaliar CPU com amostragem periódica e registrar intervalo; uso instantâneo isolado não mede custo. Energia se disponível: opcional, **Unknown / Not yet verified** até medir.

Qualidade: três ouvintes quando disponíveis, ordem cega aleatória e volume de escuta nivelado, notas 1–5 para vazamento, artefatos, transientes e utilidade para ensaio; registrar trechos ruins e concordância. Não equalizar/loudness-normalizar cada stem exportado separadamente. Com referência autorizada, calcular SI-SDR e SDR com procedimento fixo, sem comparar métricas incompatíveis. Verificar clipping, canais, duração e alinhamento por referência conhecida; soma dos stems pode ter resíduo, não exigir igualdade bit a bit com mix original.

## Gates propostos (critérios, não medições)

- Licenças e direitos do corpus/checkpoint aceitos antes de execução/distribuição; instalação futura autorizada separadamente.
- No alvo 16 GiB: mediana RTF <=5, pico RSS <=8 GiB e sem OOM em faixa de 6 min. Um run >10× real time interrompe esse caso e gera registro. São tetos iniciais negociáveis antes da execução, nunca após para mascarar reprovação.
- Limite de 30 min por run de faixa de 6 min; cancelar se memória/temporários excederem orçamento declarado. Registrar cancelamento, sem polling indefinido.
- Quatro stems completos, mesma origem temporal e totalFrames após normalização; alinhamento <=1 frame em caso controlado. Sem clipping introduzido pelo exportador; ganhagem reversível comum se necessária.
- Mediana >=3/5 por stem em utilidade de ensaio e nenhum caso essencial <2/5 sem limitação registrada; falha veta uso no Modo Culto, não apaga resultado de pesquisa.
- Export/import verificado por hashes, abertura offline Android e decoder Web alvo; corrupção/baixo espaço/cancelamento recuperáveis antes de integração.

Resultados atuais CPU/RAM/tempo/qualidade/tamanho: **Unknown / Not yet verified**. Relatório futuro deve classificar PASS/FAIL/BLOCKED por gate, com logs e identificação de hardware; evitar escolher vencedor só por popularidade. Nenhuma autorização nesta fase para mais stems, processamento mobile/browser, download de modelos ou execução real.
