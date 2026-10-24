# HU01 — Issue 8: controle de acesso e integração do frontend

## Entrega e inicialização

Branch: `feature/hu01-access-control`, criada após atualizar `feature/hu01` com o
merge da Issue 7. Esta entrega altera somente configuração, middlewares, montagem
de rotas, fixtures de integração e documentação. Controllers, services, schema,
migrations e dependências permanecem sem alterações.

Em `back`:

```bash
npm ci
cp .env.example .env
# Configure DATABASE_URL, VERIFICATION_HMAC_KEY e TRUSTED_ORIGIN em .env.
npm run db:migrate
npm run build
npm start
```

DATABASE_URL agora é obrigatória no servidor: não há inicialização alternativa
com autenticação mockada caso a configuração esteja ausente. A chave HMAC segue
obrigatória conforme a Issue 5. Mesmo createApp sem serviços injetados recusa
recursos protegidos com 401; o helper não abre uma plataforma pública.

TRUSTED_ORIGIN define uma única origem HTTP(S). O default técnico explícito de
desenvolvimento é `http://localhost:5173`, também presente em `.env.example`.
Não aceita wildcard, credenciais na URL, caminhos, query ou fragmento. A origem
é normalizada pelo parser de URL; porta, protocolo e hostname precisam corresponder
à origem enviada pelo navegador. Configure o valor para o frontend usado no ambiente.

## Matriz final de acesso

| Recursos | Visitante | pending com sessão válida | verified com sessão válida |
|---|---|---|---|
| POST /auth/register | Permitido | Permitido | Permitido |
| POST /auth/login | Permitido | Permitido | Permitido |
| GET /auth/me | 401 | Permitido | Permitido |
| POST /auth/logout | 401 | Permitido | Permitido |
| POST /auth/verifications/:channel/send | 401 | Permitido pelas regras do canal/cotas | Permitido pelas regras do canal/cotas |
| POST /auth/verifications/:channel/confirm | 401 | Permitido pelas regras do canal/desafio | Permitido pelas regras do canal/desafio |
| /api/pautas, incluindo GET | 401 | 403 ACCOUNT_NOT_VERIFIED | Permitido pelas regras do módulo |
| /groups/... | 401 | 403 ACCOUNT_NOT_VERIFIED | Exige também associação/papel no grupo |
| Outros recursos registrados após o gate global | 401 | 403 ACCOUNT_NOT_VERIFIED | Seguem para o router correspondente |
| Preflight CORS válido | 204 sem Bearer | 204 sem Bearer | 204 sem Bearer |

O gate global fica depois das rotas de onboarding e antes dos routers de negócio.
GET de pautas, anteriormente disponível no router sem controle de identidade,
agora é montado em `/api/pautas` atrás da autenticação e da verificação da conta.
Novos routers de negócio devem continuar sendo montados abaixo desse gate.
Uma URL sem handler continua inexistente; autenticar-se não cria uma nova rota.

requireAuthentication aceita somente Authorization: Bearer, verifica a sessão,
renova sua atividade e carrega a conta atual do banco em cada requisição, conforme
a Issue 4. requireVerifiedAccount usa essa conta atual. Cookies, query strings,
body e X-Mock-User-Id não autenticam a plataforma. Sem autenticação válida retorna
401; sem verificação dos dois canais retorna 403.

Após reciclagem de telefone, o token anterior continua válido para onboarding,
mas perde acesso a pautas e grupos na próxima requisição protegida. Não há cache
de status no token nem necessidade de revogar todas as sessões. As regras de
negócio das Issues 1–7 permanecem preservadas.

## Integração com o módulo de grupos

X-Mock-User-Id foi retirado da montagem da aplicação real. O router de processos
decisórios recebe seu middleware de identidade explicitamente. bindGroupIdentity
busca o ID obtido do Bearer em vínculos fornecidos pelo servidor; não lê papel ou
identidade dos headers/corpo do cliente. O controller recebe o ID real autenticado,
e o service existente recebe a mesma coleção de vínculos na composição.

Associação/papel em grupos não fazem parte do schema HU01. Enquanto o módulo de
grupos usa fixtures, forneça vínculos explícitos por ID persistido na composição:

```ts
const groupUsers = [
  { id: '123', name: 'Ana', memberships: [{ groupId: 'group-1', role: 'ADMIN' as const }] },
];
const application = createApp(repository, sessions, onboarding, {
  trustedOrigin: 'http://localhost:5173',
  groupUsers,
});
```

Essa coleção é controlada pelo servidor e representa as associações já existentes
do módulo de grupos. Sem um vínculo configurado, o usuário verified recebe 403
nas rotas de grupo, inclusive tentando forjar X-Mock-User-Id. Ele continua podendo
acessar recursos gerais como pautas. O servidor padrão não atribui grupos ou papel
de administrador automaticamente a contas recém-criadas. A persistência e gestão
dessas associações continuam sendo responsabilidade da história de grupos.

Os testes isolados de processos decisórios continuam usando fixtures explícitas
no app de teste do módulo. Eles não configuram uma exceção de autenticação global
nem um modo público no servidor real. O E2E de reciclagem foi atualizado para
vínculos controlados pelo servidor associados aos IDs reais das contas do teste.

## CORS e headers

