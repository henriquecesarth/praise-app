# Praise App

Plataforma de gestão para ministérios de louvor — Android & iOS

## Estrutura

```
praise-app/
├── mobile/          # Flutter App (Android + iOS)
├── backend/         # Node.js API (TypeScript + Express)
└── supabase/        # SQL Migrations
```

## Stack

- **Front-end:** Flutter (Dart) com flutter_bloc
- **Back-end:** Node.js (TypeScript) com Express
- **Banco de dados:** Supabase (PostgreSQL)

## Setup

### Backend

```bash
cd backend
cp .env.example .env
# Preencha as credenciais do Supabase no .env
npm install
npm run dev
```

### Mobile

```bash
cd mobile
flutter pub get
flutter run
```

### Banco de Dados

1. Crie um projeto no [Supabase](https://supabase.com)
2. Execute o arquivo `supabase/migrations/001_create_repertoire_tables.sql` no SQL Editor do Dashboard
3. Copie as credenciais para o `.env` do backend

## Módulos

- [x] Repertório e Músicas
- [ ] Escalas e Calendário
- [ ] Comunicação e Avisos
- [ ] Indisponibilidade
- [ ] Dashboard
- [ ] Metrônomo
