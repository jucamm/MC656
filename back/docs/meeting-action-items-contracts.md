# HU09 (#31) — Encaminhamentos de reunião

## Permissões e estados

Encaminhamentos pertencem a reuniões de grupo ativo. Para consultar, a conta deve estar verificada, pertencer ao grupo e ter acesso à reunião. O bloqueio impede mutações e mantém a leitura já autorizada. Visitantes externos e reuniões avulsas não têm acesso ao recurso.

O administrador vigente do grupo pode criar, propor responsáveis e mudar o prazo. Organizador ou moderador efetivo integrante do grupo pode cancelar. Propostas identificam destinatário, proponente e data. Cada destinatário elegível pode aceitar ou recusar a própria proposta. Após aceitar, pode deixar a atribuição ou concluir a tarefa para todos. Recusa e saída preservam as linhas originais. Reatribuir cria outro registro e exige novo aceite.

A tarefa vai de `open` a `completed` ou `cancelled`. Uma atribuição passa de `pending` a `accepted` ou `declined`. Uma atribuição aceita pode passar a `withdrawn`. Mudança de prazo preserva os aceites existentes. `due_on` é uma data civil obrigatória no fuso `America/Sao_Paulo`. A criação aceita data de hoje em diante e origem em uma pauta ou votação encerrada daquela reunião.

## HTTP

Prefixo `/meetings/:meetingId/action-items`. Rotas exigem Bearer e retornam `{ data }` com `Cache-Control: no-store`. Os IDs de usuário são strings decimais positivas e os demais IDs são UUID. As coleções aceitam cursor exclusivo e `limit` de 1 a 100 (padrão 20).

| Operação | Método e sufixo | Entrada |
|---|---|---|
| Listar e detalhar | GET `/` e `/:id` | A lista indica se o ator pode criar e se há uma proposta pendente para ele. O detalhe retorna versão, estado, origem, prazo, atribuição do ator, contadores efetivos e ações autorizadas. |
| Listar candidatos | GET `/eligible-assignees` | Nome e ID. A seleção exige papel de administrador e filtra por elegibilidade antes da paginação. |
| Criar | POST `/` | `id, description, source, due_on, assignee_user_ids`. `source` contém `kind` (`agenda_item` ou `poll`) e `id`. |
| Histórico | GET `/:id/assignments` | Contém nome, IDs, estado, datas e flag de compromisso efetivo. Objetos não incluem contatos. |
| Propor novas atribuições | POST `/:id/assignments` | `expected_version, assignee_user_ids`. De 1 a 20 usuários distintos. |
| Aceitar ou recusar | POST `/:id/assignments/:assignmentId/respond` | `expected_version, decision` (`accept` ou `decline`). |
| Sair | POST `/:id/assignments/:assignmentId/withdraw` | `expected_version`. |
| Mudar prazo | PUT `/:id/deadline` | `expected_version, due_on`. |
| Concluir ou cancelar | POST `/:id/complete` e `/:id/cancel` | `expected_version`. |

Criação retorna **201** e demais operações bem-sucedidas retornam **200**. Um estado incompatível, UUID de criação já usado ou versão desatualizada retorna **409**. Entradas inválidas retornam **400**. Origem inaplicável ou alvo inelegível retorna **422**. Papel insuficiente retorna **403** dentro da audiência. Recurso fora do escopo retorna **404**.

## Integração com a HU10

`MeetingActionItemsService` executa as transições dentro da transação da reunião. A HU10 pode acrescentar os registros de notificação no mesmo `dbTx` após gravar propostas, aceites, mudança de data, saídas, recusas e fechamento. Use o ID da atribuição para distinguir propostas novas de tentativas repetidas e `due_revision` para distinguir mudanças de data. A consulta `ActionItemsRepository.eligible` é o ponto de revalidação do destinatário. A HU09 opera sem transporte ou processamento de notificações.

## Execução local e testes

Em `back/`, use a `DATABASE_URL` de desenvolvimento para executar `npm run db:migrate`. Depois inicie a API e o frontend pelos comandos normais. Em uma reunião de grupo, crie uma pauta e proponha uma atribuição no painel **Encaminhamentos**. Use a conta do destinatário para aceitar e concluir. A API preserva o histórico de atribuições após a conclusão.

Em banco local de testes descartável, execute o exemplo abaixo. Ajuste conexão, usuário e porta à instalação PostgreSQL.

```bash
createdb mc656_hu09_test
HU09_TEST_DATABASE_URL=postgresql:///mc656_hu09_test npm test -- meetings-action-items.postgres.test.ts
```

O CI fornece `HU09_TEST_DATABASE_URL` e executa a suíte com PostgreSQL 17. Execute `npm run build`, `npm run lint` e `npm run test:coverage` em `back/` e `front/` para regressão. A aplicação da HU09 usa as configurações já existentes.
