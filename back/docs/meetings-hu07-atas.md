## Atas de reuniões (HU07)

A partir de `back/`, rode `npm run db:migrate` e `npm run build`. Inicie `npm start` e, em outro processo supervisionado com a mesma `DATABASE_URL`, execute `npm run worker:minutes`. A geração por notas funciona com `MEET_TRANSCRIPTION_ENABLED=false`. Encerre uma reunião na plataforma, abra **Ata da reunião** com uma conta gestora, informe as notas e acompanhe a fila. A leitura de atas publicadas já está disponível para o público da reunião. A aprovação e a publicação pelo painel seguem o [fluxo de revisão da HU08](meetings-hu08-revisao-atas.md).

### Piloto de transcrição do Google Meet

1. Use uma conta anfitriã Workspace dedicada. Confirme suporte a transcrição em português, espaço no Drive, configurações de compartilhamento e consentimento explícito do Meet. Valide também o fluxo de entrada direta pelo link. Crie uma sala exclusiva por reunião. No Calendar, habilite a transcrição para o evento e garanta que o anfitrião/coanfitrião entre pela web. [Transcrições e consentimento](https://support.google.com/meet/answer/12849897?hl=en)
2. No Google Cloud, habilite a Google Meet API. Configure a tela OAuth conforme o tipo de app, inclua a conta piloto entre os usuários de teste quando aplicável e crie um cliente OAuth Web. Registre o URI de redirecionamento da ferramenta usada pelo operador. Para homologação, pode usar o [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) com **Use your own OAuth credentials** e o URI `https://developers.google.com/oauthplayground` registrado no cliente. Solicite acesso offline e conceda `https://www.googleapis.com/auth/meetings.space.readonly` como anfitrião dedicado. Troque o código por tokens e guarde o refresh token diretamente na configuração privada. O escopo é sensível e a duração da credencial depende da modalidade de publicação do cliente OAuth. [Escopos do Meet](https://developers.google.com/workspace/meet/api/guides/authenticate-authorize) · [OAuth para servidores](https://developers.google.com/identity/protocols/oauth2/web-server)
3. Em `back/.env`, configure `MEET_OAUTH_CLIENT_ID`, `MEET_OAUTH_CLIENT_SECRET` e `MEET_OAUTH_REFRESH_TOKEN`. Informe os IDs locais de organizadores operadores, separados por vírgula, em `MEET_TRANSCRIPTION_OPERATORS`. Defina `MEET_TRANSCRIPTION_POLICY_VERSION` e o aviso aprovado de finalidade, acesso e retenção em `MEET_TRANSCRIPTION_NOTICE`. Ative `MEET_TRANSCRIPTION_ENABLED=true` somente após verificar autorização de captura, revisão e retenção. Use as mesmas variáveis no servidor e no worker. Rotacione ou revogue credenciais pelo Google em caso de mudança de conta ou incidente. [Política de dados Workspace](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
4. Como organizador operador, cadastre o link em uma reunião remota futura e habilite **Transcrição** no painel. Confirme a exigência de aceite explícito antes de liberar a URL. Não altere o texto associado a uma versão de política já utilizada. Valide a política diretamente no Meet e a correlação de uma única chamada com o espaço cadastrado.
5. Encerre a chamada no Meet e a reunião no aplicativo. Acompanhe **Ata da reunião**, confirme a transcrição privada, o rascunho e o tempo entre fim local e disponibilidade. A ata guarda a referência privada à transcrição, lida sob demanda. A API do Meet remove as entradas da transcrição 30 dias após o fim da chamada. Defina com a equipe anfitriã o prazo de revisão e a política local de retenção. O sistema mantém o prazo de 24 horas e sinaliza vencimento mesmo quando uma retentativa posterior funciona. O backlog de produção, o processo worker e seus erros devem ser monitorados. Se OAuth, consentimento ou a edição forem incompatíveis, desative a captura e use notas. [Artefatos e retenção](https://developers.google.com/workspace/meet/api/guides/artifacts)

Para monitorar o piloto sem consultar o conteúdo das atas, execute a consulta abaixo com acesso de leitura. Investigue imediatamente as atas que tenham atingido o prazo ou que estejam há mais de 20 horas sem transcrição.

```sql
SELECT meeting_id, generation_status, attempt_count, deadline_at,
       transcript_ready_at, sla_missed_at, failure_code
FROM meeting_minutes
WHERE deadline_at IS NOT NULL
  AND (sla_missed_at IS NOT NULL OR
       (transcript_ready_at IS NULL AND deadline_at <= now() + interval '4 hours'))
ORDER BY deadline_at;
```

### Testes da HU07

Em `back/`, configure `HU07_TEST_DATABASE_URL` apontando para PostgreSQL descartável e execute `npm test -- src/modules/meeting-minutes/tests`. Para regressão, configure as URLs HU01–HU07 e execute `npm run test:coverage`. Em `front/`, execute `npm run test:coverage`. A suíte automatizada simula o transporte do Meet. A condição de menos de 24 horas com um artefato real é verificada no piloto.
