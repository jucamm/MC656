# Google Calendar, Meet e transcrições privadas

Implementação local com testes simulados. Conta, licença Workspace, autorização administrativa e entrega real de convites/transcrição ainda exigem homologação institucional. Participantes autenticam no aplicativo; apenas operadores configurados autorizam a conta organizadora central.

## Configuração

Presencial e fallback de link manual funcionam com GOOGLE_INTEGRATION_ENABLED=false. Para automático, configure as variáveis Google descritas em .env.example: conta/sub fixados, calendário possuído, operadores locais, domínios exatos permitidos, OAuth client/secret/redirect HTTPS, arquivo privado de token e chave AES256 base64 separada. Ative Calendar API e Meet API no projeto. Escopos: openid/email, calendar.events.owned, meetings.space.settings e meetings.space.readonly. Não se pede acesso Drive nem OAuth de cada convidado.

Monte createGoogleCallbackRouter(oauth) antes do gate Bearer e somente o callback nesse ponto; createGoogleAuthorizationRouter(oauth) permanece autenticado. Operador inicia POST /integrations/google/authorization e abre authorization_url. State/PKCE expiram em cinco minutos e têm uso único; callback verifica sub/e-mail verificado via userinfo, escopos e grava refresh cifrado. Reiniciar a API invalida autorizações em andamento, que devem ser reiniciadas. Não registrar query do callback, códigos, tokens ou URLs de autorização em proxy/logs. Revogação exige nova autorização. O token estático antigo continua apenas no fallback manual; migre pela autorização central antes de removê-lo do ambiente.

API/worker compartilham arquivo cifrado e lock de refresh; access token fica na memória. Volume privado deve ser persistente, com diretório 0700/arquivo 0600 e chave fora do volume de dados. Se processo morrer segurando .lock, pare API/workers e remova somente o lock órfão após confirmar ausência de proprietário; retome e reautorize se necessário. Não executar duas instâncias API com callback state sem afinidade de sessão.

## Agenda e processamento

Informe início e fim previsto explicitamente no painel. GET/PUT /meetings/:id/schedule e POST /meetings/:id/cancel usam version; conflitos retornam 409. Cancelamento preserva histórico e bloqueia ingresso. Reagendamento só antes do início. A intenção é persistida junto à alteração local. Evento é criado cedo com ID determinístico, convidados elegíveis e sendUpdates=all; o link é solicitado a partir de início menos quinze minutos. Jobs usam lease/SKIP LOCKED/versionamento, ETag, requestId estável, I/O fora do lock e comparação antes da publicação. Não há garantia de e-mail exatamente uma vez nem de recebimento do convite. Algumas contas não recebem convite por domínio inelegível; a interface informa esse caso.

Execute node dist/meeting-integration-worker.js supervisionado no mesmo banco da API. Reinícios descobrem jobs vencidos; polling pode atrasar em indisponibilidades. Calendar tem doze tentativas por ciclo com backoff, conferência pending também limitada; POST /meetings/:id/conferencing/retry exige organização e permite recuperar após corrigir configuração. Alteração externa conflitante exige revisão operacional. Cancelar/remover conferência do aplicativo não revoga URL já conhecida nem encerra chamada remota. Depois do encerramento local, preserva-se o evento histórico.

Capture deve ser habilitada antes do início, por operador/organizador, com versão de aviso e consentimento vigente. Conta central OAuth não representa presença humana elegível. Configuração ON de transcrição é solicitada e reconsultada; licença, políticas, idioma, armazenamento e anfitrião/coanfitrião web podem impedir a captura. Não há bot anfitrião ou garantia de início automático sem pessoa elegível.

## Fonte e DOCX

Importador separado da IA consulta conferência exclusiva na janela do agendamento; exige endTime remoto e FILE_GENERATED de todos os artefatos. Encerrar no aplicativo não inventa fim remoto. Ambiguidade falha fechada. Limites: 30 páginas, 5 transcrições, 3000 entradas, 500000 caracteres; até 96 consultas em 24h e cinco falhas transitórias consecutivas. Descoberta expira no fim previsto mais 24h. Retentativa explícita POST /meetings/:id/transcript/retry exige gestão de ata encerrada.

Snapshot imutável tem versão, hash SHA256 canônico, política, conferência, artefatos e segmentos normalizados com IDs locais. DOCX gerado pela biblioteca docx representa entradas API e pode divergir do Google Docs editado. Não atribui locutor sem evidência. Arquivo temporário é sincronizado e publicado atomicamente sem substituir arquivo lógico existente; checksum/tamanho são verificados antes de available e leitura. Falha após publicação antes do commit pode deixar órfão; preserve-o para replay. Limpeza/retencão de produção deve conferir referências no banco e preservar fontes de revisões ativas.

MEETING_TRANSCRIPT_STORAGE_DIR deve ser absoluto, privado e persistente, fora da árvore pública; banco/volume/backups precisam criptografia em repouso e retenção aprovada institucionalmente. O aplicativo restringe permissões de arquivo; criptografia de volume/banco e política de eliminação são requisitos de implantação.

GET /meetings/:id/transcript e /download?version=N revalidam organização/moderação após encerramento, escopo/grupo ativo e política. Download Bearer, no-store, attachment DOCX; fonte nunca é publicada junto à ata. A disponibilidade independe de Gemini. Reader interno C0 valida versão/política/espaço, existência e checksum. Configure-o no serviço/worker de atas conforme composição. Homologação real deve incluir anfitrião elegível, dois convidados institucionais/externo, horários/reagendamento/cancelamento/revogação, simultaneidade, consentimento, fim remoto/importação/download e política Workspace para uso posterior em IA.

Referências oficiais consultadas: [OAuth web server](https://developers.google.com/identity/protocols/oauth2/web-server), [Calendar events.patch](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch), [Meet spaces.patch](https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces/patch). Testes não comprovam edição/licença nem entrega externa.
