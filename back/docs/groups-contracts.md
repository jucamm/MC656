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

## Reuso da HU02

- **Identidade.** A aplicação obtém o ator de `request.auth.user_id` após validar a sessão Bearer. As rotas protegidas da HU02 também exigem conta verificada por e-mail. Ao integrar outro recurso privado, valide o acesso no servidor. Use o ID da conta como string decimal no HTTP e `bigint` no PostgreSQL. [Composição da aplicação](../src/app.ts) · [Controle de sessão](../src/modules/identity/session.middleware.ts)
- **Grupos, vínculos e convites.** `groups.id` é um UUID persistido. O papel `ADMIN` ou `MEMBER` pertence ao vínculo daquele grupo. O aceite do convite cria o vínculo. A remoção ou mudança de papel vale na próxima requisição, inclusive com o mesmo token. A exclusão lógica bloqueia o acesso usual. A recuperação administrativa em até um ano preserva o ID e os papéis existentes. [Schema](../src/db/schema.ts) · [Repositório](../src/modules/groups/groups.repository.ts)
- **Autorização reutilizável.** Use `requireActiveGroupAccess` para consultar grupo ativo, vínculo e papel. `withActiveGroupAccess` mantém o lock do grupo enquanto executa a operação autorizada. Para futuras escritas com FK para `groups.id`, inclua as operações do novo recurso no mesmo contexto transacional PostgreSQL. O contexto atual oferece operações do grupo. [Código de autorização](../src/modules/groups/group-access.ts)
- **Frontend.** O dashboard já oferece gestão de grupos e convites. Novos recursos com o envelope `{ data: ... }` podem usar `authApi.request`, que reaproveita o Bearer e a URL definida por `VITE_API_URL`. Use `my_role` para exibir ações de grupo na interface e valide a permissão novamente na API. [Dashboard](../../front/src/components/groups/GroupsDashboard.tsx) · [Cliente autenticado](../../front/src/services/authApi.ts)

| Histórias seguintes | Ponto de integração |
|---|---|
| **HU03 — Reuniões** | Usar `group_id` anulável como FK para `groups.id`. Reuniões de grupo são privadas por padrão. Conferir grupo ativo e vínculo na listagem, no detalhe e na entrada, além de eventual lista restrita da reunião. Reuniões avulsas usam a própria política de acesso. O administrador do grupo pode criar a reunião, e o criador é o administrador único que pode alterar suas especificações. Visibilidade pública de reunião de grupo e saída do criador ficam para decisão na HU03. |
| **HU04 a HU08 — Pautas, sala, moderação e atas** | Os recursos privados associados devem seguir a autorização da reunião. A rota atual `/api/pautas` guarda dados em memória e aplica somente o controle global de conta verificada. Ao associar pautas a reuniões, limitar as consultas pela autorização da reunião. A designação de moderadores e a aprovação da ata também pertencem ao encontro. |
| **HU09 e HU10 — Decisões e tarefas** | Relacionar a decisão à pauta e a tarefa à decisão. Usar a autorização da reunião para o acesso e as regras da própria tarefa para validar o responsável. O processo decisório existente configura e versiona regras de deliberação. O registro da decisão final e dos resultados pertence à HU09. |
| **HU11 a HU13 — Projetos de lei e opinião** | O catálogo de PLs e o voto de opinião independem de vínculo com grupo. A síntese pública usa atas públicas aprovadas. Preservar a privacidade de reuniões de grupo, rascunhos e atas privadas ao selecionar as fontes. |

### Processos decisórios existentes

Em `/groups/:groupId/decision-processes`, integrantes podem ler processos e versões. Administradores podem criar processos ou publicar versões. Cada ID em `requiredParticipantIds` deve corresponder a um integrante atual do mesmo grupo no momento da publicação. Versões já publicadas conservam seus IDs históricos.

O contrato dessas rotas retorna `403 FORBIDDEN` para vínculo ou papel insuficiente em grupo ativo, `404 GROUP_NOT_FOUND` para grupo inexistente ou excluído, `404 PROCESS_NOT_FOUND` para processo fora do grupo consultado e `422 VALIDATION_ERROR` para participante obrigatório inválido. Grupos e vínculos ficam no PostgreSQL. Processos e versões ficam em memória, com histórico disponível enquanto a instância estiver ativa. [Rotas de processos decisórios](../src/modules/decision-process/decision-process.routes.ts)

## Validação da entrega

| Cenário | Cobertura automatizada |
|---|---|
| Convite e entrada | HTTP com sessão real cobre convite pendente, aceite do destinatário, recusa e cancelamento. Testes do serviço verificam que repetir o aceite após remover o vínculo não o recria. |
| Escritas concorrentes | PostgreSQL real verifica aceite e exclusão nas duas ordens de aquisição do lock, aceite e cancelamento, saída e rebaixamento concorrentes e publicação de versão durante mudança de papel. |
| Persistência e recuperação | As suítes verificam restrições, rollback, leitura por nova conexão, recuperação no limite de um ano e exclusão por saída do integrante único. |
| Regressão de autorização | As rotas de processos decisórios testam acesso entre grupos, revogação, validação de participantes e histórico após recuperação. As suítes da HU01 exercitam a verificação por e-mail e as sessões. |
| Dashboard | Os testes de componentes exercitam os fluxos de administrador e convidado, paginação, mensagens de erro, preservação de entrada e confirmação somente após a resposta da API. |

Para reproduzir a regressão com cobertura em backend e frontend, execute `npm run build`, `npm run lint` e `npm run test:coverage` em cada diretório. Configure as duas URLs de teste de banco no backend conforme o [runbook](identity-2-database-runbook.md#testar-em-postgresql-real).

Quando o aceite manual for retomado, use duas contas verificadas no dashboard. Com a primeira, crie um grupo e convide a segunda. Com a segunda, aceite o convite e confira as ações de integrante. Com a primeira, confirme que sair exige promover a outra conta, faça a promoção e saia. Com a segunda, exclua e recupere o grupo e confira a lista de integrantes.
