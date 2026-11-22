# HU03 · Contrato de reuniões

Este é o contrato aprovado para orientar a implementação da criação de reuniões, da audiência, dos convites, da transferência da organização e da designação de moderadores. A HU03 parte do commit `7b795c6` em `feature/hu03`, com a identidade da #21 e as migrations e os serviços de grupos da #22 presentes. A referência local de `origin/develop` aponta para `02efb3b`. [Histórico de banco](../drizzle/) · [Base de autorização da HU02](groups-contracts.md#reuso-da-hu02)

## Regras do encontro

- **Criação.** Uma conta verificada por e-mail pode criar reunião avulsa. Para vincular um grupo ativo, o criador deve ser administrador daquele grupo. O servidor identifica o criador pela sessão e o registra como primeiro organizador e participante confirmado.
- **Horário.** Assunto e horário são obrigatórios. `starts_at` recebe um instante ISO 8601 com deslocamento explícito ou `Z`. O servidor grava em `timestamptz`, retorna em UTC e exige horário estritamente futuro no momento da gravação.
- **Visibilidade.** O padrão do formulário é privado. Uma reunião pública é visível a qualquer conta verificada. Para uma reunião privada de grupo, o organizador pode permitir consulta aos integrantes vigentes ou restringi-la aos participantes confirmados. Em reunião privada avulsa, o acesso é restrito ao organizador e aos participantes confirmados.
- **Participação.** Quem for selecionado e tiver vínculo vigente com o grupo da reunião fica confirmado automaticamente. Quem estiver fora do grupo ou for convidado para reunião avulsa precisa aceitar. Um convite externo aceito concede acesso àquela reunião privada. A leitura de uma reunião pública ou visível ao grupo, por si só, deixa o estado de participação ausente. A visibilidade e a participação são tratadas separadamente.
- **Organização.** Há exatamente um organizador vigente. Ele pode indicar outro participante confirmado e elegível antes do início. O destinatário deve aceitar dentro desse prazo. Até o aceite, o organizador atual mantém a função. A mudança preserva a autoria original e troca a permissão administrativa imediatamente após o commit.
- **Moderação.** Somente o organizador vigente pode designar ou retirar moderadores antes do início, entre participantes confirmados e elegíveis da própria reunião. A execução das ações de moderação na sala pertence à HU06.
- **Revogação.** Perder o vínculo revoga o acesso derivado do grupo, inclusive para participantes e moderadores. Um convite aceito é uma autorização própria da reunião. O organizador vigente mantém sua função por designação enquanto o grupo estiver ativo. Excluir o grupo oculta suas reuniões, convites e pedidos de transferência nas rotas operacionais. A recuperação volta a aplicar os vínculos, estados e prazos vigentes.
- **Legislativo.** O seletor de PLs e a integração com o futuro catálogo ficam para uma entrega posterior. Nesta etapa o assunto é textual.

## API REST

As rotas passam por autenticação Bearer e verificação por e-mail. Extrair o ator de `request.auth.user_id`. IDs de grupo, reunião e transferência são UUIDs. IDs de usuário são strings decimais positivas no HTTP e `bigint` no banco. Usar `Cache-Control: no-store`, sucesso com `{ "data": ... }`, erros com `{ "error": { "code": "...", "message": "...", "details": {} } }` e corpo vazio em `204`.

| Método e rota | Contrato |
|---|---|
| `POST /meetings` | Recebe `subject`, `starts_at`, `access` e, opcionalmente, `group_id`, `participant_ids` para integrantes selecionados e `participant_emails` para contas identificadas por e-mail exato. Retorna `201` com a reunião e `Location: /meetings/<id>` após o commit. |
| `GET /meetings` | Retorna `200` com `{ items, next_cursor }` em `data`. Aplica visibilidade antes de paginar, com ordenação por `(starts_at, id)`. Envie `next_cursor` como `cursor` na próxima requisição. |
| `GET /meetings/:meetingId` | Retorna `200` com a reunião aplicando a mesma política da listagem. |
| `GET /meetings/:meetingId/participants` | Retorna `200` com `{ items, next_cursor }` ao organizador vigente. A ordem e o cursor usam o ID do usuário. |
| `GET /meeting-invitations` | Retorna `200` com os convites pendentes da própria conta para reuniões disponíveis. |
| `POST /meetings/:meetingId/invitation/accept` e `POST /meetings/:meetingId/invitation/decline` | A conta destinatária responde ao próprio convite. Retorna `204`. |
| `POST /meetings/:meetingId/organizer-transfers` | O organizador envia `recipient_user_id` de outro participante elegível. Retorna `201` com o pedido pendente. |
| `GET /meeting-organizer-transfers` | Retorna `200` com os pedidos pendentes recebidos pela própria conta em reuniões disponíveis e ainda futuras. |
| `POST /meetings/:meetingId/organizer-transfers/:transferId/accept` e `POST /meetings/:meetingId/organizer-transfers/:transferId/decline` | O destinatário resolve o pedido. Retorna `204`. O aceite troca o organizador. |
| `DELETE /meetings/:meetingId/organizer-transfers/:transferId` | O organizador vigente cancela o pedido pendente. Retorna `204`. |
| `PUT /meetings/:meetingId/moderators` | O organizador vigente envia o conjunto completo em `participant_ids`, antes do início. Retorna `200` com o conjunto persistido. Lista vazia retira a designação de todos. |

