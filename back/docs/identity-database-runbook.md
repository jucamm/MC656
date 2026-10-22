# HU01 — Issue 2: Banco de Dados e Migrations

## Pré-requisitos

- Node.js e dependências do backend (`npm ci` em `back`). Validação realizada com Node 24.
- PostgreSQL 16 (versão usada na validação) acessível por `DATABASE_URL`.
- Banco vazio previamente criado e usuário com permissão de criar tabelas, enums,
  índices e o schema de controle do Drizzle. Não são necessárias extensões.

Execute os comandos deste documento em `back`, salvo indicação contrária.

## Preparar e aplicar em banco vazio

```bash
cp .env.example .env
```

Ajuste `DATABASE_URL` em `.env` para o banco desejado. Esse arquivo é ignorado pelo
Git. O Drizzle carrega dotenv, porém uma variável que já esteja exportada no ambiente tem precedência sobre o conteúdo do `.env`.
A URL **NÃO** deve ser registrada em logs ou commits com credenciais reais.

Exemplo opcional de PostgreSQL local descartável, usando Docker (outro terminal):

```bash
docker run --rm --name mc656-hu01-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=mc656 \
  -p 127.0.0.1:5432:5432 postgres:16
```

Esse exemplo corresponde ao `DATABASE_URL` do template e não usa volume; serve
apenas ao desenvolvimento local. Aguarde o banco indicar que está pronto.

```bash
npm run db:migrate
npm run build
npm start
```

`db:migrate` aplica os arquivos versionados em `drizzle/` e registra o histórico
em `drizzle.__drizzle_migrations`. Repetir o comando sem migrations novas não
recria tabelas nem dados. Sem `DATABASE_URL`, o comando não consegue se conectar assim não há fallback para um banco externo. O servidor ainda não abre conexão ao banco nesta issue; as rotas e serviços existentes permanecem independentes da migration.

## Schema entregue

- Fonte ORM: `src/db/schema.ts`. 
- Configuração: `drizzle.config.ts`.
- Migration inicial: `drizzle/20261022211520_hu01_identity/migration.sql` e seu
`snapshot.json`, gerados pela versão de Drizzle Kit fixada no lockfile.

| Tabela | Garantias principais |
|---|---|
| users | bigint incremental; e-mail único; telefone varchar(20) sem unicidade; status pending por padrão; verified se e somente se ambos os canais estiverem confirmados |
| authentication_sessions | UUID; FK para users; hash de token único; created_at, last_activity_at, expires_at e revoked_at; expiração posterior à atividade |
| verification_challenges | UUID; FK; um desafio por conta/canal; HMAC; tentativas de 0 a 3; expiração posterior à emissão; consumed_at e revoked_at opcionais |
| rate_limits | PK conta/canal/janela; contagem não negativa; fim posterior ao início; blocked_until permitido somente na linha diária |

Enums: `account_status` (pending/verified), `verification_channel` (email/phone)
e `rate_limit_window` (hour/day). Todos os nomes persistidos estão em inglês e
snake_case. Datas usam timestamptz. `created_at` usa `now()`; UUIDs, atividade,
expiração e emissão serão fornecidos pelos serviços nas próximas issues.

IDs do ORM usam bigint nativo, evitando perda de precisão; a futura camada HTTP
deve convertê-los para strings. Hashes/HMACs têm capacidade de 64 caracteres.
Normalização de e-mail/telefone e validação de conteúdo serão feitas na Issue 3.

O índice não único em phone atende à futura busca por número; o índice em
session.user_id atende à busca de sessões da conta. A constraint única de desafio
e a PK de limites também indexam user_id. FKs usam a ação padrão NO ACTION;
não há exclusão automática de sessões ou outros registros.

O schema permite quatro linhas de limites por conta (email/hour, email/day,
phone/hour, phone/day). Não cria linhas automaticamente e não aplica contadores,
janelas de 1h/24h ou bloqueio de 3 dias sozinho: essas operações transacionais
pertencem às próximas issues. Não há trigger, envio ou regra HTTP nesta entrega.

## Para criar migrations futuras

1. Altere `src/db/schema.ts`.
2. Gere e revise o SQL e o snapshot:

```bash
npm run db:generate -- --name=descricao_da_alteracao
```

3. Versione a nova pasta inteira em `drizzle/`, incluindo `migration.sql` e
   `snapshot.json`. Geração não exige banco nem DATABASE_URL.
4. Aplique em banco de desenvolvimento e valide a alteração:

```bash
npm run db:migrate
npm run build
npm run lint
```

Mantenha o histórico gerado pelo Drizzle; não edite uma migration já aplicada,
não use `push` para substituir o fluxo versionado e não rode o SQL manualmente
antes de `db:migrate`. Alterações corretivas devem gerar uma nova migration.
Não há comando de rollback automático configurado. Para descartar somente o
banco Docker do exemplo, execute `docker stop mc656-hu01-db`; isso remove seus
dados locais. Para bancos persistentes, planeje uma migration corretiva.

## Inspeção manual

Conecte-se ao banco configurado usando seu cliente PostgreSQL. No exemplo Docker:

```bash
docker exec -it mc656-hu01-db psql -U postgres -d mc656
```

No psql, `\d users`, `\d authentication_sessions`, `\d verification_challenges`
e `\d rate_limits` exibem colunas, checks, FKs e índices. O teste a seguir não
persiste usuários de exemplo (a sequência pode avançar mesmo com rollback):

```sql
BEGIN;
INSERT INTO users(name, email, phone, password_hash) VALUES
  ('Fixture A', 'fixture-a@example.com', '+55 (11) 98765-4321', 'fixture'),
  ('Fixture B', 'fixture-b@example.com', '+55 (11) 98765-4321', 'fixture');
-- Deve permitir duas contas com o mesmo telefone e status pending.
SELECT email, phone, status FROM users WHERE email LIKE 'fixture-%@example.com';

SAVEPOINT duplicate_email;
-- Deve falhar por unicidade:
INSERT INTO users(name, email, phone, password_hash)
VALUES ('Duplicado', 'fixture-a@example.com', '+55 (11) 98765-4321', 'fixture');
ROLLBACK TO SAVEPOINT duplicate_email;

SAVEPOINT inconsistent_status;
-- Deve falhar porque os dois canais ainda não estão confirmados:
UPDATE users SET status = 'verified' WHERE email = 'fixture-a@example.com';
ROLLBACK TO SAVEPOINT inconsistent_status;
ROLLBACK;
```