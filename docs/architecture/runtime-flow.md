# Runtime Flows

## 1. Browser Bootstrap and Session

~~~mermaid
sequenceDiagram
    participant B as Browser
    participant App as App.tsx
    participant API as web/api.ts
    participant Auth as Express /auth
    participant F as Firebase/Firestore

    B->>App: mount
    App->>B: read praise_auth_token
    alt token exists
        App->>API: getMe()
        API->>Auth: GET /api/v1/auth/me + Bearer
        Auth->>F: users/{uid}
        F-->>Auth: profile
        Auth-->>App: user
    end
    App->>API: getMyGroups() alias
    API->>Auth: GET /api/v1/ministries/my-ministries
    Auth->>F: memberships + ministries
    F-->>App: ministries
    App->>App: select first ministry and load feature data
~~~

App.tsx exibe LoginPage quando currentUser é nulo. O token fica em localStorage; logout remove apenas praise_auth_token e limpa estado local.

## 2. Signup and Login

Signup:

    POST /api/v1/auth/signup
    → validate(signupSchema)
    → AuthController
    → AuthService
    → UserRepository.createUser
    → Firebase Auth user + Firestore users profile
    → JWT próprio
    → frontend stores token

Login:

    POST /api/v1/auth/login
    → validate(loginSchema)
    → UserRepository.verifyPassword
    → Firebase Identity Toolkit REST, quando FIREBASE_WEB_API_KEY existe
    → Firestore users profile
    → JWT próprio com expiração de 7 dias

O fallback sem FIREBASE_WEB_API_KEY não verifica a senha; isso está registrado como INC-004 e não foi alterado.

## 3. Ministry-scoped Request

Fluxo típico de repertório:

    React component
    → api.getSongs(activeMinistryId, filters)
    → GET /api/v1/ministries/:ministryId/songs
    → authenticate
    → requireMinistryRole(member)
    → validate(query)
    → RepertoireController
    → RepertoireService
    → RepertoireRepository
    → Firestore songs query by ministry_id
    → { data, total, page, limit, totalPages }
    → mapper to UI Song

Escritas de repertório também aplicam admin e requireActiveSubscription. Outros módulos de escrita, como teams, roles, templates e schedules, exigem admin, mas nem todos aplicam subscription guard.

## 4. Ministry Creation

    POST /api/v1/ministries
    → authenticate + Zod
    → MinistryRepository.createMinistry
    → create ministries document
    → create owner ministry_members document
    → seed default ministry_roles
    → seed default ministry_classifications
    → return ministry with admin role

Erros de seed são registrados em console e não abortam a criação do ministério.

## 5. Repertoire Data

- Lista de músicas: consulta todas as songs do ministério, filtra/ordena/pagina em memória.
- Música criada: snapshots de artist/classification podem ser incorporados no documento.
- Pastas: folder_songs liga folders e songs.
- Detalhe de pasta: carrega relações e músicas sequencialmente.
- A camada web transforma músicas antigas em uma coleção versions e mantém campos retrocompatíveis.

## 6. Schedule Flow

Admin cria/edita uma escala pela UI:

    CreateScheduleModal
    → api.createSchedule/updateSchedule
    → schedules routes
    → Zod
    → ScheduleRepository
    → one schedules document containing participants, songs and timeline arrays

Members podem confirmar presença e criar/listar comentários. Comentários ficam em schedule_comments. O comportamento de matching da confirmação possui inconsistência documentada em INC-010.

## 7. Liturgy Flow

LiturgiesView implementa list/create/delete, mas não está ligado à navegação principal atual. A API persiste liturgies e itens separados em liturgy_items e enriquece itens com songs. Atualização está inconsistente: cria nova liturgia (INC-007).

## 8. Smart Chords and PDF

web/src/utils/smart_chord.ts transforma texto com acordes entre colchetes, transpõe semitons e gera representação visual. SmartChordsWorkspace edita e tenta persistir cifras, podendo criar uma música relacionada. Exportação PDF usa html2pdf.js carregado globalmente por CDN.

O fluxo persistente não fecha ponta a ponta porque os endpoints web/backend divergem e a lista web retorna vazia. Veja INC-005, INC-006 e GAP-003.

## 9. PWA

VitePWA gera manifest e service worker versionado. O worker precacheia somente o shell e assets estáticos revisionados, sem runtime caching de API, Firestore, tokens ou respostas autenticadas. Navegações usam rede sem armazenamento da resposta e recebem `offline.html` somente quando a rede falha. O registro expõe estados de instalação, disponibilidade offline e atualização, que só é aplicada após ação do usuário.

## 10. Error Flow

    thrown AppError
    → controller next(error)
    → errorHandler
    → statusCode + { error: { message, details } }

Erros não reconhecidos retornam HTTP 500 com mensagem genérica. Zod usado via validate vira AppError 400; Zod chamado diretamente em SmartChordController não é convertido pelo validate e tende ao fallback 500.
