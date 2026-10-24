# HU01 — Issue 4: login, sessões e logout

## Implementação e execução

A branch desta entrega é `feature/hu01-sessions`. O schema e as migrations da
Issue 2 foram reutilizados sem alterações. Não há bibliotecas novas.

Em `back`, configure `.env` a partir de `.env.example`, forneça `DATABASE_URL` de
um PostgreSQL com as migrations aplicadas e execute:

```bash
npm ci
npm run db:migrate
npm run build
npm start
```

`server.ts` compõe Pool, Drizzle, repositories e SessionService quando
DATABASE_URL está definida. Isso habilita POST /auth/login, POST /auth/logout e
GET /auth/me. Sem DATABASE_URL, o servidor mantém apenas os módulos existentes,
sem montar as rotas de identidade. Não há fallback de identidade para dados mockados.
Em testes/composição alternativa use `createApp(repository, sessionService)`;
`repository` é o parâmetro já existente do módulo de processos decisórios e pode
ser undefined para usar seu default. O Pool é encerrado quando o servidor fecha.

O cadastro continua disponível como serviço da Issue 3; seu endpoint e os endpoints
de verificação ainda não estão montados. Autorização global dos outros módulos e
CORS permanecem no escopo da Issue 8. O middleware mockado desses módulos não é
usado pelas rotas /auth; ele será substituído na integração de acesso.

## Ciclo de vida

- Login normaliza e-mail pela função da Issue 3 e compara a senha sem transformá-la,
  usando PasswordService/Bcrypt assíncrono. Não aplica o mínimo de senha atual a
  contas existentes; entradas acima de 72 bytes não são aceitas como credenciais.
- Conta pending ou verified pode entrar. Usuário inexistente e senha incorreta
  retornam o mesmo INVALID_CREDENTIALS, com a mesma mensagem e details vazio.
- Cada login gera UUID de sessão e token opaco de 32 bytes criptograficamente
  aleatórios, codificado em base64url (43 caracteres). Somente o SHA-256 hexadecimal
  do token é persistido. A credencial original aparece apenas na resposta do login.
- A sessão começa com created_at e last_activity_at no instante do login e expires_at
  um mês de calendário UTC depois. Fim de mês é ajustado para o último dia válido:
  31/jan → 28/fev (29 em ano bissexto); 31/dez → 31/jan. Horário e milissegundos são
  preservados. Não se usa um intervalo fixo de 30 dias.
- `requireAuthentication` aceita exclusivamente Authorization: Bearer, resolve a
  sessão, renova atividade/expiração e carrega o estado atual da conta. Disponibiliza
  `request.auth = { user_id, session_id }` e `request.account` (DTO público).
- Renovação usa UPDATE condicional: revoked_at deve ser nulo e expires_at deve ser
  estritamente posterior ao instante da requisição. Datas são atualizadas com
  GREATEST para requisições fora de ordem não retrocederem a atividade/expiração.
  Uma revogação concorrente nunca é apagada e sessões expiradas não são reativadas.
- Logout preenche revoked_at somente na sessão autenticada, sem DELETE, sem revogar
  outros dispositivos e sem excluir a conta. Reutilizá-la produz SESSION_REVOKED.
- GET /auth/me consulta a conta atual e metadados seguros dos desafios correntes.
  Não gera desafios e não retorna senha, hash, HMAC, código ou token. Conta pending
  continua podendo consultar a própria conta e encerrar sua sessão.

## Contrato HTTP para o frontend

| Operação | Entrada | Sucesso |
|---|---|---|
| POST /auth/login | JSON { email, password }, sem sessão | 200, { data: { token, token_type: "Bearer", expires_at, user } } |
| POST /auth/logout | Bearer, sem corpo | 204, corpo vazio |
| GET /auth/me | Bearer, sem corpo | 200, { data: { user, verification_challenges } } |

Os campos seguem os DTOs da Issue 1; datas ISO UTC, IDs bigint serializados como
strings. `verification_challenges` inclui challenge_id, channel, expires_at,
failed_attempts, consumed_at e revoked_at; array vazio quando não há desafios.
O schema já permite guardar desafios expirados, consumidos ou revogados, que são
retornados como metadados para orientar o onboarding.

