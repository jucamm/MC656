# Configuração e validação local das integrações

Para o primeiro teste com sua conta DAC da Unicamp, use uma **reunião de ensaio com conteúdo fictício**, link manual do Meet e banco local separado. Valide a importação e o DOCX com a IA desligada. Depois habilite o Gemini e, se quiser testar o agendamento pelo aplicativo, configure a autorização central do Google.

## 1. Prepare o ambiente local

Use Node.js 22.12 ou uma versão LTS mais recente, npm e PostgreSQL local. Se precisar de um banco com Docker, o repositório fornece `./create_bd.sh` na raiz. Aponte o ambiente para um banco de ensaio antes de executar migrations.

Na worktree que contém as integrações, crie `back/.env` a partir de `back/.env.example` se o arquivo ainda não existir. Edite-o em privado, com acesso restrito ao seu usuário. O `back/.env` da HU12 já tem campos preenchidos para banco, servidor, política de senha, HMAC, SMTP e algumas flags. As credenciais de Meet e Gemini, os operadores, a política de captura e o armazenamento das transcrições não estavam preenchidos nessa worktree. Preencha-os na worktree atual. Variável preenchida não comprova que o valor ainda é válido. O servidor atual usa `MAIL_*` para envio, sem depender das antigas variáveis `RESEND_*`.

| Variável | Onde | Obrigatoriedade e origem do valor |
| --- | --- | --- |
| `DATABASE_URL` | `back/.env` | Obrigatória para migrations, API e workers ativos. Use a conexão do PostgreSQL de ensaio. |
| `VERIFICATION_HMAC_KEY` | `back/.env` | Obrigatória para a API. Use um segredo local de pelo menos 32 bytes, gerado e guardado em privado. |
| `PORT` | `back/.env` | Opcional, padrão `3000`. Escolha uma porta livre para a API HTTPS. |
| `TRUSTED_ORIGIN` | `back/.env` | Opcional se o Vite usar `http://localhost:5173`. Para outra origem, informe exatamente esquema, host e porta do frontend. |
| `SSL_CERT`, `SSL_KEY` | `back/.env` | Opcionais para substituir `certs/cert.pem` e `certs/key.pem`, relativos a `back/`. Use um par de desenvolvimento válido para o host da API e aceito pelo navegador. |
| `BCRYPT_COST`, `PASSWORD_MIN_LENGTH` | `back/.env` | Opcionais. Mantenha a política existente ou os padrões `12` e `8`. |
| `VITE_API_URL` | `front/.env.local` | Opcional com API em `https://localhost:3000`. Informe a URL HTTPS efetiva se ela mudar. |
| `VITE_PASSWORD_MIN_LENGTH` | `front/.env.local` | Opcional, padrão `8`. Se mudar `PASSWORD_MIN_LENGTH`, use o mesmo mínimo nos dois ambientes. |

O backend carrega `back/.env` quando os processos são iniciados de `back/`. Use a mesma `DATABASE_URL` na API e nos workers. Guarde chaves, senhas, tokens e códigos de autorização fora do Git, de `VITE_*`, dos logs e de capturas de tela. Evite imprimir o arquivo ou usar comandos de diagnóstico que exponham cabeçalhos e respostas OAuth.

**SMTP já configurado.** Preserve `MAIL_SERVER`, `MAIL_PORT`, `MAIL_USE_TLS`, `MAIL_USERNAME` e `MAIL_PASSWORD` no ambiente da API. Após subir o sistema, cadastre a conta local do operador e confirme a chegada do código por e-mail. Se falhar, confira primeiro se a API anunciou envio simulado e se carregou o `back/.env` correto. Consulte a caixa de spam antes de pedir outro código.

## 2. Confirme os pré-requisitos com a conta DAC

