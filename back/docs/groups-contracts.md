# HU02 · API de grupos e convites

As rotas usam a sessão da HU01. Envie `Authorization: Bearer <token>` de uma conta com e-mail verificado. O servidor identifica o ator pela sessão e consulta o vínculo atual ao autorizar a ação. É possível administrar um grupo e ser integrante comum em outro.

## Formato HTTP

- Sucesso com corpo usa `{ "data": ... }`. Respostas `204` têm corpo vazio.
- Erros usam `{ "error": { "code": "...", "message": "...", "details": {} } }`. `details.fields` informa os campos inválidos quando aplicável.
- Rotas que recebem campos usam `Content-Type: application/json` e aceitam somente os campos listados. Envie exclusão, recuperação, cancelamento, aceite e recusa sem corpo.
- Respostas do módulo usam `Cache-Control: no-store`. O preflight CORS da origem configurada permite `DELETE` sem sessão. A criação de grupo devolve `Location`, disponível para a origem permitida.
- IDs de grupo e de convite são UUIDs. IDs de usuário são strings decimais positivas, sem zeros à esquerda, na faixa do `bigint` do PostgreSQL. Datas usam ISO 8601 em UTC.

Todas as listas aceitam `limit` de 1 a 100, com padrão 20, e `cursor` opcional. A resposta é `{ "data": { "items": [...], "next_cursor": null } }`. Para buscar a próxima página, envie o `next_cursor` fornecido e mantenha os filtros originais. A ordenação segue o ID da coleção. O cursor de integrantes é um ID decimal de usuário. Os demais cursores são UUIDs.

## Grupos e integrantes

| Método e rota | Acesso e entrada | Sucesso |
|---|---|---|
| `POST /groups` | Conta verificada. `{ "name": "Grupo A" }`. | `201`, grupo criado com `my_role: "ADMIN"` e `Location: /groups/<id>`. |
| `GET /groups` | Conta verificada. Filtro `state=active` por padrão ou `state=deleted`. | `200`, lista de grupos ativos da conta ou de grupos excluídos ainda recuperáveis que ela administra. |
| `GET /groups/:groupId` | Integrante de grupo ativo. | `200`, grupo e papel atual de quem consulta. |
| `PUT /groups/:groupId` | Administrador de grupo ativo. `{ "name": "Novo nome" }`. | `200`, grupo atualizado. |
| `DELETE /groups/:groupId` | Administrador vinculado. | `204`, exclusão lógica com cancelamento de convites pendentes. A repetição preserva a data original da exclusão. |
| `POST /groups/:groupId/restore` | Administrador vinculado. | `200`, grupo recuperado com o mesmo ID e vínculos. O prazo é um ano civil em UTC, inclusive no instante-limite. Um grupo já ativo é retornado no estado atual. |
| `GET /groups/:groupId/members` | Integrante de grupo ativo. | `200`, lista de integrantes. |
| `GET /groups/:groupId/members/:userId` | Integrante de grupo ativo. | `200`, integrante e papel. |
| `PUT /groups/:groupId/members/:userId/role` | Administrador de grupo ativo. `{ "role": "ADMIN" }` ou `{ "role": "MEMBER" }`. | `200`, integrante com o papel atual. |
| `DELETE /groups/:groupId/members/:userId` | Administrador para remover terceiros ou a própria pessoa para sair. | `204`. A saída da única pessoa, quando ela é administradora, também exclui o grupo e cancela convites pendentes. |

O nome deve ter entre 1 e 150 caracteres após remover espaços das extremidades. O DTO de grupo tem `id`, `name`, `my_role`, `created_at`, `updated_at`, `deleted_at` e `recoverable_until`. As duas últimas datas são nulas para um grupo ativo. O DTO de integrante tem `user_id`, `name`, `role` e `joined_at`.

Se houver outros integrantes, remover ou rebaixar o último administrador apto retorna `409 LAST_GROUP_ADMIN`. O grupo excluído por saída do integrante único fica fora da recuperação comum. O grupo excluído administrativamente só aparece para administradores vinculados e durante o prazo de recuperação.

## Convites

