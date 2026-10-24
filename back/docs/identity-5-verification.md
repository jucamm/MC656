# HU01 — Issue 5: emissão e confirmação de códigos

## Escopo e execução

Implementação correspondente à Issue 5 de `temp/HU01_Issues.md`, na branch
`feature/hu01-verification`. O placeholder da solicitação não substitui essa
definição. Não foram implementados CORS, autorização global, CSRF, limites de
envio da Issue 6 ou reciclagem de telefone da Issue 7.

Os seis contratos da Issue 1 agora possuem handlers: cadastro, login, logout,
consulta da conta, envio/reenvio e confirmação. O servidor compõe os serviços
quando DATABASE_URL está definida. Os DTOs, schema e migrations foram preservados;
nenhuma dependência externa foi adicionada.

Em `back`:

```bash
npm ci
cp .env.example .env
```

Configure DATABASE_URL e VERIFICATION_HMAC_KEY em `.env`. Para gerar a chave
localmente: `openssl rand -hex 32`. Copie o resultado para a variável, sem
versioná-lo. O serviço exige ao menos 32 bytes UTF-8; a chave não fica no banco.
Com DATABASE_URL definida, a falta de uma chave válida interrompe a inicialização
com mensagem de configuração, sem emitir desafios com chave provisória.

```bash
npm run db:migrate
npm run build
npm start
```

Mantenha a chave entre reinicializações. Trocar a chave invalida os códigos ainda
pendentes; o usuário precisará solicitar reenvio. Sem DATABASE_URL, a composição
continua sem montar identidade, como na Issue 4.

## Emissão e comunicação local

`VerificationService` implementa o contrato InitialEmailVerificationRequester
usado por RegistrationService. Assim, o cadastro agora solicita um desafio real
persistido, em vez da fixture de resposta usada na Issue 3.

- Código: seis dígitos, incluindo zeros iniciais, gerado com crypto.randomInt.
- Identificador: novo UUID gerado com crypto.randomUUID em cada envio.
- Persistência: apenas HMAC-SHA256, vinculando conta, canal, UUID e código.
- E-mail: solicitação automática após a conta ser persistida; validade 30 minutos.
- Telefone: somente sob demanda, após confirmar e-mail; validade 5 minutos.
- Destino: carregado da conta no banco, inclusive no envio inicial; não aceita
  substituição de usuário, e-mail ou telefone pelo cliente.
- Há um único desafio corrente por conta/canal. Reenvio aceito substitui o UUID,
  HMAC e validade, limpando tentativas, consumed_at e revoked_at do desafio anterior.
- Canal já confirmado retorna 409 CHANNEL_ALREADY_VERIFIED ao solicitar envio.

A interface VerificationDelivery tem uma única operação:
`sendVerification({ channel, destination, code })`. A implementação atual é um
mock local mínimo, necessário para integrar a jornada desta issue; usa a mesma
interface para ambos os canais. Não há entrega externa nem comprovação real de
posse do e-mail ou telefone. A consolidação dos adaptadores e dos limites pertence
à Issue 6; não há controle de cotas nesta entrega.

MockVerificationDelivery guarda envios aceitos em `outbox`, acessível somente à
instância injetada em testes. `fail = true` simula erro sem acrescentar envio.
Nunca publicar essa outbox, seus códigos ou HMACs em API/logs. O servidor não
expõe um endpoint de depuração ou códigos para demonstração manual: para inspecionar
as mensagens, componha os serviços em um teste com uma instância própria do mock.
O mock anterior de solicitação inicial permanece como fixture isolada dos testes
de cadastro, mas não é mais usado na composição do servidor.

Falha de envio inicial preserva a conta e retorna 201 com delivery_status failed,
challenge_id e expires_at nulos. Login continua disponível para tentar reenvio.
Falha no reenvio explícito retorna 503 VERIFICATION_DELIVERY_FAILED e mantém o
desafio anterior intacto. A substituição no banco só acontece após o mock aceitar
a mensagem. Como o mock é local e não transacional, uma falha de banco posterior
à aceitação pode deixar uma mensagem sem desafio utilizável; não há infraestrutura
de entrega distribuída nesta etapa, conforme o escopo do MVP.

## Confirmação e transação

PostgresVerificationRepository abre uma transação e bloqueia a linha da conta
com SELECT FOR UPDATE. Esse lock serializa envio, reenvio e confirmação na mesma
conta, inclusive entre canais. Os métodos de escrita de VerificationTransaction
são usados somente dentro dessa transação; não são repositories genéricos.

A confirmação valida challenge_id e code, conta autenticada e canal, rejeitando
identificadores substituídos, de outra conta/canal, expirados, consumidos ou revogados.
Compara HMAC usando crypto.timingSafeEqual. O instante de validação é obtido após
o lock; expiração é recusada inclusive no limite exato.

