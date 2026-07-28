# GEMINI.md - Praise App Context & Architecture

Este documento contém a visão geral da arquitetura, estrutura de arquivos, contratos de dados, regras de negócio e sistema de design do projeto **Praise App**, servindo como documento de referência primário para análises, desenvolvimentos e consultas.

---

## 📌 Visão Geral do Projeto

O **Praise App** é uma plataforma SaaS e multi-tenant focada na gestão completa de ministérios de louvor e equipes de música de igrejas. Abrange um aplicativo mobile em Flutter (Android/iOS), uma aplicação web responsiva em React e uma API backend em Node.js (TypeScript) integrada com banco de dados (Firebase Firestore e Supabase PostgreSQL).

### Módulos Principais
- 👥 **Ministérios, Membros, Permissões (RBAC) & Convites**: Estrutura por ministério com administradores (`admin` com controle total) e integrantes ingressados via código curto de convite (ex: `PR-8X2K` com perfil `member`).
- 👔 **Gestão de Integrantes & Funções Musicais**: Edição detalhada de voluntários (Nome, E-mail, Data de Nascimento, Senha e atribuição de funções musicais como `🎤 Vocalista`, `🪕 Violão`, `🥁 Baterista`).
- 🎵 **Repertório e Músicas**: Cadastro de músicas, artistas, classificações por estilo/momento do culto, pastas organizacionais e transposição de tons.
- 📅 **Escalas, Templates e Linha do Tempo (Roteiro)**: Criação de escalas para serviços de culto, importação de equipes, importação de templates/modelos de roteiro, reordenamento via drag-and-drop, vestimentas/paletas de cores e gestão de presença (`confirmado`, `recusado`, `pendente`).
- 💬 **Chat e Comentários por Escala**: Chat em tempo real em cada escala, com contador de comentários no botão (`Comentários (N)`), controle de acesso estritamente restrito aos voluntários escalados naquela escala e aos administradores.
- 🎼 **Smart Chords / Cifras Inteligentes**: Leitor e editor de cifras dinâmicas com transposição automática de tons.
- 📊 **Painel do Integrante (Dashboard)**: Visão geral pós-login com atalhos, avisos da liderança, preview detalhado de próximas escalas (com avatares empilhados, contadores de confirmados/indisponíveis, contagem de músicas, paleta de cores e tempo restante em semanas) e aniversariantes do mês em tempo real.

---

## 🏗️ Estrutura do Repositório (Monorepo/Multi-app)

```
praise-app/
├── backend/          # API REST Node.js (TypeScript + Express + Firestore/Supabase)
├── mobile/           # App Mobile em Flutter (Dart + BLoC)
├── web/              # Aplicação Web React 18 (TypeScript + Vite + Vanilla CSS)
├── supabase/         # Migrações SQL e scripts do banco de dados PostgreSQL
├── run-backend.bat   # Script auxiliar para inicialização do backend no Windows
└── run-web.bat       # Script auxiliar para inicialização da web no Windows
```

---

## ⚙️ Detalhamento dos Componentes

### 1. 🟢 Backend (`/backend`)
- **Tech Stack**: Node.js, TypeScript, Express, Firebase Admin SDK (Firestore), Supabase Client (`@supabase/supabase-js`), CORS, dotenv, Zod.
- **Estrutura Interna (`backend/src/`)**:
  - `app.ts`: Configuração central do Express, middlewares de CORS/JSON e montagem de rotas.
  - `server.ts`: Ponto de entrada do servidor HTTP.
  - `middleware/`:
    - `auth.ts`: Autenticação via Token JWT / Firebase Auth.
    - `rbac.ts`: Middleware `requireMinistryRole('admin' | 'member')` e verificação de assinatura ativa (`requireActiveSubscription`).
    - `error-handler.ts`: Middleware global de tratamento e formatação de erros (`AppError`).
    - `validate.ts`: Validação de schemas Zod em requisições HTTP.
  - `repositories/`:
    - `MinistryRepository.ts`: Gestão de ministérios, membros (`role_ids`, dados de perfil) e convites curtos.
    - `ScheduleRepository.ts`: Gestão de escalas, participantes, presença, itens de linha do tempo e comentários da escala (`schedule_comments`).
    - `RoleRepository.ts`, `TeamRepository.ts`, `TemplateRepository.ts`, `RepertoireRepository.ts`, `SmartChordRepository.ts`.
  - `features/`:
    - `groups/`: Rotas, controllers e services para grupos/ministérios, membros e convites.
    - `schedules/`: Rotas, controllers e services para escalas e comentários da escala (`GET/POST /:scheduleId/comments`).
    - `repertoire/`: Músicas, artistas, pastas e classificações.
    - `smart_chords/`: Módulo de cifras dinâmicas e transposição.
    - `liturgies/`: Ordem do culto e roteiros musicais.

