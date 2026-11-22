# HU04 · Pautas de reuniões

O escopo usa a sessão verificada e a audiência da HU03. Listagem exige audiência de leitura. Submissão exige participação elegível ou organização, sem bloqueio local e em reunião aberta. A autoria é derivada da sessão. O protótipo em `/api/pautas` mantém seu comportamento e seus registros independentes.

- `GET /meetings/:meetingId/agenda-items` aceita `limit` de 1 a 100 (padrão 20), cursor UUID e `review_status` opcional. Retorna `data: { items, next_cursor, actions: { can_submit, can_review } }`. Use o mesmo filtro para as páginas seguintes.
- `POST /meetings/:meetingId/agenda-items` recebe `{ subject, context }`, com 150 e 4000 caracteres, respectivamente, após trim. Retorna `201` e `{ data: AgendaItemDto }` depois do commit.
- Retornos usam `Cache-Control: no-store`. Consulte a tabela de códigos da HU03. A submissão retorna `403 PARTICIPATION_FORBIDDEN` quando falta autorização e `409 MEETING_ENDED` quando a reunião encerrou.

A pauta nasce `pending`. A HU04 devolve os campos mínimos de auditoria `review_status`, `reviewed_at` e `reviewed_by_user_id`. A HU06 muda o estado para `approved` ou `rejected` na mesma transação que registra o decisor e a data. `PostgresMeetingAgendaRepository.get(meetingId, itemId)` e `toAgendaItemDto` fornecem a projeção compartilhada a partir da transação ativa.

A integração de HTTP usa `createMeetingAgendaRouter(new MeetingAgendaService(meetingsRepository))` após o gate da reunião. No detalhe, monte `MeetingAgendaPanel` com `meetingId` e uma revisão opcional para atualizar a lista após ações da HU06. A interface conserva rascunho em falha de escrita. Quando o estado do commit for desconhecido, o usuário precisa atualizar a lista antes de reenviar. Uma escrita com sucesso confirmado limpa o formulário.

Execute a suíte PostgreSQL com `HU04_TEST_DATABASE_URL` apontando para uma base descartável e o comando `npm exec -- vitest run src/modules/meeting-agenda/tests` em `back/`. Em `front/`, rode `npm exec -- vitest run src/components/meeting-agenda`.

[Contrato HU03](meetings-contracts.md)
