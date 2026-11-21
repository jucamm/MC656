# Banco local e testes de identidade

Execute os comandos a partir de `back/`. Use um servidor PostgreSQL local e um usuário com permissão para criar o banco e seus objetos.

## Criar uma base vazia

```bash
createdb mc656_dev
cp -n .env.example .env
```

Ajuste `DATABASE_URL` em `.env` para apontar para `mc656_dev` no seu PostgreSQL local. Se o banco usar outra porta ou outro usuário, informe esses valores na URL. Uma `DATABASE_URL` exportada no terminal tem precedência sobre o arquivo. Configure também `VERIFICATION_HMAC_KEY` antes de iniciar o backend.

```bash
npm ci
npm run db:migrate
npm run build
npm start
```

A migration inicial consolidada cria as tabelas de identidade com o enum `verification_channel` restrito a `email`. Em `users`, o PostgreSQL exige que `status = 'verified'` corresponda à presença de `email_verified_at`. O Drizzle registra a aplicação em `drizzle.__drizzle_migrations`. Repetir `npm run db:migrate` sobre a base atual mantém os dados.

## Reconstruir uma base local antiga

A migration consolidada substitui o histórico usado pelas versões anteriores. Para continuar com os dados antigos à disposição, crie outro banco vazio e aponte `DATABASE_URL` para ele.

Se a base antiga for local e descartável, pare a aplicação, confirme o servidor e o nome do banco e execute a reconstrução abaixo. `dropdb` apaga todos os dados da base indicada.

```bash
dropdb mc656_dev
createdb mc656_dev
npm run db:migrate
```

## Testar em PostgreSQL real

Crie um banco dedicado. Ajuste a URL para os dados da sua instalação local.

```bash
createdb mc656_identity_test
HU01_TEST_DATABASE_URL='postgresql://localhost/mc656_identity_test' npm test -- src/modules/identity/tests
```

As suítes PostgreSQL aplicam a migration em seu próprio banco e removem as fixtures que criarem. Sem `HU01_TEST_DATABASE_URL`, essas suítes são puladas. Use uma base de testes vazia ao mudar de uma versão anterior das migrations.

Para evoluir o schema, altere `src/db/schema.ts`, execute `npm run db:generate`, revise o SQL e o snapshot e aplique a migration gerada no banco de teste.
