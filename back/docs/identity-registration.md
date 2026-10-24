# HU01 — Issue 3: cadastro e senhas

## Entrega

`RegistrationService.register(input: unknown)` valida e normaliza os dados,
protege a senha com Bcrypt assíncrono, persiste a conta e solicita a verificação
inicial de e-mail. Retorna `RegisterData` do contrato da Issue 1, sem envelope HTTP.
Não foram implementados controllers, rotas, sessões ou confirmação de canais.

A cadeia de validação é uma sequência explícita de três etapas: campos/contatos,
política de senha e política de domínio. Cada verificação é independente; não há
motor genérico de handlers. Erros de entrada usam `DomainError` com
`VALIDATION_ERROR` e `details.fields`, sem incluir os valores recebidos.

- Nome: trim, obrigatório, até 150 caracteres Unicode.
- E-mail: trim/lowercase, até 254 caracteres, sintaxe ASCII e domínio com ponto;
  não altera alias com `+` nem remove pontos. `normalizeEmail` é reutilizável no
  futuro login. A validação não consulta DNS nem comprova existência do endereço.
- Celular: formato estrutural brasileiro com DDD de dois dígitos e assinante
  iniciado em 9; aceita entrada compacta ou com máscara e prefixo opcional 55.
  Persiste `+55 (XX) 9XXXX-XXXX`. Não verifica operadora ou atribuição do DDD.
- Senha: não recebe trim/lowercase/truncamento. Mínimo contado em caracteres
  Unicode; máximo absoluto de 72 bytes UTF-8. Hash e comparação usam a biblioteca
  Bcrypt, incluindo geração de salt por ela.
- Campos extras são rejeitados; o cliente não pode definir status ou confirmações.

## Configuração de senha

O processo que compõe os serviços deve carregar `.env` (o entrypoint existente já
usa `dotenv/config`). `PasswordService` lê `BCRYPT_COST` (default 12, aceito 4–16)
e `PASSWORD_MIN_LENGTH` (default 8, aceito 1–72). Configurações inválidas falham na
construção. O teto de custo é uma escolha técnica local para limitar configurações
acidentais excessivamente custosas. Testes usam custo 4 para reduzir o tempo;
a composição normal usa 12 se não houver configuração explícita.

A referência normativa indicada pela equipe é
[ISO/IEC TS 27100:2020](https://www.iso.org/standard/72434.html).
Os valores de custo, mínimo e máximo não são atribuídos a essa referência.
Não há declaração de conformidade ou certificação ISO nesta entrega.

`PasswordService.compare` fica disponível para a Issue 4. Não aplica o mínimo
atual às contas existentes e recusa entradas acima de 72 bytes, evitando comparação
com truncamento silencioso. Não há consulta de credenciais/login nesta issue.

## Persistência

`PostgresUserRepository` recebe uma instância do Drizzle. A inserção define
explicitamente `pending` e ambos os timestamps de confirmação nulos. Somente
`password_hash` é persistido; a senha original não entra no repository.

Não há consulta prévia para decidir unicidade: a constraint `users_email_key`
protege inclusive requisições concorrentes. Somente sua violação é traduzida
para `EMAIL_ALREADY_REGISTERED`, com mensagem segura e details vazio. Outros
erros de banco seguem para o tratamento interno da futura integração HTTP.

`create` e `findById` usam projeção explícita sem password_hash. IDs bigint viram
strings e datas viram ISO UTC no DTO. Telefone repetido é permitido. O arquivo
legado vazio `src/db/schema.js` foi removido porque ocultava `schema.ts` na
resolução dos testes; o JavaScript compilado continua sendo gerado em `dist`.

## Política de e-mail e solicitação inicial

`EmailPolicy` isola a validação futura de domínios temporários. `MockEmailPolicy`
aceita uma coleção explícita de domínios rejeitados para fixtures. A coleção
padrão é vazia; nenhuma lista de provedores foi escolhida pela equipe ou embutida.
Não há garantia real de detecção de e-mails temporários nesta etapa.

`InitialEmailVerificationRequester` recebe somente user_id e o e-mail persistido.
É chamado uma vez após a criação bem-sucedida; duplicidade ou falha de validação
não solicita envio. O cadastro não engloba a comunicação na transação da conta.
Falha de solicitação preserva o usuário e retorna delivery_status failed com
challenge_id e expires_at nulos, permitindo login/reenvio nas próximas issues.

`MockInitialEmailVerificationRequester` registra solicitações em memória e recebe
uma fixture explícita de resposta (sent/failed) ou um Error para simular falha.
Ele não entrega mensagens nem gera/persiste código, HMAC ou desafio. IDs e datas
de respostas sent são fixtures, sem validade para confirmação real. O emissor de
desafios da Issue 5 deverá implementar essa interface e aplicar a validade de
30 minutos do e-mail; adaptadores de comunicação e limites serão feitos na Issue 6.
Essa separação permite validar o cadastro nesta issue sem antecipar esses serviços.
Nenhuma resposta de cadastro inclui códigos, hashes ou detalhes de falha do mock.

Exemplo de composição para desenvolvimento/testes (não registra rota):

```ts
import 'dotenv/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PostgresUserRepository } from '../src/modules/identity/user.repository';
import { RegistrationService } from '../src/modules/identity/registration.service';
import { MockInitialEmailVerificationRequester } from '../src/modules/identity/notifications/initial-email-verification';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const repository = new PostgresUserRepository(drizzle({ client: pool }));
const requester = new MockInitialEmailVerificationRequester({
  delivery_status: 'failed', challenge_id: null, expires_at: null,
});
const registration = new RegistrationService(repository, requester);
// await registration.register({ name, email, phone, password });
// Feche o pool ao encerrar o processo: await pool.end().
```

## Validação reproduzível

Em `back`:

```bash
npm ci
npm run build
npm run lint
npm test
```

Sem `HU01_TEST_DATABASE_URL`, somente os três testes de PostgreSQL são pulados.
A suíte geral usa Supertest e precisa de permissão para abrir portas locais.
Para validar persistência e concorrência, use um banco exclusivo de teste:

```bash
docker run --detach --rm --name mc656-hu01-registration-test \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hu01_test \
  -p 127.0.0.1:55432:5432 postgres:16
```

Após o PostgreSQL ficar pronto, execute:

```bash
HU01_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/hu01_test npm test
```

A suíte aplica as migrations existentes, utiliza e-mails únicos e remove somente
os usuários criados por ela. Nunca usa DATABASE_URL como fallback. Para encerrar
esse banco descartável: `docker stop mc656-hu01-registration-test`.