O campo `access` contém `visibility` com valor `public` ou `private`. No modo privado com grupo, contém também `audience` com `group` para consulta pelos integrantes ou `selected` para acesso restrito. A reunião avulsa privada usa audiência selecionada. A criação aceita até 100 entradas somadas entre `participant_ids` e `participant_emails`, além do próprio criador. `participant_ids` é reservado aos integrantes do grupo da reunião. O DTO geral expõe ID da reunião, assunto, início, visibilidade, nome do organizador vigente e ações disponíveis para o ator. E-mails e lista de participantes ficam fora dessa projeção. A caixa de convites retorna `{ items, next_cursor }` em `data`. Cada item contém `meeting_id`, `subject`, `starts_at` e `invited_by_user_name`. A paginação usa `limit` de 1 a 100 (padrão 20) e o UUID da reunião como `cursor`.

| HTTP | Uso |
|---|---|
| `400 VALIDATION_ERROR` | JSON, campos, IDs ou data inválidos. O instante de criação precisa ser futuro. |
| `401` e `403` | Sessão inválida ou, respectivamente, conta pendente ou papel insuficiente. |
| `404` | Grupo, reunião, convite ou pedido indisponível no escopo do ator. |
| `409` | `MEETING_STARTED` para transferência ou alteração de moderadores no início ou depois dele. Também cobre convite ou pedido resolvido e pedido concorrente de transferência. |
| `422` | Participante ou destinatário inelegível para a operação. |

Nas listas de reuniões e participantes, `limit` vai de 1 a 100 e tem padrão 20. A lista de participantes retorna `user_id`, `name`, `origin`, `status`, `is_eligible` e `is_moderator`. O status preserva o registro de confirmação ou convite. A elegibilidade exige conta verificada e participação confirmada com vínculo vigente quando o acesso deriva do grupo. A moderação exibida reflete a designação vigente após essa checagem. Em reunião visível para a conta, apenas o organizador consulta a lista de participantes. Outra conta que pode consultar a reunião recebe `403 MEETING_MANAGEMENT_FORBIDDEN`. Fora da audiência, a API retorna `404 MEETING_NOT_FOUND`.

## Integridade e concorrência

Persistir autoria e organizador vigente em colunas distintas de `meetings`. A participação registra origem, estado e designação de moderação na relação `meeting_participants`. Os pedidos de transferência ficam em `meeting_organizer_transfers`, com unicidade para um pedido pendente por reunião.

Nas escritas de reunião vinculada, adquirir o lock do grupo antes do lock da reunião e gravar na mesma transação PostgreSQL. Revalidar estado do grupo, papel do ator, elegibilidade do participante e horário após adquirir os locks. O aceite da transferência troca o organizador e encerra o pedido na mesma transação. Para lista e detalhe, aplicar a mesma política antes da paginação.

## Linha de base da etapa 0

Verificação local da base `7b795c6` com Node.js 24 e PostgreSQL 17. As suítes da HU01 e da HU02 compartilharam uma base vazia descartável e aplicaram as migrations existentes.

| Módulo | Build | Lint | Testes com cobertura |
|---|---|---|---|
| Backend | Passou | Passou | 529 testes em 26 arquivos, incluindo PostgreSQL real |
| Frontend | Passou | Passou com três avisos em arquivos gerados em `coverage/` | 17 testes em 5 arquivos |

Para reproduzir, execute `npm run build`, `npm run lint` e `npm run test:coverage` em `back/` e `front/`. No backend, configure `HU01_TEST_DATABASE_URL` e `HU02_TEST_DATABASE_URL` conforme o [runbook](identity-2-database-runbook.md#testar-em-postgresql-real).