1. **Faça um ensaio no Google Agenda.** Crie um evento com a conta DAC organizadora e gere um link exclusivo do Meet. Se a opção estiver disponível, configure a transcrição automática nas opções da videochamada. Entre pela web como organizador ou coorganizador. Confira o idioma português e a ciência e o consentimento dos participantes. Após encerrar a conferência, abra o documento como organizador e confira o acesso e o compartilhamento na pasta **Google Meet** do Drive. Se apenas a transcrição manual estiver disponível e for permitida, inicie-a em **Ferramentas da reunião → Transcrição**. [Transcrições no Meet](https://support.google.com/meet/answer/12849897?hl=pt-br)
2. **Confirme as regras da Unicamp.** Ter um endereço DAC dá acesso ao serviço institucional conforme as condições da Universidade, mas a edição e a política efetivas da conta determinam a disponibilidade de transcrição. Acione a DETIC pelo serviço Google Workspace se faltarem a opção de transcrição, permissões OAuth, acesso ao artefato ou clareza sobre licença e políticas. Confirme previamente finalidade, consentimento, acesso, retenção e descarte do DOCX e do texto no banco. Para reuniões institucionais, confirme com a DETIC a autorização de armazenamento local e envio à Gemini API. Use só dados fictícios neste ensaio e mantenha `MEET_TRANSCRIPTION_ENABLED=false` até validar as condições de captura, acesso e retenção. [Serviço e atendimento Workspace](https://www.detic.unicamp.br/servicos/google-workspace/) · [Orientações DETIC](https://www.detic.unicamp.br/2026/07/02/detic-define-regras-para-uso-seguro-de-transcricao-automatica-de-reunioes-na-unicamp/) · [IN 01/2026 e guia operacional](https://www.detic.unicamp.br/normas/instrucoes-normativas/)
3. **Confira o OAuth do Playground.** No mesmo projeto Google Cloud, habilite a Google Meet API. Use o cliente OAuth do tipo **Web** com o URI autorizado exato `https://developers.google.com/oauthplayground`. Se o app estiver em `External → Testing`, inclua a conta DAC como usuária de teste. No Playground, selecione credenciais próprias, acesso **Offline** e o escopo `https://www.googleapis.com/auth/meetings.space.readonly`. Autorize com a conta organizadora e troque o código por tokens. Guarde o **refresh token** diretamente na configuração privada. [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) · [Escopos do Meet](https://developers.google.com/workspace/meet/api/guides/authenticate-authorize)

Reaproveite o refresh token se ele renovar um access token com o mesmo Client ID/Secret, para a mesma organizadora e com o escopo de leitura necessário. Em `External → Testing`, esse grant com escopo do Meet normalmente expira em **sete dias**. Gere um novo refresh token se tiver expirado, sido revogado ou se mudar cliente, conta ou escopos. Para `invalid_grant`, verifique primeiro cliente e validade do token. Para `admin_policy_enforced`, abra um chamado na DETIC com o nome do app, o código do erro e os escopos solicitados. O administrador precisa avaliar a liberação. [Expiração e restrições OAuth](https://developers.google.com/identity/protocols/oauth2#expiration)

### Confirme a leitura da transcrição antes de iniciar o worker

No ensaio já encerrado, use **Refresh access token** no Playground para confirmar a renovação. Em **Step 3**, faça os GETs abaixo com a opção de credencial no cabeçalho `Authorization: Bearer`. Use a base `https://meet.googleapis.com/v2` e substitua os identificadores ilustrativos pelos do ensaio. Mantenha o resultado no navegador local, sem exportar a sessão do Playground.

| Ordem | Caminho GET | Resultado esperado e primeiro ponto a verificar |
| --- | --- | --- |
| Preparação | `/spaces/aaa-bbbb-ccc` | Anote `name` no formato `spaces/ID`. Se falhar, confira o código do link, a conta e o escopo. |
| 1. `conferenceRecords` | `/conferenceRecords` | Use o parâmetro `filter` com `space.name = "spaces/ID"` e a janela do ensaio. Confira o registro da chamada, seu `name`, os horários e o `endTime`. Se faltar, confirme a sala e o encerramento real no Meet. |
| 2. `transcripts` | `/conferenceRecords/ID/transcripts` | Confira `name` de cada artefato e aguarde `state: FILE_GENERATED`. Se a lista estiver vazia, confira se a transcrição chegou a iniciar e se o documento saiu no Drive. |
| 3. `entries` | `/conferenceRecords/ID/transcripts/ID_TRANSCRICAO/entries` | Confira `transcriptEntries` com texto fictício em português, `startTime` e `endTime`. Siga `nextPageToken` com `pageToken` quando houver. Se faltar texto, confira a transcrição escolhida e seu prazo de disponibilidade. |

Para reproduzir a janela do importador no filtro, informe `start_time >= "INICIO_PREVISTO_MENOS_15_MIN_EM_UTC"` e `start_time < "FIM_PREVISTO_EM_UTC"` com datas ISO 8601 do ensaio. O importador espera uma única conferência correspondente. As entradas do Meet expiram 30 dias após o fim da conferência. A leitura bem-sucedida confirma o token para o modo manual. [Listar conferências](https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords/list) · [Estados de transcrição](https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords.transcripts) · [Entradas](https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords.transcripts.entries/list) · [Artefatos e retenção](https://developers.google.com/workspace/meet/api/guides/artifacts)

## 3. Configure a captura manual no aplicativo

Obtenha o **ID local do operador** depois do cadastro e da confirmação de e-mail no Unidebates. Com a conta autenticada, abra **Rede** nas ferramentas do navegador e consulte apenas `data.user.id` da resposta a `GET /auth/me`, por exemplo `42`. Esse é o ID decimal do banco local. Para vários operadores, use IDs separados por vírgula, por exemplo `42,57`. O operador da captura também deve ser o organizador daquela reunião.

| Variável em `back/.env` | Obrigatoriedade e origem do valor |
| --- | --- |
| `MEET_TRANSCRIPTION_ENABLED` | Opcional, padrão desligado. Use `true` para importar e consumir a transcrição após validar os pré-requisitos. |
| `MEET_OAUTH_CLIENT_ID` | Obrigatória na captura ou no modo central. Copie o ID do cliente Web no Google Cloud. |
| `MEET_OAUTH_CLIENT_SECRET` | Obrigatória na captura ou no modo central. Use o segredo do mesmo cliente Web. |
| `MEET_OAUTH_REFRESH_TOKEN` | Obrigatória para captura manual com `GOOGLE_INTEGRATION_ENABLED=false`. Use o refresh token validado no Playground. No modo central, deixe vazia e autorize pelo callback do aplicativo. |
| `MEET_TRANSCRIPTION_OPERATORS` | Obrigatória quando a captura está ativa. IDs decimais locais dos operadores autorizados a configurar a captura. |
| `MEET_TRANSCRIPTION_POLICY_VERSION` | Obrigatória quando a captura está ativa. Identificador do aviso aprovado, com até 80 caracteres, por exemplo `piloto-v1`. Use a mesma versão nos processos e atribua outra versão se mudar o aviso. |
| `MEET_TRANSCRIPTION_NOTICE` | Obrigatória quando a captura está ativa. Texto aprovado com finalidade, quem terá acesso, retenção e se haverá geração por IA. |
| `MEETING_TRANSCRIPT_STORAGE_DIR` | Necessária para importar, baixar e usar o snapshot na IA. Escolha um caminho absoluto, privado e gravável fora do repositório, por exemplo `/home/usuario/.local/share/unidebates-piloto/transcricoes`. |

API e `worker:meeting-integration` usam a configuração de captura e armazenamento. O `worker:minutes` precisa da mesma flag `MEET_TRANSCRIPTION_ENABLED`, versão da política e pasta para ler a fonte local, além do banco e do Gemini. O worker de atas lê o snapshot local sem usar o token OAuth. Preserve a política de acesso e retenção também no banco e nos backups. [Runbook Meet](google-meet-integration.md) · [Política de dados Workspace](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)

## 4. Autorização opcional do Calendar e Meet automáticos

No projeto do cliente Web, habilite também a **Google Calendar API**. Registre o callback HTTPS do aplicativo como outro URI autorizado, por exemplo `https://localhost:3000/integrations/google/callback`. O código solicita `openid`, `email`, `https://www.googleapis.com/auth/calendar.events.owned`, `https://www.googleapis.com/auth/meetings.space.settings` e `https://www.googleapis.com/auth/meetings.space.readonly`. O fluxo central grava seu próprio refresh token cifrado. O token de leitura do Playground pode continuar reservado ao ensaio manual. [OAuth para aplicação Web](https://developers.google.com/identity/protocols/oauth2/web-server) · [Escopos do Calendar](https://developers.google.com/workspace/calendar/api/auth) · [Escopos do Meet](https://developers.google.com/workspace/meet/api/guides/authenticate-authorize)

| Variável em `back/.env` | Obrigatoriedade e origem do valor |
| --- | --- |
| `GOOGLE_INTEGRATION_ENABLED` | Opcional, padrão desligado. Mantenha `false` no primeiro ensaio manual. Use `true` para ativar a configuração central. |
| `GOOGLE_ORGANIZER_EMAIL` | Obrigatória no modo central. E-mail Google da conta DAC que será dona do evento, por exemplo `piloto@dac.unicamp.br`. |
| `GOOGLE_ORGANIZER_SUB` | Obrigatória no modo central. No Playground, faça uma autorização de identidade com `openid email` para a mesma conta e consulte `GET https://openidconnect.googleapis.com/v1/userinfo`. Confirme `email_verified` e guarde o campo `sub` em privado. É o identificador Google, separado do ID local. |
| `GOOGLE_CALENDAR_ID` | Obrigatória no modo central. Use `primary` para a agenda principal da conta autorizada ou copie o **ID da agenda** nas configurações de uma agenda de propriedade dela. |
| `GOOGLE_ALLOWED_INSTITUTIONAL_DOMAINS` | Obrigatória no modo central. Lista de domínios exatos elegíveis para convite, separados por vírgula, por exemplo `dac.unicamp.br`. A lista não confirma que as contas pertencem à mesma organização Workspace. |
| `GOOGLE_INTEGRATION_OPERATORS` | Obrigatória no modo central. IDs locais verificados, como `42`, de quem pode iniciar a autorização da conta central. |
| `GOOGLE_OAUTH_REDIRECT_URI` | Obrigatória no modo central. URL HTTPS do callback do backend, idêntica à cadastrada no cliente Web, com caminho, host e porta corretos. |
| `GOOGLE_TOKEN_STORE_PATH` | Obrigatória no modo central. Caminho absoluto do arquivo privado que a API vai criar para o refresh token cifrado. Use uma pasta restrita fora do repositório, compartilhada pela API e pelo worker. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Obrigatória no modo central. Gere 32 bytes aleatórios em Base64 com `openssl rand -base64 32`, redirecionando a saída para um arquivo privado com acesso restrito ou usando o gerenciador de segredos. Use o valor na API e no worker. Guarde a chave separada do arquivo cifrado. |

Depois de iniciar a API com `GOOGLE_INTEGRATION_ENABLED=true`, autentique-se no frontend local como operador verificado. A autorização é iniciada por `POST /integrations/google/authorization` com a sessão do Unidebates. Para iniciar pelo navegador, execute este trecho no console **do seu frontend local**, ajustando a URL à da sua API. Ele usa a sessão já aberta e segue para a tela de consentimento sem imprimir o token ou a resposta.

```js
void (async () => {
  const session = localStorage.getItem('auth_token');
  if (!session) return alert('Entre no Unidebates como operador.');
  const response = await fetch('https://localhost:3000/integrations/google/authorization', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + session },
  });
  if (!response.ok) return alert('Falha na autorização local. HTTP ' + response.status);
  const { data } = await response.json();
  window.location.assign(data.authorization_url);
})().catch(() => alert('Confira a API HTTPS e a origem do frontend.'));
```

Selecione a conta DAC e conclua o consentimento em até cinco minutos. A mensagem esperada é **Conta central autorizada**. Em caso de falha, confira primeiro sessão e ID do operador (403), URI exato (`redirect_uri_mismatch`) ou conta, `sub` e escopos (`GOOGLE_ACCOUNT_MISMATCH`). Se a API reiniciar durante o consentimento, inicie a autorização novamente. API e worker de integração devem compartilhar o arquivo cifrado e a mesma chave. [Identidade Google e campo sub](https://developers.google.com/identity/openid-connect/openid-connect)

## 5. Configure o Gemini

No **Google AI Studio**, abra **API keys**, escolha um projeto permitido para o piloto e crie uma chave. Confirme acesso à Gemini API, cotas e condições de faturamento e uso de dados. No catálogo de modelos, escolha um ID disponível nesse projeto com suporte a texto, `generateContent`, `countTokens` e saída estruturada com JSON Schema. Em `GEMINI_MODEL`, use somente o ID selecionado, sem o prefixo `models/`. O código consulta os limites do modelo e usa o menor limite entre o modelo e o ambiente. [Criar chave](https://aistudio.google.com/apikey) · [Catálogo de modelos](https://ai.google.dev/gemini-api/docs/models) · [Saída estruturada](https://ai.google.dev/gemini-api/docs/structured-output) · [Termos Gemini](https://ai.google.dev/gemini-api/terms)

| Variável em `back/.env` | Obrigatoriedade e origem do valor |
| --- | --- |
| `AI_ENABLED` | Opcional, padrão desligado. Use `true` quando estiver pronto para enviar o conteúdo fictício ao Gemini. |
| `GEMINI_API_KEY` | Obrigatória com IA ativa. Use a chave privada do projeto no AI Studio. |
| `GEMINI_MODEL` | Obrigatória com IA ativa. Use o ID compatível verificado no catálogo e no projeto. A mudança de modelo troca a versão do pipeline. |
| `AI_REQUEST_TIMEOUT_MS` | Opcional. Prazo por tentativa, padrão `25000`, máximo `60000`. Use inteiro positivo em milissegundos. |
| `AI_MAX_INPUT_TOKENS` | Opcional. Limite de entrada por chamada, padrão `16000`, máximo `1000000`. Ajuste conforme a capacidade do modelo e o orçamento do piloto. |
| `AI_MAX_OUTPUT_TOKENS` | Opcional. Limite de saída por chamada, padrão `4000`, máximo `32000`. Ajuste conforme a capacidade do modelo e o orçamento do piloto. |
| `LEGISLATIVE_SYNTHESIS_ENABLED` | Opcional, padrão desligado. Use `true` apenas para validar sínteses de compêndios, junto com `AI_ENABLED=true` e o worker próprio. |

Use o mesmo ambiente de IA na API e nos workers Gemini para que exibam o mesmo estado e usem a mesma versão do pipeline. Para este teste, correio de encaminhamentos e sincronização legislativa podem ficar desligados. `MEET_TEST_DATABASE_URL`, `HU07_TEST_DATABASE_URL` e `HU12_TEST_DATABASE_URL` são DSNs opcionais para as respectivas suítes automatizadas com bancos descartáveis. A API e os workers do ensaio usam `DATABASE_URL`. [Runbook Gemini](gemini-integration.md)

## 6. Suba os serviços e faça o teste de ponta a ponta

Em um terminal, a partir da raiz, instale as dependências, aplique as migrations no banco de ensaio e suba a API. Você pode subir a API inicialmente com as flags desligadas para verificar o SMTP e obter o ID do operador. Depois de editar o ambiente, reinicie os processos afetados.

```bash
cd back
npm ci
npm run db:migrate
npm run build
npm start
```

Em outro terminal, a partir da raiz, suba o frontend. Abra a URL HTTPS da API no navegador e confirme que o certificado de desenvolvimento é aceito antes de autenticar no frontend.

```bash
cd front
npm ci
npm run dev -- --port 5173 --strictPort
```

Em terminais separados, já em `back/`, execute **um worker por terminal** depois de compilar. A primeira linha inicia a importação e, se configurado, o Calendar. A segunda gera atas quando o Gemini estiver habilitado. A terceira é opcional para compêndios, que exigem uma ata pública aprovada vinculada ao PL.

```bash
npm run worker:meeting-integration
npm run worker:minutes
npm run worker:legislative-synthesis
```

Para reiniciar, pare com **Ctrl+C** e rode o mesmo comando no diretório indicado. Alterações só no `.env` exigem reinício. Se mudar o código do backend, rode `npm run build` antes de reiniciar a API e os workers.

| Etapa | Resultado esperado | Primeiro ponto a verificar se falhar |
| --- | --- | --- |
| 1. Cadastre e verifique o operador. Ligue a captura após os pré-requisitos, mantendo `AI_ENABLED=false` inicialmente. Crie uma reunião **futura**, virtual ou híbrida. Em **Videoconferência**, salve início e **fim previsto** e escolha **Link manual** com uma **nova sala exclusiva** do Google Agenda. Clique em **Habilitar transcrição** antes do início. | A agenda e a modalidade são salvas, e o aviso aparece no ingresso. | ID em `MEET_TRANSCRIPTION_OPERATORS`, conta local organizadora, horário futuro e validade do refresh token. Mesmo no modo manual, o importador depende do fim previsto. |
| 2. No horário marcado, aceite o aviso no app e abra o Meet. Entre pela web como anfitrião e confira que a transcrição em português iniciou. Use frases fictícias. Encerre a chamada real no Meet e depois encerre a reunião no Unidebates. | O Google registra `endTime` e prepara a transcrição. | Confirme que a captura foi iniciada no Meet, que a chamada realmente terminou e que começou na janela agendada. |
| 3. Na reunião encerrada, use **Atualizar transcrição** e **Baixar transcrição DOCX** como gestor. | O estado passa de espera/importação para disponível e o DOCX abre, mesmo sem Gemini. | Confira `worker:meeting-integration`, o mesmo banco e a pasta privada. Se estiver aguardando, refaça a sequência da API Google e confira `FILE_GENERATED`. |
| 4. Configure `AI_ENABLED=true`, chave e modelo. Reinicie a API e inicie ou reinicie `worker:minutes`. Atualize **Ata da reunião**. Se houver uma falha anterior recuperável, use **Tentar gerar novamente** após corrigi-la. | A fila gera um rascunho em português com resumo e conteúdo derivado da fonte versionada. A revisão e a publicação são ações humanas. | Se aparecer **Configuração da IA pendente**, confira flag, chave e modelo no processo. Se houver falha de geração, confira o código de erro, acesso ao modelo, cotas e se o worker de atas lê o mesmo snapshot e a mesma política da API. |
| 5. Para validar o modo opcional, crie outra reunião com **Conta central automática**, início a mais de 15 minutos, agenda salva e captura habilitada antes do início. | O evento aparece na agenda da conta central. O worker solicita o link a partir de 15 minutos antes. Convites e admissão dependem dos endereços elegíveis e das políticas Google. | Confira o callback bem-sucedido, o worker de integração, os escopos do grant, a janela da agenda e as políticas de transcrição do Meet. |

No primeiro ensaio, valide que um usuário sem permissão de gestão da ata não consegue baixar a transcrição. Confira o rascunho com o roteiro fictício antes de aprovar qualquer versão.