---

### 2. 🌐 Web (`/web`)
- **Tech Stack**: React 18, TypeScript, Vite, Lucide React (Ícones), Vanilla CSS (Design System próprio).
- **Estrutura Interna (`web/src/`)**:
  - `App.tsx`: Gerenciamento de rotas/módulos principais (`dashboard`, `repertoire`, `cifrador`, `schedules`, `ministry`), alternância de ministério ativo, controle do drawer/sidebar e reset de estado de navegação (`setSelectedSchedule(null)` ao trocar de aba).
  - `api.ts`: Cliente HTTP central para consumo das APIs REST (Grupos, Convites, Membros, Funções, Equipes, Escalas, Comentários da Escala, Repertório, Cifras).
  - `types.ts`: Tipagens do sistema (`Group`, `GroupMember`, `GroupInvite`, `Schedule`, `ScheduleComment`, `Song`, `Folder`, `Role`, `Classification`, etc.).
  - `index.css`: Sistema de design CSS completo com variáveis de tema Claro (`:root`) e Escuro (`.dark`), regras de glassmorphism, chips de estatística, avatares empilhados e balões de chat.
  - `components/`:
    - `DashboardView.tsx`: Painel do integrante pós-login com Ministérios, Avisos Recentes, Preview Avançado de Escalas (com stack de avatares, métricas e contagem em semanas) e Aniversariantes Calculados em Tempo Real.
    - `SchedulesView.tsx`: Listagem de escalas do ministério com filtros e atalho de criação.
    - `ScheduleDetailView.tsx`: Detalhes da escala, confirmação de presença dos voluntários, exibição de funções mapeadas por integrante, lista de músicas, linha do tempo e **Modal de Chat de Comentários da Escala** (com proteção de acesso por participante).
    - `CreateScheduleModal.tsx`: Modal para criação e edição de escala com importação de equipes, importação de modelos/templates, drag-and-drop de músicas e timeline.
    - `MinistryView.tsx`: Gestão de integrantes com edição sanfonada de dados (Nome, Email, Data de Nascimento sem deslocamento UTC, Senha e seletor de Funções), Equipes, Funções, Classificações e Convites.
    - `SongCard.tsx`, `SongDetail.tsx`, `FolderCard.tsx`, `FolderDetail.tsx`, `SmartChordsWorkspace.tsx`.

---

### 3. 📱 Mobile (`/mobile`)
- **Tech Stack**: Flutter (Dart), `flutter_bloc` (Gerenciamento de Estado), `equatable`, `http`, `shared_preferences`, `google_fonts`, `url_launcher`.
- **Estrutura Interna (`mobile/lib/`)**:
  - `main.dart`: Ponto de entrada do Flutter, injeção de dependências e tema (`ThemeData`).
  - `core/`: Constantes (`app_constants.dart`), tema/paleta de cores (`app_theme.dart` / `app_colors.dart`), serviços de rede e utilitários.
  - `features/`:
    - `groups/`: Repositórios e BLoCs para gestão e troca de ministérios.
    - `liturgies/`: Visualização das ordens de culto.
    - `repertoire/`: Exibição de músicas e pastas com modo leitura para `member`.
    - `smart_chords/`: Cifrador inteligente.

---

