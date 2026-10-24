# HU01 — Issue 6: mocks e limites de envio

## Entrega e execução

A branch `feature/hu01-verification-delivery` complementa o emissor da Issue 5
com adaptadores locais por canal e limites persistidos. Não altera schema,
migrations, dependências ou payloads de sucesso das rotas existentes.
A configuração continua usando DATABASE_URL e VERIFICATION_HMAC_KEY.

Em `back`, após configurar `.env` conforme `.env.example`:

```bash
npm ci
npm run db:migrate
npm run build
npm run lint
npm test
npm start
```

## Adaptadores mockados

A interface comum continua sendo
`sendVerification({ channel, destination, code }): Promise<void>`.
MockChannelVerificationDelivery é instanciado para email e phone, com outbox e
falha controlável independentes. O erro normalizado VerificationDeliveryError
possui code VERIFICATION_DELIVERY_FAILED; o serviço converte falhas de entrega
para a resposta HTTP 503 segura já adotada.

MockVerificationDelivery compõe os dois adaptadores. Mantém os campos fail e
outbox agregados da Issue 5, preservando os testes e a composição do servidor:

```ts
const delivery = new MockVerificationDelivery();
delivery.email.fail = true; // Simula falha apenas de e-mail.
delivery.phone.fail = false;
// delivery.fail = true simula falha de ambos.
// Envios aceitos podem ser inspecionados em delivery.email.outbox,
// delivery.phone.outbox ou delivery.outbox no teste.
```

Não há chamadas externas, entrega real ou comprovação efetiva de posse dos canais.
As outboxes armazenam cópias de mensagens aceitas e são fixtures internas em
memória. Nunca publicar ou logar seus códigos; não há endpoint de depuração.
Envios recusados pelo adaptador não entram nas outboxes.

Integração de provedores reais e escolha dos dados/política de filtro de e-mails
permanecem sob responsabilidade do implementador da validação. A política mockada
da Issue 3 continua isolada, sem uma lista de provedores aprovada embutida.
Nenhum SDK, fila ou infraestrutura de entrega distribuída foi adicionado.

## Regras dos limites

O escopo é exclusivamente conta + canal. Dispositivos, sessões, IP e X-Forwarded-For
não criam cotas adicionais. E-mail e telefone têm registros separados, mesmo
quando duas contas possuem o mesmo número.

| Controle | Comportamento |
|---|---|
| Hora | Permite três envios aceitos; a tentativa seguinte retorna 429 VERIFICATION_RATE_LIMITED até expirar a janela |
| Dia | Permite seis envios aceitos; a tentativa seguinte grava bloqueio de 72 horas e retorna 429 VERIFICATION_DELIVERY_BLOCKED |
| Bloqueio ativo | Recusa envio até blocked_until, sem estender o prazo a cada nova tentativa |
| Falha do mock | Retorna 503 no reenvio, sem consumir cota, substituir desafio ou reiniciar janelas |
| Envio inicial do cadastro | Sucesso conta normalmente; falha preserva o contrato 201 com delivery_status failed |

Default técnico: janelas fixas com duração de uma hora e 24 horas, iniciadas no
primeiro envio aceito daquele par conta/canal. Não são viradas de hora/dia civil.
No limite exato do prazo, a janela está expirada; um envio aceito inicia a nova
janela com contagem 1. Reiniciar a janela horária não reinicia a diária.

Bloqueio diário é verificado antes de considerar a expiração das janelas, portanto
não se perde ao vencer a janela diária ou reiniciar o processo. Se os dois tetos
já tiverem sido atingidos, o excesso diário tem prioridade e inicia o bloqueio.
Quando blocked_until é alcançado, um envio aceito renova as janelas expiradas e
limpa o bloqueio anterior. Uma falha do mock não modifica nem mesmo janelas ou
bloqueios já expirados; eles serão renovados no próximo sucesso.

A contagem só é persistida após aceitação pelo mock, na mesma transação da
substituição do desafio. Conta, desafio e contadores são serializados pelo lock
SELECT FOR UPDATE já existente na conta; isso funciona entre instâncias e sessões.
Os contadores são separados por canal, embora esse lock simples serialize as
operações da mesma conta. Não foram introduzidos locks em memória ou por IP.

Ao exceder o diário, a transação grava blocked_until e retorna um resultado de
recusa. O service lança o erro depois do commit, garantindo que o HTTP 429 não
desfaça o bloqueio. O envio recusado não chama o adaptador, não aumenta contadores
e não substitui o desafio corrente.

Erros de confirmação e limites de envio permanecem independentes: solicitar um
novo desafio zera seus erros de confirmação, mas incrementa as cotas de envio.
Um bloqueio de envio não impede confirmar um desafio anterior ainda válido.
A exigência de e-mail confirmado antes de verificar telefone permanece inalterada.

## Contrato HTTP de nova tentativa

As rotas continuam retornando o envelope de identidade. Em 429 são enviados
Retry-After (segundos inteiros, arredondados para cima) e details com a data ISO UTC.
Exemplo de limite horário:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 3600
Content-Type: application/json
```

```json
{"error":{"code":"VERIFICATION_RATE_LIMITED","message":"Limite de envios atingido. Tente novamente mais tarde.","details":{"retry_after_seconds":3600,"retry_at":"2026-10-23T13:00:00.000Z"}}}
```

Bloqueio diário usa VERIFICATION_DELIVERY_BLOCKED, com os mesmos campos de nova
tentativa. Retry-After diminui em tentativas posteriores, sem prolongar o bloqueio.
Datas e limites são determinados pelo servidor; o frontend deve respeitar a recusa
e oferecer nova tentativa quando permitido. CORS e exposição de headers entre
origens continuam sob o escopo da Issue 8.

## Validação

Para incluir toda a suíte PostgreSQL, use um banco dedicado de testes, conforme
os Runbooks anteriores, e execute em `back`:

```bash
HU01_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/hu01_test npm test
```

Sem HU01_TEST_DATABASE_URL, os testes de banco são pulados. A variável não usa
DATABASE_URL como fallback. A suíte HTTP precisa de acesso a portas locais.
Os testes aplicam migrations e removem suas próprias fixtures, incluindo rate_limits.

Evidências desta entrega: build e lint aprovados; 296 testes aprovados em 15
arquivos, incluindo PostgreSQL 16 real, sem testes pulados. Foram validados os
terceiro/sexto envios permitidos, excesso horário/diário, limites exatos das janelas,
bloqueio persistido após 429 e entre instâncias, expiração do bloqueio, falhas que
não consomem cota, isolamento por conta/canal, Retry-After e rajadas concorrentes.

A Issue 7 (reciclagem de telefone) e a Issue 8 (controle de acesso global e CORS)
permanecem pendentes. A entrega para nesta Issue 6.
