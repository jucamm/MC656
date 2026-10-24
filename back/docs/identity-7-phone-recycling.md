# HU01 — Issue 7: estado da conta e reciclagem de telefone

## Entrega

Branch: `feature/hu01-phone-recycling`, criada da base `feature/hu01` atualizada.
A branch `feature/hu01-verification` já foi utilizada e integrada na Issue 5;
esta entrega usa uma branch própria, conforme a solicitação de novo PR por issue.

A confirmação telefônica agora transfere atomicamente a confirmação do número:

1. Valida sessão, confirmação de e-mail, desafio, código e validade pelas regras existentes.
2. Remove phone_verified_at das outras contas com o mesmo telefone confirmado,
   retornando seu status para pending e preservando email_verified_at.
3. Consome o desafio e confirma o telefone da conta atual, atualizando seu status.

A regra da Issue 5 foi preservada: uma conta é verified se e somente se os dois
canais estão confirmados, conforme o check da Issue 2. Cadastro ou confirmação de
somente e-mail não libera recursos protegidos nem transfere confirmação telefônica.
Telefone continua sem unicidade; diferentes contas podem cadastrar o mesmo número.
Também são corrigidas múltiplas confirmações anteriores do mesmo número, caso
existam dados legados da implementação anterior.

Não há mudança de schema, migration, dependência, DTO, configuração, política de
senhas, código/HMAC, validade de desafios ou limite de envios.

## Transação e concorrência

`PostgresVerificationRepository.withConfirmationLock` mantém o lock por conta
para e-mail. Para telefone, segue esta ordem dentro da mesma transação:

1. Lê o telefone persistido da conta (contatos são imutáveis neste MVP).
2. Obtém `pg_advisory_xact_lock(hashtextextended(phone, 0))`, serializando
   confirmações do mesmo número entre instâncias do backend.
3. Bloqueia as contas com esse telefone usando SELECT FOR UPDATE e ORDER BY id.
4. Executa as validações e a confirmação/transferência.

O lock por número é adquirido antes de qualquer lock de conta dessa operação.
Bloquear primeiro a conta atual permitiria deadlock entre duas contas disputando o
mesmo número. A ordem por ID mantém consistente a aquisição dos locks de linhas.
Colisões de hash podem causar serialização adicional, sem permitir duas
confirmações vigentes. Locks transacionais são liberados no commit ou rollback.

`consumeAndVerify` limpa as confirmações anteriores, consome o desafio e atualiza a
conta atual na mesma transação. Uma falha antes do commit reverte todas as etapas.
Código inválido, expirado, consumido ou revogado não transfere confirmação alguma.
Os incrementos e a revogação por três erros continuam persistindo como nas issues
anteriores, inclusive quando a resposta HTTP é um erro.

Se duas contas confirmarem validamente o mesmo número ao mesmo tempo, ambas as
operações podem retornar sucesso em sequência. A última confirmação efetivamente
executada mantém a posse vigente; a anterior passa a pending. Ao término das
operações existe somente uma confirmação vigente para esse número. Não se adiciona
unicidade global ao telefone nem se escolhe o vencedor pelo início da requisição.

## Sessões e acesso protegido

Sessões anteriores não são apagadas ou revogadas pela reciclagem. O middleware
requireAuthentication já consulta a conta atual no banco em toda requisição válida,
sem guardar seu status no token ou na sessão. O novo requireVerifiedAccount usa
esse estado atual e deve ser aplicado depois da autenticação.

Com os serviços reais de identidade configurados, as rotas existentes `/groups`
recebem esse gate antes dos handlers do módulo de processos decisórios:

- Sem Bearer válido: 401 pelos contratos de sessão existentes.
- Conta autenticada pending: 403 ACCOUNT_NOT_VERIFIED no envelope de identidade.
- Conta verified: segue para as verificações de associação/papel do módulo existente.

Depois do commit da transferência, a próxima requisição protegida da conta anterior
recebe 403, mesmo reutilizando seu token válido e enviando o header mockado de papel.
Requisições que já passaram pela autorização antes do commit não são canceladas.

O onboarding `/auth` continua disponível à conta pending: me, envio/confirmação e
logout mantêm seus contratos. Um desafio telefônico já consumido não permite
recuperar a confirmação: a conta anterior pode solicitar um novo e recuperar o
número somente com uma nova confirmação válida, sujeita aos limites existentes.

A associação e os papéis em grupos continuam nos mocks do módulo já existente;
o teste de acesso usa essas fixtures junto de um Bearer real. Esta issue não cria
um modelo de associação nem converte esse header em identidade. A composição
sem serviços de identidade continua sendo usada pelos testes isolados dos módulos.
A integração global de acesso e CORS permanece na Issue 8; ela não foi iniciada.

## Execução e validação

As instruções e variáveis de ambiente das Issues 2 a 6 permanecem válidas. Em `back`:

```bash
npm ci
npm run db:migrate
npm run build
npm run lint
npm test
```

Para incluir toda a suíte com PostgreSQL 16 real, use um banco exclusivo de testes
conforme os Runbooks anteriores e execute:

```bash
HU01_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/hu01_test npm test
```

A suíte aplica as migrations e limpa somente suas fixtures. A variável de testes
não usa DATABASE_URL como fallback; sem ela, os testes PostgreSQL são pulados.
Testes HTTP precisam de permissão para abrir portas locais.

As fixtures da suíte de verificação agora usam números próprios para evitar
transferências entre cenários paralelos que não compartilham intencionalmente o
mesmo telefone. A suíte de reciclagem compartilha números somente nos cenários
que verificam transferência ou disputa.

Evidências: build e lint aprovados; 304 testes aprovados em 16 arquivos, incluindo
PostgreSQL real, sem testes pulados. Os oito novos testes cobrem:

- Acesso a um processo decisório real antes/depois da transferência, com perda
  imediata de permissão na conta anterior e liberação da nova conta.
- Conta pending e confirmação parcial sem liberação ou transferência indevida.
- Limpeza de múltiplas confirmações legadas, preservando e-mails.
- Disputa concorrente pelo mesmo telefone com um único proprietário final.
- Confirmações de números diferentes sem invalidarem uma à outra.
- Código incorreto, revogado ou expirado preservando o proprietário anterior.
- Rollback que preserva proprietário, desafio e conta nova.
- Recuperação do número pela conta anterior mediante nova confirmação válida.

A entrega para nesta Issue 7, aguardando revisão.
