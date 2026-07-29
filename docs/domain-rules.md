# Regras de Negócio (Domain Rules)

Estas são as regras de negócio críticas do Praise App que **NUNCA** podem ser quebradas.

## 1. Tratamento de Datas (`pt-BR`)
- É **estritamente proibido** converter strings no formato `"YYYY-MM-DD"` via `new Date()`. Isso causa problemas devido ao offset UTC.
- **Solução**: Usar a extração manual via `.split('T')[0]` ou utilizar obrigatoriamente a função helper `formatDateBR` para lidar com a exibição de datas na UI.

## 2. Mapeamento Resiliente de Integrantes
- Ao mapear voluntários nas escalas, a busca deve ser altamente resiliente para evitar erros de renderização ou dados ausentes.
- Sempre buscar utilizando as chaves de forma flexível: `id`, `userId`, `user_id` e realizar a comparação flexível por nome com `name.toLowerCase().trim()`.

## 3. Reset de Navegação (Clean State)
- Ao alternar o módulo principal (ex: trocar entre abas principais do app) ou fechar a visualização de detalhes de uma escala.
- É **obrigatório** invocar a limpeza de estado (ex: `setSelectedSchedule(null)`). Isso evita dados "fantasmas" de uma tela anterior vazando para a próxima sessão.

## 4. Padrões de Interface Mobile (Mobile-First)
- Todos os modais de criação e edição na interface mobile (telas com largura `< 768px`) devem se comportar como **Full-Screen Views**.
- A barra de navegação inferior (`BottomNav`) e headers principais devem ser **ocultos** enquanto o modal estiver ativo para focar a total atenção do usuário na edição e parecer uma tela nativa.
