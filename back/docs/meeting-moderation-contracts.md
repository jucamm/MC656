# HU06 · Moderação e ciclo de vida da reunião

A moderação local usa a sessão Bearer e a conta com e-mail verificado. O organizador vigente ou um moderador efetivo do encontro pode aplicar ações administrativas. O papel de moderador depende de confirmação e elegibilidade atuais. A perda do vínculo exigido ou o bloqueio revogam o papel efetivo. O bloqueio preserva a participação histórica e mantém o acesso de leitura que a audiência da HU03 ainda permite. [Contrato da HU03](meetings-contracts.md)

O relógio do servidor determina as fases `scheduled`, `in_progress` e `ended`. O fim é terminal. As escritas adquirem o lock do grupo, quando vinculado, depois o lock da reunião e conferem novamente audiência e papéis. Endpoints são servidos com `Cache-Control: no-store`. Respostas com conteúdo usam `{ data }`, e erros usam `{ error: { code, message, details } }`.

| Método e rota | Regras |
|---|---|
| `GET /meetings/:meetingId/moderation` | Conta com acesso de leitura consulta a fase e as ações aplicáveis. Os alvos, com nome e ID, são restritos aos gestores da reunião. |
| `PUT /meetings/:meetingId/participants/:userId/block` | Gestor autorizado bloqueia um participante confirmado e elegível. Preserva o ator e o horário da primeira operação. Moderadores só bloqueiam participantes comuns. Autoalvo e organizador são recusados. |
| `POST /meetings/:meetingId/end` | Gestor encerra reunião a partir do início. Na mesma transação, fecha a votação que estiver aberta. Repetição autorizada retorna `204` e mantém os dados originais. |
| `GET /meetings/:meetingId/polls` | Conta com acesso de leitura consulta o histórico paginado por UUID. |
| `POST /meetings/:meetingId/polls` | Gestor abre uma votação em andamento com `{ question }`. Uma votação aberta por reunião. |
| `POST /meetings/:meetingId/polls/:pollId/close` | Gestor fecha a votação. Se ela já for fechada, a repetição autorizada mantém os dados originais. |
| `POST /meetings/:meetingId/agenda-items/:agendaItemId/review` | Gestor revisa uma pauta `pending` antes do fim, com `{ review_status: 'approved' \| 'rejected' }`. A decisão grava autor e horário e é terminal. O retorno usa o DTO da HU04. |

A votação registra abertura e encerramento, preservando o identificador para usos posteriores. Cédulas e apuração ficam fora desse ciclo. A pauta revisada continua visível na listagem da HU04. [Contrato da HU04](meeting-agenda-contracts.md)

## Operação com o Google Meet

Bloquear participação local impede novas operações que exigem participação e, com a HU05 integrada, novas entregas da URL pelo aplicativo. Quem já tem a URL depende dos controles de admissão do Meet. Encerrar na plataforma finaliza o registro local, e o anfitrião fecha a chamada pelo Meet. Silenciamento e remoção são realizados na própria chamada por quem tem permissão no provedor. O papel local não concede privilégios Google. [Controles de anfitrião](https://support.google.com/meet/answer/16229038) · [Silenciamento](https://support.google.com/meet/answer/7501121) · [Remover, bloquear e encerrar](https://support.google.com/meet/answer/9303164)

A homologação externa exige sala e conta Workspace com política restrita, verificação de duas contas autorizadas e um terceiro com a URL, além de remoção, tentativa de reentrada e encerramento na interface do provedor. A API da plataforma e o teste de banco são evidências somente do controle local.