Código incorreto incrementa failed_attempts. Na terceira falha, revoked_at é
preenchido imediatamente e o erro é VERIFICATION_ATTEMPTS_EXCEEDED. Tentativas
posteriores retornam VERIFICATION_CODE_REVOKED; é necessário reenvio, sem bloquear
permanentemente a conta. Respostas de erro são retornadas pela transação como
resultado e convertidas em DomainError após o commit: os incrementos e a revogação
não são desfeitos pelo HTTP 400. Entrada estrutural inválida ou desafio de outro
usuário/canal não consome tentativas do desafio corrente.

Confirmação correta preenche consumed_at, confirma o canal e atualiza status na
mesma transação. Dois canais confirmados produzem verified; somente um mantém
pending. Essa atualização conjunta é necessária para respeitar o check da Issue 2.
Reciclagem/transferência da confirmação entre contas ainda pertence à Issue 7.
Duas confirmações simultâneas do mesmo desafio não podem consumi-lo duas vezes.
Uma falha antes do commit desfaz tanto o consumo quanto a alteração da conta.

## HTTP para o frontend

Todos os sucessos usam `{ "data": ... }`; erros usam
`{ "error": { "code": "...", "message": "...", "details": {} } }`.
As respostas usam Cache-Control: no-store. Os endpoints autenticados reutilizam
Authorization: Bearer, incluindo renovação de sessão da Issue 4.

| Endpoint | Entrada | Resposta |
|---|---|---|
| POST /auth/register | name, email, phone, password | 201: user e email_verification |
| POST /auth/verifications/:channel/send | Sem corpo ou objeto vazio; exige Bearer | 200: challenge_id, channel, expires_at |
| POST /auth/verifications/:channel/confirm | challenge_id e code; exige Bearer | 200: user atualizado |

`:channel` só aceita email ou phone. `challenge_id` deve ser UUID; `code` é string
com exatamente seis dígitos, sem trim ou conversão numérica. Campos extras na
confirmação são rejeitados. O destino não é recebido no corpo do envio.

Exemplo de confirmação:

```json
{"challenge_id":"11111111-1111-4111-8111-111111111111","code":"001234"}
```

A resposta do cadastro mantém o contrato anterior:

```json
{"delivery_status":"sent","challenge_id":"11111111-1111-4111-8111-111111111111","expires_at":"2026-10-23T12:30:00.000Z"}
```

Esse objeto ocupa data.email_verification; o envio falho usa delivery_status failed
com os dois outros campos nulos. O cliente não deve cadastrar novamente uma conta
que recebeu 201. GET /auth/me continua recuperando os metadados persistidos após
recarregar a página, sem código ou HMAC. Não há mudança no contrato de login/logout.

| HTTP | Code |
|---|---|
| 400 | VALIDATION_ERROR: canal, campos ou formato inválidos |
| 400 | INVALID_VERIFICATION_CODE: código incorreto, ID substituído, inexistente ou de outra conta/canal |
| 400 | VERIFICATION_CODE_EXPIRED: desafio expirado |
| 400 | VERIFICATION_CODE_CONSUMED: desafio já utilizado |
| 400 | VERIFICATION_CODE_REVOKED: desafio revogado |
| 400 | VERIFICATION_ATTEMPTS_EXCEEDED: terceira tentativa incorreta |
| 401 | Erros de autenticação/sessão da Issue 4 |
| 403 | EMAIL_VERIFICATION_REQUIRED: telefone solicitado/confirmado antes do e-mail |
| 409 | CHANNEL_ALREADY_VERIFIED: reenvio de canal já confirmado |
| 409 | EMAIL_ALREADY_REGISTERED: cadastro duplicado |
| 503 | VERIFICATION_DELIVERY_FAILED: envio explícito recusado pelo mock |
| 500 | INTERNAL_ERROR: erro interno com resposta genérica |

## Validação reproduzível

Em `back`, execute build, lint e testes:

```bash
npm run build
npm run lint
npm test
```

Para incluir testes reais de persistência/concorrência, use um PostgreSQL 16
dedicado, conforme os Runbooks anteriores, e rode:

```bash
HU01_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/hu01_test npm test
```

As suítes aplicam as migrations existentes e removem somente suas fixtures.
HU01_TEST_DATABASE_URL não usa DATABASE_URL como fallback; sem ela, os testes
PostgreSQL são pulados. A suíte HTTP precisa de permissão para abrir portas locais.

Evidências desta entrega: npm run build e npm run lint aprovados; 283 testes
aprovados em 13 arquivos, incluindo os testes de PostgreSQL real (nenhum pulado).
Foram validados jornada completa, validades dos dois canais, HMAC persistido,
reenvio e falhas, posse do desafio, três erros concorrentes com revogação persistida,
consumo concorrente único, rollback atômico, zeros iniciais, validação de entrada,
metadados seguros e continuidade da conta após falha de envio inicial.

A implementação para aqui. Limites de envio (Issue 6), reciclagem de telefone
(Issue 7), CORS e controle de acesso global (Issue 8) ainda não foram implementados.