Todas essas respostas usam Cache-Control: no-store. Login não exige Bearer.
Erros das rotas usam `identity.errors.ts`, sem alterar os contratos dos outros
módulos. JSON inválido também usa o envelope de identidade:

```json
{"error":{"code":"INVALID_CREDENTIALS","message":"E-mail ou senha inválidos.","details":{}}}
```

| HTTP | Codes |
|---|---|
| 400 | VALIDATION_ERROR: dados ausentes, tipos inválidos, e-mail inválido ou campos extras |
| 401 | INVALID_CREDENTIALS: login rejeitado |
| 401 | UNAUTHENTICATED: Bearer ausente, malformado ou token desconhecido |
| 401 | SESSION_EXPIRED: sessão encontrada e expirada, inclusive no instante exato da expiração |
| 401 | SESSION_REVOKED: sessão encontrada e revogada |
| 500 | INTERNAL_ERROR: mensagem genérica, sem SQL, stack ou credenciais |

## Armazenamento e envio da credencial

A escolha de armazenamento pertence ao frontend. Memória de aplicação é uma opção
simples para esta etapa: ao recarregar a página, o usuário precisará entrar de novo.
Caso a equipe escolha persistência no navegador, ela deve preservar o envio
explícito no header e avaliar o risco de acesso por scripts; esta entrega não
escolhe uma biblioteca ou mecanismo de persistência.

Não enviar o token em URL/query, corpo, cookie ou X-Mock-User-Id. O backend não
emite Set-Cookie nem usa cookies como autenticação. Não há JWT, refresh token ou
endpoint de renovação: cada requisição válida aos endpoints autenticados renova
sua própria sessão. Não registrar a credencial em logs.

Exemplo de envio (a partir de uma origem que possa acessar a API):

```js
const response = await fetch('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'omit',
  body: JSON.stringify({ email, password }),
});
const { data } = await response.json(); // Tratar response.ok antes de consumir data.
const token = data.token; // Guardar na memória da aplicação neste exemplo.

const me = await fetch('/auth/me', {
  headers: { Authorization: `Bearer ${token}` },
  credentials: 'omit',
});

const logout = await fetch('/auth/logout', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  credentials: 'omit',
});
// Em 204, não tentar ler JSON. Remover a credencial local após logout.
```

O expires_at do login é a validade inicial, não um prazo absoluto: atividade
posterior pode ampliá-lo. Não encerrar a sessão local usando apenas essa data
antiga. Tratar 401 nos recursos autenticados como necessidade de novo login e
remover a credencial local. Um login novo cria outra sessão independente; logout
em uma aba que compartilha a mesma credencial invalida essa credencial nas demais
abas, mas não afeta logins com outros tokens.

## Validação

```bash
npm run build
npm run lint
npm test
```

Para incluir testes de persistência, use PostgreSQL 16 dedicado, com as instruções
de container do hand-off de cadastro, e rode em `back`:

```bash
HU01_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/hu01_test npm test
```

As suítes de integração aplicam as migrations existentes com lock entre os workers,
criam fixtures próprias e limpam seus registros no final. Nunca usam DATABASE_URL
como fallback. Sem HU01_TEST_DATABASE_URL, os testes PostgreSQL são pulados. A suíte
HTTP precisa de permissão para abrir portas locais.

Foram verificados: token opaco/hash, conta pendente, erros uniformes de credenciais,
validação HTTP e JSON, múltiplos logins, logout independente, expiração, renovação,
fim de mês e ano bissexto, atualizações concorrentes, revogação concorrente,
consulta do estado atual e metadados sem segredos, recusa de cookie/query/header
mockado e proteção contra exposição de erros internos.

Resultado desta entrega: `npm run build`, `npm run lint` e `git diff --check`
aprovados; `npm test` com PostgreSQL 16 descartável: 252 testes aprovados em
11 arquivos, incluindo todos os testes de integração (nenhum pulado).