### 4. 🗄️ Modelo de Dados & Persistência (Firestore / Supabase)
- **Coleções / Tabelas Principais**:
  - `ministries` / `groups`: Cadastro dos ministérios de louvor.
  - `group_members` / `ministry_members`: Relacionamento de voluntários com o ministério (`role_ids`, `birth_date`, `role`).
  - `roles`: Funções musicais do ministério (ex: Vocalista, Violão, Bateria) com ícone e nome.
  - `teams`: Equipes pré-definidas para facilidade de escala.
  - `schedules`: Escalas de serviço com `participants`, `songs`, `timeline`, `colorPalette`, `clothingPieces`, `requireConfirmation`.
  - `schedule_comments`: Comentários/Chat por escala (`schedule_id`, `ministry_id`, `user_id`, `user_name`, `content`, `created_at`).
  - `smart_chords`: Conteúdo de cifras inteligentes standalone ou vinculadas a músicas.

---

## 🎨 Sistema de Design & Paleta de Cores

O Praise App utiliza um sistema visual sofisticado e moderno baseado em tons de Verde Floresta, Sálvia e Roxos Elegantes:

### Tokens Globais:
- **Primary Brand**: `#2B3B30` (Verde Floresta) / `#7C3AED` (Roxo Destaque Interativo)
- **Primary Light**: `#86A38F` (Sálvia) / `#A855F7`
- **Success**: `#10B981` (Verde confirmação)
- **Danger / Warning**: `#EF4444` (Recusado) / `#F59E0B` (Alerta/Paleta)

### Modo Escuro (`.dark` - Padrão de Inicialização):
- `--bg-main`: `#131614`
- `--bg-surface`: `#1C221E`
- `--border-color`: `#2B3B30`
- `--text-main`: `#ECEFE2`
- `--text-muted`: `#9DA79F`

### Modo Claro (`:root`):
- `--bg-main`: `#F4F6F4`
- `--bg-surface`: `#FFFFFF`
- `--border-color`: `#DCE2DD`
- `--text-main`: `#0F1411` (Preto ardósia de alto contraste)
- `--text-muted`: `#3A4A3E` (Verde escuro de alto contraste)

---

## 🛠️ Comandos de Execução e Build

### Backend
```bash
cd backend
npm install       # Instalar dependências
npm run dev       # Executar em modo desenvolvimento (tsx watch)
npm run build     # Compilar TypeScript para produção
```

### Web (React + Vite)
```bash
cd web
npm install       # Instalar dependências
npm run dev       # Iniciar servidor de desenvolvimento (Vite)
npx -p typescript tsc --noEmit # Validação do TypeScript
```

### Mobile (Flutter)
```bash
cd mobile
flutter pub get   # Baixar dependências
flutter run       # Executar no emulador/dispositivo
```

---

## 💡 Diretrizes e Convenções para IA

1. **Formatação de Datas em Português (`pt-BR`)**:
   - Para evitar o bug de regressão de 1 dia por conta do offset de fuso horário UTC (ex: `new Date("YYYY-MM-DD")`), utilize obrigatoriamente a extração direta da string via `.split('T')[0].split('-')` ou o helper `formatDateBR`.
2. **Resolução de Funções de Integrantes nas Escalas**:
   - Ao relacionar membros em listas de participantes da escala, mapeie as chaves do participante testando `id`, `userId`, `user_id` e o nome em minúsculas (`name.toLowerCase().trim()`) no mapa de funções do ministério para garantir a resolução correta da string de funções (ex: `🎤 Vocalista • 🪕 Violão`).
3. **Segurança & Controle de Acesso no Chat da Escala**:
   - Os comentários de escala (`GET/POST /:scheduleId/comments`) só podem ser acessados ou enviados por usuários que façam parte do array `schedule.participants` daquela escala ou por administradores do ministério.
4. **Navegação & Reset de Estado**:
   - Ao trocar de módulo principal no frontend (`mainModule`), o estado da escala selecionada deve ser limpo (`setSelectedSchedule(null)`) via `handleBackToMain()` para que o usuário não retorne a uma escala aberta anteriormente.
5. **Manutenção dos Padrões de Layout**:
   - Manter o padrão visual escuro como inicializador no app e garantir textos com alto contraste em Modo Claro (`#0F1411` / `#3A4A3E`).
