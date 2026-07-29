# Arquitetura do Praise App

Visão geral da infraestrutura e stack de tecnologias utilizadas no Praise App.

## Visão do Monorepo
O repositório é dividido em três aplicações principais:
- **`/backend`**: Node.js com Express e banco de dados via Supabase (PostgreSQL) / Firestore.
- **`/web`**: Aplicação Frontend construída com React 18, Vite e configurada como PWA (Progressive Web App).
- **`/mobile`**: Aplicativo móvel nativo desenvolvido em Flutter utilizando o padrão BLoC para gerenciamento de estado.

## Estratégia PWA & Deploy
- **Configuração do PWA**: O frontend web utiliza o `vite-plugin-pwa` para gerar e registrar o Service Worker.
- **Estratégia de Cache**: Está implementada uma estratégia `NetworkFirst` para garantir que o acesso offline a cifras e escalas funcione corretamente e de forma resiliente, permitindo o uso em locais sem internet.
- **Variáveis de Ambiente**: A variável `VITE_API_URL` na Vercel deve estar sempre configurada utilizando o protocolo seguro (`https://`).
- **CORS**: O Express no backend está configurado para aceitar requisições originadas do domínio da Vercel.
