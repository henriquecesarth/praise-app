# Políticas de Segurança e Acesso

Políticas críticas de segurança, autenticação e Role-Based Access Control (RBAC).

## Autenticação
- Toda a autenticação é baseada em Tokens JWT / Firebase Auth.
- Os tokens de autorização devem ser enviados e validados nos headers HTTP (`Authorization: Bearer <token>`) de cada requisição.

## RBAC (Role-Based Access Control)
Os ministérios/grupos possuem controle de acesso rígido baseado em dois papéis principais:
- **`admin`**: Possui acesso irrestrito e gestão total sobre o grupo (criar/editar escalas, gerenciar membros, gerar convites, etc).
- **`member`**: Possui acesso limitado, restrito apenas à leitura e consulta (visualizar escalas, visualizar cifras, checar avisos, etc). Modificações de estado não são permitidas.

## Segurança do Chat da Escala
- **Regra de Privacidade**: As rotas de comentários de uma escala (`/schedules/:scheduleId/comments`) **só podem ser acessadas** pelas seguintes identidades:
  1. Administradores (`admin`) do ministério respectivo.
  2. Integrantes/voluntários que estejam explicitamente listados na propriedade `participants` daquela escala específica.
- O backend **deve** bloquear o acesso a integrantes que não participam da escala, mesmo que sejam `member` do ministério.