O middleware de origem roda antes da autenticação, inclusive para erros das rotas.
Origens diferentes da configuração e Origin null recebem 403 CORS_NOT_ALLOWED,
sem Access-Control-Allow-Origin. Não há reflexão arbitrária de origem ou wildcard.
Chamadas sem Origin (por exemplo, clientes de linha de comando) seguem para a
mesma autenticação por Bearer; CORS não substitui autorização.

Preflight válido exige a origem configurada e Access-Control-Request-Method.
Responde 204 sem consultar sessão ou banco e sem consumir atividade de sessão:

```http
OPTIONS /auth/me
Origin: http://localhost:5173
Access-Control-Request-Method: GET
Access-Control-Request-Headers: authorization, content-type
```

A resposta permite GET, HEAD, POST, PUT e OPTIONS; os headers aceitos são
Authorization e Content-Type, com comparação sem distinção entre maiúsculas e
minúsculas. Métodos ou headers fora dessa lista retornam 403 CORS_NOT_ALLOWED.
OPTIONS sem os dados de preflight não cria uma exceção de acesso a recursos.

As respostas para a origem permitida incluem Access-Control-Allow-Origin com
valor exato, Vary: Origin e Access-Control-Expose-Headers: Retry-After. O preflight
inclui também Vary para os headers que determinam sua autorização.
Não é emitido Access-Control-Allow-Credentials e não há cookies de autenticação.

## Contrato para o frontend

Os seis endpoints de identidade preservam os DTOs da Issue 1: respostas de sucesso
com `{ "data": ... }`, logout 204 sem corpo e erros com
`{ "error": { "code": "...", "message": "...", "details": {} } }`.
IDs bigint são strings; datas são ISO UTC. As respostas do onboarding usam no-store.
Os formatos de sucesso/erros internos dos módulos de negócio permanecem próprios,
sem refatoração nesta issue. Erros do gate de autenticação/verificação usam o
envelope de identidade, independentemente da rota protegida solicitada.

| Resposta | Ação esperada do frontend |
|---|---|
| Cadastro 201 com email_verification.delivery_status sent | Oferecer login e confirmação com challenge_id recebido |
| Cadastro 201 com delivery_status failed | Conta já existe; oferecer login e reenvio, sem repetir cadastro |
| Login 200 | Guardar token conforme escolha do frontend e consultar o estado da conta |
| me 200 com status pending | Manter fluxo de confirmação dos canais; recuperar metadados dos desafios |
| me 200 com status verified | Liberar navegação para recursos protegidos conforme permissões do módulo |
| 401 UNAUTHENTICATED, SESSION_EXPIRED ou SESSION_REVOKED | Remover credencial local inválida e solicitar novo login |
| 403 ACCOUNT_NOT_VERIFIED | Atualizar estado por me e encaminhar ao onboarding |
| 403 CORS_NOT_ALLOWED | Corrigir origem/preflight na integração; não tentar resolver com novo login |
| 429 de envio | Respeitar Retry-After ou details.retry_at antes de solicitar reenvio |
| Logout 204 | Remover credencial local e não tentar ler JSON da resposta |

Exemplo mínimo de requisição autenticada entre origens:

```js
const response = await fetch(`${apiBase}/auth/me`, {
  headers: { Authorization: `Bearer ${token}` },
  credentials: 'omit',
});
const body = await response.json();
if (response.status === 401) {
  // Remover a credencial local e solicitar login.
} else if (response.ok) {
  const { user, verification_challenges } = body.data;
  // Atualizar o estado da conta e o onboarding com os DTOs recebidos.
}
```

No login/cadastro use Content-Type: application/json e body JSON. O envio da
credencial é sempre explícito no header. A escolha de armazenamento permanece do
frontend; memória é uma opção para o MVP. Não enviar token em URL, cookies ou logs.
O expires_at do login é inicial: as requisições autenticadas renovam a sessão por
um mês de calendário UTC; não tratar a data inicial como expiração absoluta.
O frontend não recebeu novas telas, dependências ou bibliotecas nesta entrega.

## Validação final

```bash
npm run build
npm run lint
HU01_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/hu01_test npm test
```

Use banco PostgreSQL 16 dedicado conforme os Runbooks anteriores. A suíte aplica
migrations e limpa suas fixtures; não utiliza DATABASE_URL como fallback de teste.
Sem HU01_TEST_DATABASE_URL, os testes reais de banco são pulados. Os testes HTTP
precisam de permissão para abrir portas locais.

Evidências: build e lint aprovados; 331 testes aprovados em 17 arquivos, incluindo
todos os testes PostgreSQL, sem testes pulados. Foram validados gate global,
visitantes/pending/verified, onboarding público/autenticado, ausência de fallback
mockado, identidade e vínculos por ID real, header forjado, CORS/preflight sem Bearer,
origens não permitidas, exposição de Retry-After e a jornada com reciclagem de
telefone e perda de acesso protegido. Nenhuma nova dependência foi adicionada.

A comunicação permanece exclusivamente mockada: não há entrega real ou comprovação
efetiva dos canais. Provedores reais, filtro definitivo de e-mail, frontend visual
e persistência de associações em grupos permanecem fora do escopo da HU01.
A implementação para aqui, aguardando a revisão final da Issue 8.
