# HU05 — Videoconferência com Google Meet

A plataforma associa manualmente o link criado pelo anfitrião. A instalação local usa o PostgreSQL já configurado para reuniões. Câmera, microfone, admissão, remoção e encerramento da chamada são operados no Google Meet.

## Configurar e entrar

1. Crie a sala no Google Calendar ou Meet com a conta que hospedará a reunião. Habilite gerenciamento do anfitrião e acesso restrito quando a edição permitir. Convide as contas Google corretas e desabilite pedidos de entrada onde essa opção estiver disponível. Valide o efeito com uma conta externa antes de divulgar a sala.
2. Para esta entrega, deixe gravação e transcrição automáticas desabilitadas e mantenha a reunião sem gravação. Guarde a URL canônica do Meet.
3. No detalhe da reunião, escolha **Virtual** ou **Híbrida**, cole o endereço no formato `https://meet.google.com/aaa-bbbb-ccc` e salve. Reuniões existentes aparecem como **Presencial**. Salvar como presencial remove o link cadastrado.
4. A partir do horário de início, participantes autorizados podem confirmar o uso de áudio e vídeo e liberar o link. O Meet abre em nova aba. As permissões do dispositivo são solicitadas no próprio Meet.
5. Se o Meet estiver indisponível, mantenha a aplicação aberta e tente voltar à sala ou informe o organizador. A configuração pode ser corrigida enquanto o encontro local estiver aberto.

O e-mail verificado no aplicativo não comprova que a pessoa usa a mesma conta no Google. Quando ocorrer transferência local de organização, o anfitrião deve acertar a passagem de controle no Meet separadamente. Após remoção ou fim da reunião local, o sistema recusa novas entregas de link. Quem já conhece a URL continua sujeito à política do Meet.

[Controle de acesso](https://support.google.com/a/users/answer/11989526?hl=en) · [Controles do anfitrião](https://support.google.com/meet/answer/16229038?hl=en) · [Remover pessoas e encerrar a chamada](https://support.google.com/meet/answer/9303164?hl=en) · [Limites e edições](https://support.google.com/meet/answer/7317473?hl=en)

## Contrato HTTP

Depois da autenticação Bearer e verificação de conta, o serviço consulta a audiência da HU03 e aplica participação, bloqueio e horário da reunião. Respostas usam `Cache-Control: no-store` e o envelope `{ data }` ou `{ error: { code, message, details } }`.

| Rota | Entrada e resposta |
|---|---|
| `GET /meetings/:meetingId/conferencing` | `{ mode, actions: { can_configure, can_join } }` para quem pode ler. |
| `PUT /meetings/:meetingId/conferencing` | Organizador vigente. Use `{ mode: 'in_person' }` ou `{ mode, google_meet_url }` para `virtual` e `hybrid`. Retorna a mesma projeção do GET. |
| `POST /meetings/:meetingId/conferencing/join` | `{ accepted_audio_video: true }`. Retorna `{ join_url }` no horário, antes de encerrar e com autorização de participação. |

A URL de ingresso só sai pelo POST. O serviço não consulta o provedor para testar o link nem contabiliza a abertura da aba como presença.

## Verificar antes de disponibilizar o fluxo audiovisual

- Execute o backend com uma base descartável em `HU05_TEST_DATABASE_URL` e rode `npm test -- src/modules/meeting-conferencing` em `back/`. No frontend, rode a suíte de componentes em `front/`.
- Com a conta Workspace real de teste, verifique capacidade, duração, controles do anfitrião e possibilidade de configurar admissão restrita.
- Com dois participantes autorizados, verifique o horário de ingresso, áudio e vídeo. Com uma terceira conta sem convite, tente entrar com a URL já copiada e registre a política de admissão efetivamente aplicada.
- Teste bloqueio e encerramento locais e na chamada separadamente. Confirme a tentativa de reentrada diretamente no Meet após bloqueio pelo anfitrião.
- Confirme que encontro presencial e operações locais continuam úteis quando o Meet está indisponível.
- Registre conta/edição utilizada, política e resultados sem gravar e-mails, credenciais ou URLs da sala na evidência.

A homologação externa depende de conta Workspace e configuração compatível. Os testes automatizados validam a aplicação e o PostgreSQL. A aprovação de admissão externa, controles de mídia e limites do provedor exige a execução real da lista acima.

## Agenda central opcional

Além do fallback manual, provisioning=automatic aceita modalidade virtual/híbrida sem URL. A organização informa início/fim na agenda; o worker cria evento central e solicita a sala na janela de quinze minutos. Participantes continuam usando a autenticação do aplicativo e o ingresso autorizado/consentido. Consulte [configuração central e limites](google-meet-integration.md). A recomendação antiga de desativar transcrição aplica-se ao fallback sem política aprovada; o caminho central pode habilitá-la previamente conforme licença e consentimento, sem garantia de captura externa.
