# GEMINI.md - Praise App Context & Architecture

Este documento contém a estrutura, visão geral da arquitetura, padrões e instruções do projeto **Praise App** para auxiliar em análises, desenvolvimentos e consultas futuras.

---

## 📌 Visão Geral do Projeto

O **Praise App** é uma plataforma SaaS e multi-tenant para gestão de ministérios de louvor de igrejas, abrangendo aplicativo mobile (Android/iOS), frontend web e backend API integrados com Supabase (PostgreSQL).

### Módulos Principais
- 👥 **Grupos, Permissões (RBAC) & Convites**: Estrutura por grupo de louvor com administradores (`admin` com CRUD total) e integrantes ingressados via código curto de convite (ex: `PR-8X2K` com perfil `member` de leitura).
- 💳 **Modelo de Assinaturas (SaaS)**: A criação e manutenção de grupos é restrita a administradores com planos de assinatura ativos (`active`/`trialing`).
- 🎵 **Repertório e Músicas**: Cadastro, gerenciamento, histórico, transposição e visualização de repertórios por grupo.
- 📜 **Liturgias e Ordem do Culto**: Planejamento e organização da programação musical dos cultos de domingo e eventos da igreja.
- 🎼 **Smart Chords / Cifras Inteligentes**: Integração para cifras dinâmicas e transposição de tons.

---

## 🏗️ Estrutura do Repositório (Monorepo/Multi-app)

```
praise-app/
├── backend/          # API REST Node.js (TypeScript + Express)
├── mobile/           # App Mobile em Flutter (Dart + BLoC)
├── web/              # Aplicação Web React (TypeScript + Vite)
├── supabase/         # Migrações SQL e scripts do banco de dados
├── run-backend.bat   # Script auxiliar para rodar o backend no Windows
└── run-web.bat       # Script auxiliar para rodar o app web no Windows
```

---

## ⚙️ Detalhamento dos Componentes

### 1. 🟢 Backend (`/backend`)
- **Tech Stack**: Node.js, TypeScript, Express, Supabase Client (`@supabase/supabase-js`), CORS, dotenv, Zod.
- **Estrutura Interna (`backend/src/`)**:
  - `app.ts`: Configuração central do Express, middlewares de CORS/JSON e rotas da API.
  - `server.ts`: Ponto de entrada do servidor HTTP.
  - `middleware/`:
    - `auth.ts`: Extração de usuário e autenticação JWT.
    - `rbac.ts`: Controle de acesso por papel no grupo (`admin` vs `member`) e verificação de assinatura ativa (`requireActiveSubscription`).
    - `error-handler.ts`: Tratamento global de erros da API.
  - `features/`: Arquitetura orientada a funcionalidades:
    - `groups/`: Gestão de grupos, assinaturas, participantes e geração/resgate de convites curtos (`PR-XXXX`).
    - `liturgies/`: Gestão de ordens de culto e programação dos serviços musicais.
    - `repertoire/`: Músicas, artistas, classificações e pastas do grupo.
    - `smart_chords/`: Módulo de cifras dinâmicas.

---

### 2. 🌐 Web (`/web`)
- **Tech Stack**: React 18, TypeScript, Vite, Lucide React (Ícones), Vanilla CSS.
- **Estrutura Interna (`web/src/`)**:
  - `App.tsx`: Navegação principal, alternância de grupo ativo, alternância de tema (Sol/Lua com persistência no `localStorage`), verificação de perfil de acesso (`admin` vs `member`) e renderização condicional de ações de escrita.
  - `api.ts`: Cliente HTTP com suporte a Grupos, Convites, Liturgias, Escalas, Integrantes, Equipes, Funções, Classificações e Repertório.
  - `types.ts`: Definições TypeScript para `Group`, `GroupMember`, `GroupInvite`, `Liturgy`, `Song`, `Schedule`, `Team`, `Role`, `Classification`, etc.
  - `index.css`: Sistema de design CSS com variáveis de tema para Modo Claro (`:root`) e Modo Escuro (`.dark`), suporte a glassmorphism e alto contraste.
  - `components/`:
    - `JoinGroupModal.tsx`, `JoinMinistryModal.tsx`, `InviteCodeModal.tsx`, `CreateGroupModal.tsx`, `CreateMinistryModal.tsx`.
    - `DashboardView.tsx`: Painel inicial pós-login com Ministérios, Avisos Recentes, Próximas Escalas e Aniversariantes do Mês.
    - `SchedulesView.tsx`, `ScheduleDetailView.tsx`, `CreateScheduleModal.tsx`.
    - `MinistryView.tsx`, `TeamsView.tsx`, `RolesView.tsx`, `ClassificationsView.tsx`, `AdminsView.tsx`, `TemplatesView.tsx`.
    - `SongCard.tsx`, `SongDetail.tsx`, `FolderCard.tsx`, `FolderDetail.tsx`, `SmartChordsWorkspace.tsx`.

