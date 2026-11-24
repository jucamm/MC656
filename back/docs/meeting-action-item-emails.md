# HU10 (#32) — E-mails de encaminhamentos

A HU10 grava avisos e lembretes em PostgreSQL na mesma transação da HU09. Um worker separado envia e-mails individuais. O convite é imediato e exige aceite no aplicativo. Após o aceite, os lembretes são agendados para 09h no fuso `America/Sao_Paulo`, sete dias civis antes do prazo e no dia da entrega. Se o aceite ocorrer após 09h no dia final, o lembrete do dia fica disponível imediatamente.

A primeira ativação consome eventos válidos já gravados pela HU10. Propostas gravadas apenas na HU09 ficam disponíveis no aplicativo e não recebem aviso retroativo. Um prazo alterado depois da atualização agenda lembretes para os responsáveis elegíveis com aceite. Não há rotina automática de reenvio ou preenchimento retroativo de tarefas antigas.

## Configuração

1. Use PostgreSQL com a mesma `DATABASE_URL` da API. Em `back/`, execute `npm run db:migrate` e `npm run build`.
2. Escolha uma conta Gmail ou Workspace autorizada para esse uso. Ative a verificação em duas etapas e gere uma senha de aplicativo. Se a política da organização bloquear senhas de aplicativo, consulte quem administra a conta para escolher uma conta habilitada antes de ativar o processo. [Configuração Gmail SMTP do projeto](README.md#gmail-smtp)
3. Configure o processo do worker com `MAIL_SERVER=smtp.gmail.com`, `MAIL_PORT=587`, `MAIL_USE_TLS=true`, o endereço remetente em `MAIL_USERNAME` e a senha do aplicativo em `MAIL_PASSWORD`. Em produção, injete as credenciais pelo mecanismo de segredos do ambiente. A conta pode ser dedicada ao worker com as mesmas variáveis. Se houver compartilhamento, considere a cota e a latência dos e-mails de verificação.
4. Defina `ACTION_ITEM_APP_URL` com a origem do frontend. Use HTTPS em produção, por exemplo `https://app.example.com`. HTTP é aceito em desenvolvimento somente no loopback. O e-mail usa essa origem e o UUID da reunião em fragmento. A sessão do aplicativo ainda é exigida para consultar a reunião e para aceitar a proposta.
5. Defina `ACTION_ITEM_EMAIL_ENABLED=true` e inicie `npm run worker:action-item-emails` em processo supervisionado e separado da API. Permita saída para o Gmail na porta 587. Configure reinício em falhas e monitore o status do serviço. O worker verifica SMTP e credenciais antes de reclamar jobs. O valor padrão `false` deixa a fila persistida e faz o processo sair sem enviar.

| Variável | Finalidade |
|---|---|
| `DATABASE_URL` | Ler os dados elegíveis e consumir a outbox gravada pela API. |
| `MAIL_SERVER`, `MAIL_PORT`, `MAIL_USE_TLS` | Conexão SMTP autenticada via STARTTLS. |
| `MAIL_USERNAME`, `MAIL_PASSWORD` | Conta remetente e senha de aplicativo. |
| `ACTION_ITEM_EMAIL_ENABLED` | Ativar o despacho. Tem efeito no worker. |
| `ACTION_ITEM_APP_URL` | Origem fixa usada para montar o link do aplicativo. |
| `HU10_TEST_DATABASE_URL` | Banco de teste exclusivo da HU10. A suíte usa adaptador injetado e não usa a conta Gmail. |

## Operação e recuperação

A fila usa lease e chaves únicas por proposta, tipo e versão de prazo. Recusa, saída, conclusão, cancelamento e mudança de prazo suprimem ocorrências que ainda podem ser canceladas. Perda de acesso é revalidada antes do envio. Uma mensagem cujo despacho já foi autorizado pode chegar após uma decisão concorrente.

Em falha explicitamente transitória, a retentativa preserva o instante do evento e respeita a janela. Se houver perda de resposta depois de autorizar o envio, o job fica `uncertain` e exige inspeção pelo Message-ID estável. Se não houver evidência inequívoca de recusa, preserve esse estado. Para um job comprovadamente recusado e ainda dentro da janela, autorize a retomada em manutenção, revalide a elegibilidade e use a retomada abaixo com acesso controlado. O worker também revalida o escopo antes do novo envio. Preserve `event_at` e o número de tentativas.

```sql
-- Execute em psql com -v job_id=UUID após confirmar a não aceitação.
UPDATE action_item_email_jobs
SET status = 'queued', available_at = now(), dispatch_started_at = NULL,
    failure_code = NULL
WHERE id = :'job_id'::uuid AND status = 'uncertain'
  AND attempt_count < 5 AND now() >= event_at AND now() < expires_at;
```

A cada conclusão de tentativa, os logs informam o estado, tempo desde o evento, atraso até o despacho e tempo SMTP. O worker sinaliza backlog a partir de 10 segundos. Use o status do supervisor para detectar processo parado e consulte a fila para detectar violações de 15 segundos mesmo quando houver falha no processo.

```sql
SELECT kind, status, failure_code, count(*) AS jobs,
       max(extract(epoch FROM (coalesce(sent_at, now()) - event_at))) AS maior_atraso_s
FROM action_item_email_jobs
WHERE status <> 'suppressed'
  AND coalesce(sent_at, now()) - event_at >= interval '15 seconds'
GROUP BY kind, status, failure_code;
```

## Testes e homologação

Em `back/`, crie um banco PostgreSQL descartável exclusivo e configure `HU10_TEST_DATABASE_URL`. Execute `npm test -- meetings-action-item-emails email-contract`. Para a regressão, configure as demais URLs de teste e execute `npm run build`, `npm run lint` e `npm run test:coverage` no backend e no frontend.

O prazo é de **menos de 15 segundos** entre `event_at` e a aceitação pelo servidor SMTP. Em ambiente piloto autorizado, use contas destinatárias de teste e registre latência máxima, p95, falhas e atrasos. Exercite uma conexão inicial, lote de 20 destinatários, avisos e lembretes simultâneos, dois workers e concorrência com verificação de conta. Em cenário saudável dentro da carga acordada, todos os jobs elegíveis devem ficar abaixo de 15 segundos. Verifique separadamente a chegada à caixa de entrada. Timeouts SMTP por fase e retentativas não garantem ausência de atraso durante indisponibilidade externa.