| Método e rota | Acesso e entrada | Sucesso |
|---|---|---|
| `POST /groups/:groupId/invitations` | Administrador de grupo ativo. `{ "email": "pessoa@example.com" }`. | `201`, convite pendente. O vínculo depende do aceite. |
| `GET /groups/:groupId/invitations` | Administrador de grupo ativo. | `200`, convites pendentes do grupo. |
| `DELETE /groups/:groupId/invitations/:invitationId` | Administrador de grupo ativo. | `204`, convite cancelado. |
| `GET /group-invitations` | Conta verificada. | `200`, convites pendentes da própria conta em grupos ativos. |
| `POST /group-invitations/:invitationId/accept` | Pessoa convidada com conta verificada. | `200`, `{ "data": { "invitation": { ... }, "group": { ... } } }`. Cria o vínculo `MEMBER`. |
| `POST /group-invitations/:invitationId/decline` | Pessoa convidada com conta verificada. | `204`, convite recusado. |

O DTO de convite tem `id`, `group_id`, `group_name`, `status`, `created_at` e `resolved_at`. A visão administrativa inclui `invited_user_id` e `invited_user_name`. A caixa da pessoa convidada e o retorno de aceite incluem `invited_by_user_name`. Os estados são `PENDING`, `ACCEPTED`, `DECLINED` e `CANCELLED`.

## Códigos de erro para o cliente

| HTTP | Códigos | Situação |
|---|---|---|
| `400` | `VALIDATION_ERROR` | JSON, rota, filtros ou campos inválidos. |
| `401` | `UNAUTHENTICATED`, `SESSION_EXPIRED`, `SESSION_REVOKED` | Sessão ausente, inválida, expirada ou revogada. |
| `403` | `ACCOUNT_NOT_VERIFIED`, `FORBIDDEN`, `CORS_NOT_ALLOWED` | Conta pendente, papel insuficiente ou origem recusada. |
| `404` | `GROUP_NOT_FOUND`, `MEMBERSHIP_NOT_FOUND`, `INVITATION_NOT_FOUND`, `USER_NOT_ELIGIBLE` | Recurso inexistente ou fora do escopo. O convite é consultável pela conta destinatária. |
| `409` | `LAST_GROUP_ADMIN`, `MEMBERSHIP_ALREADY_EXISTS`, `INVITATION_ALREADY_PENDING`, `INVITATION_RESOLVED` | A ação entra em conflito com o estado atual. Atualize o recurso antes de repetir a operação. |
| `410` | `RECOVERY_WINDOW_EXPIRED` | O prazo de recuperação terminou. Disponível ao administrador que ainda possui vínculo. |
| `413` ou `415` | `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE` | Corpo maior que o limite do parser JSON ou codificação/charset recusado pelo parser. |
| `500` | `INTERNAL_ERROR` | Falha inesperada. |

Para testar a API com PostgreSQL, use um banco descartável e execute em `back/`.

```bash
HU02_TEST_DATABASE_URL='postgresql://localhost/mc656_groups_test' npm test -- src/modules/groups/tests src/modules/decision-process/tests
```

As suítes PostgreSQL aplicam as migrations na base de teste. Veja o [runbook do banco](identity-2-database-runbook.md) para a configuração local.

## Uso por processos decisórios e reuniões

As rotas existentes em `/groups/:groupId/decision-processes` consultam os vínculos persistidos da HU02. Integrantes de grupo ativo podem ler processos e versões. Administradores podem criar ou publicar versões, e cada ID em `requiredParticipantIds` deve identificar um integrante atual do próprio grupo. A escrita do processo ocorre com o grupo bloqueado. O histórico já publicado preserva os identificadores que tinha no momento da publicação.

Os processos decisórios seguem seu contrato HTTP existente. Retornam `403 FORBIDDEN` para papel ou vínculo insuficiente em grupo ativo, `404 GROUP_NOT_FOUND` para grupo inexistente ou excluído, `404 PROCESS_NOT_FOUND` quando o processo está fora do grupo consultado e `422 VALIDATION_ERROR` para participante obrigatório inválido. O repositório de processos e versões opera em memória. Recuperar o grupo pode restabelecer o acesso a esse histórico enquanto ele estiver na instância.

A HU03 pode consultar grupo ativo e vínculo vigente com `requireActiveGroupAccess` e proteger escritas com `withActiveGroupAccess`. As regras de audiência e de administração individual de cada reunião pertencem ao módulo de reuniões.
