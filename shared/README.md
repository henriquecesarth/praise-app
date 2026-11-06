# Contrato musical M21 v1

`vocal-exercises.json` e o catalogo musical original desta implementacao. Os padroes didaticos usam escalas/arpejos comuns; a fonte sonora e licenciada separadamente (ver shared/audio/upright-kw.json).

Notas são inteiros MIDI 0–127; cada duração positiva é medida em semínimas (beats), independentemente do BPM. Notas e durações têm o mesmo comprimento. Segundos = beats × 60 / BPM (40–180). Frequência = 440 × 2^((midi-69)/12).

Uma repetição transpõe TODAS as notas pelo mesmo número inteiro de semitons. A faixa válida é a interseção de minTranspose/maxTranspose com [tessituraMin-menorNota, tessituraMax-maiorNota]. Nunca limitar notas individualmente. Faixa vazia é erro; a reprodução não começa. Progressão ascendente percorre a faixa do grave ao agudo; descendente percorre do agudo ao grave, em passos de um semitom. Cada repetição termina antes da seguinte começar.

Configuração de sessão não pertence à definição do exercício. Modelo admite durações fracionárias; agendamento deve usar offsets absolutos, não contar ticks inteiros. Parar, desmontar ou interromper o app deve cancelar o áudio pendente.

Catalogo e banco de piano sao empacotados localmente para offline. Web R1 usa gravacoes acusticas FreePats Upright KW (CC0-1.0), projetadas em14regioes MIDI48-88, sem biblioteca de terceiros. Dados WAV e manifesto sao portaveis para futuros backends Flutter/Android/iOS; integracao nativa adiada ate aprovacao auditiva Web. O sintetizador anterior recebeu FAIL humano por timbre e estalos. A nova fonte ainda requer audicao humana; nao declarar PASS por testes automatizados.

Agendamento v1: nota sustentada por82% da duracao nominal, mantendo o proximo onset no beat exato; um beat de descanso entre frases. Backend de timbre independente da timeline. O piano Web R1 preserva ataque/decaimento gravados e adiciona release0,6s, fades de15ms nas transicoes, crossfade10ms nos loops e limite de8vozes com headroom. Metronomo usa o mesmo relogio e bus de saida. AudioContext determina fim da reproducao, incluindo caudas; pausa aguarda fade pelo relogio de audio. Android R1 ainda nao integrado.