---

### 3. 📱 Mobile (`/mobile`)
- **Tech Stack**: Flutter (Dart), `flutter_bloc` (Gerenciamento de Estado), `equatable`, `http`, `shared_preferences`, `google_fonts`, `url_launcher`.
- **Estrutura Interna (`mobile/lib/`)**:
  - `main.dart`: Ponto de entrada do Flutter, injeção de dependências e tema (`ThemeData`).
  - `core/`: Constantes (`app_constants.dart`), tema/paleta de cores (`app_theme.dart` / `app_colors.dart`), serviços de rede e utilitários.
  - `features/`:
    - `groups/`: Repositórios e BLoCs para gestão e troca de grupos.
    - `liturgies/`: Visualização das ordens de culto.
    - `repertoire/`: Exibição de músicas e pastas com modo leitura para `member`.
    - `smart_chords/`: Cifrador inteligente.

---

### 4. 🗄️ Supabase / Banco de Dados (`/supabase`)
- **Tech Stack**: PostgreSQL (gerenciado via Supabase SQL Migrations).
- **Estrutura (`supabase/migrations/`)**:
  - `001_create_repertoire_tables.sql`: Tabelas iniciais de repertórios e músicas.
  - `002_add_song_links.sql`: Links de apoio (YouTube, Spotify).
  - `003_add_smart_chords_and_multiuser.sql`: Suporte inicial a multi-usuários.
  - `004_create_smart_chords_table.sql`: Cifras inteligentes standalone.
  - `005_groups_and_liturgies.sql`: **Multi-Tenant completo** com tabelas `groups`, `group_members`, `group_invites` (código curto), `liturgies`, `liturgy_items` e RLS.

---

## 🎨 Sistema de Design & Paleta de Cores (Sage & Forest Green)

O Praise App utiliza um sistema de cores harmonioso baseado em tons de Verde Floresta e Sálvia:

### Tokens Globais:
- **Primary Brand**: `#2B3B30` (Verde Floresta)
- **Primary Hover**: `#415748` (Light) / `#3B4F41` (Dark)
- **Accent**: `#86A38F` (Sálvia)

### Modo Claro (`:root`):
- `--bg-main`: `#F4F6F4` (Cinza claro sálvia)
- `--bg-surface`: `#FFFFFF`
- `--border-color`: `#DCE2DD`
- `--text-main`: `#0F1411` (Preto ardósia escuro para legibilidade máxima)
- `--text-muted`: `#3A4A3E` (Verde escuro de alto contraste)
- `--text-tertiary`: `#526356`
- `--primary-light`: `#233B2B`
- `--danger`: `#DC2626` (Reduzido tom lavado para alto contraste)

### Modo Escuro (`.dark` - Padrão):
- `--bg-main`: `#131614`
- `--bg-surface`: `#1C221E`
- `--border-color`: `#2B3B30`
- `--text-main`: `#ECEFE2`
- `--text-muted`: `#9DA79F`
- Tema padrão de inicialização no app, com suporte a salvamento de preferência do usuário em `localStorage` / `SharedPreferences`.

---

## 🛠️ Scripts e Comandos Frequentes

### Backend
```bash
cd backend
npm install       # Instalar dependências
npm run dev       # Executar em modo desenvolvimento (tsx watch)
npm run build     # Compilar TypeScript para produção
```

### Mobile (Flutter)
```bash
cd mobile
flutter pub get   # Baixar dependências
flutter run       # Executar no emulador/dispositivo
```

### Web (React + Vite)
```bash
cd web
npm install       # Instalar dependências
npm run dev       # Iniciar dev server (Vite)
```

---

## 💡 Convenções e Diretrizes para Desenvolvimento Futuro

1. **Controle de Acesso RBAC**:
   - Rotas de leitura (`GET`) exigem papel `member` no grupo.
   - Rotas de criação, edição e remoção (`POST`, `PUT`, `DELETE`) exigem obrigatoriamente papel `admin` e status de assinatura ativa (`requireActiveSubscription`).
2. **Convites de Grupo**:
   - Os convites devem utilizar o padrão de **código curto** (ex: `PR-8X2K`), gerados aleatoriamente com expiração recomendada de 7 dias.
3. **Manutenção do Banco de Dados**:
   - Qualquer alteração em esquemas deve ser adicionada como uma nova migration numerada sequencialmente em `supabase/migrations/`.
4. **Padrão de Temas**:
   - O aplicativo deve sempre inicializar no **Modo Escuro (Dark Mode)** por padrão.
   - Caso o usuário altere explicitamente para o Modo Claro (Light Mode), essa preferência deve ser persistida localmente.
   - Em Modo Claro, utilizar obrigatoriamente textos de alto contraste (`#0F1411` / `#3A4A3E` / `#DC2626`) em vez de tons desbotados ou texto branco sobre fundos claros.
