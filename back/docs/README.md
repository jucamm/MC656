# Cadastro e Autenticação (HU01)

Este guia apresenta as entregas das Issues #36 a #43 e orienta a leitura dos detalhes. A documentação está em `back/docs`. Os documentos de cada issue retratam aquela etapa; esta introdução considera a integração final da Issue #43 e o código atual.

## 1. Visão geral

A HU01 implementa a identificação dos usuários e o controle de entrada na plataforma. Uma pessoa pode criar conta e fazer login, mas só acessa recursos de negócio depois de confirmar e-mail e telefone.

O backend entrega cadastro, senhas protegidas, sessões persistidas, logout, consulta da própria conta, verificação de canais, limites de envio, reciclagem de telefone e controle de acesso com CORS.

**Limites da entrega:** e-mail e telefone usam mocks, substitutos locais dos provedores. Não há entrega real nem comprovação efetiva dos contatos. As telas de autenticação e a persistência das associações em grupos não foram implementadas pela HU01. Outros módulos integrados ainda usam componentes em memória; a persistência da identidade não torna toda a plataforma persistente.

## 2. Organização da solução

O módulo está em `back/src/modules/identity`. As responsabilidades são separadas para que as regras de negócio não dependam diretamente do HTTP.

| Componente | Responsabilidade |
|---|---|
| `app.ts` e `server.ts` | Conectam dependências e montam banco, serviços e rotas na ordem correta. |
| Rotas e controllers | Recebem requisições e adaptam os resultados dos serviços para HTTP. |
| Middlewares | Executam verificações antes dos handlers: origem, sessão, estado da conta e identidade usada nos grupos. |
| Services e validadores | Aplicam cadastro, senha, normalização dos contatos, sessões e verificação. |
| Repositories e schema | Consultam e alteram o PostgreSQL pelo Drizzle ORM, preservando transações e restrições. |
| Adaptadores de comunicação | Simulam sucesso/falha e capturam mensagens para inspeção nos testes. |

As quatro tabelas da HU01 guardam contas (`users`), sessões (`authentication_sessions`), desafios correntes (`verification_challenges`) e cotas de envio (`rate_limits`).

## 3. Conceitos e decisões essenciais

- **Autenticação e autorização:** autenticar identifica a pessoa; autorizar decide seu acesso. Uma conta `pending` pode concluir o cadastro inicial, chamado de onboarding, e sair da sessão. Só fica `verified` após confirmar os dois canais. Mesmo assim, grupos exigem associação/papel próprios: não há concessão automática de administrador.
- **Sessão:** cada login emite um token opaco, uma credencial aleatória sem permissões embutidas. Ele é enviado exclusivamente em `Authorization: Bearer <token>`; o banco guarda apenas seu hash. Não há autenticação por cookies, JWT ou refresh token. A sessão expira após um mês de calendário UTC sem atividade; requisições válidas renovam o prazo. Logout revoga somente a sessão atual.
- **Desafio:** é uma solicitação de confirmação, com UUID e código de seis dígitos. E-mail dura 30 minutos; telefone dura 5 minutos e exige e-mail confirmado. O código é protegido por HMAC, calculado com chave secreta externa ao banco. Reenvio substitui o desafio; três códigos incorretos exigem novo envio.
- **Cotas e falhas:** cada conta/canal permite três envios por hora e seis por dia. Exceder o diário bloqueia envios por 72 horas. As janelas começam no primeiro envio aceito. Falhas do mock não consomem cota nem substituem um desafio válido. Falha no envio inicial preserva o cadastro com `201` e `delivery_status: failed`.
- **Reciclagem de telefone:** contas distintas podem cadastrar o mesmo número. Quando outra conta o confirma, a anterior perde essa confirmação e volta a `pending`, preservando o e-mail. Sua sessão mantém o onboarding disponível, mas a próxima requisição protegida é recusada. Transações e locks evitam duas confirmações vigentes sob concorrência.
- **Senha:** Bcrypt protege a senha sem alterar seu conteúdo. O máximo é 72 bytes, não necessariamente 72 caracteres. Os defaults de custo e mínimo são escolhas técnicas configuráveis; a referência ISO 27100 registrada pela equipe não implica certificação nem define esses valores nos materiais fornecidos.

## 4. Fluxo de funcionamento

Um exemplo com Ana:

1. `POST /auth/register`: o serviço valida os contatos, protege a senha, persiste uma conta `pending` e solicita o desafio de e-mail ao mock.
2. `POST /auth/login`: Ana recebe a sessão e passa a enviar o Bearer nos endpoints autenticados.
3. `POST /auth/verifications/email/confirm`: confirma o e-mail com `challenge_id` e `code`.
4. `POST /auth/verifications/phone/send` e `POST /auth/verifications/phone/confirm`: solicita e confirma o telefone.
5. Com ambos confirmados, `GET /auth/me` informa `verified`. Ana pode acessar `/api/pautas`; grupos exigem também os vínculos correspondentes.
6. `POST /auth/logout`: revoga aquela sessão e responde `204`, sem corpo.

Os middlewares verificam acesso antes dos controllers; os serviços coordenam as regras e os repositories persistem os resultados. Neste exemplo, os códigos são obtidos das mensagens capturadas pelo mock em testes: não chegam por e-mail/SMS real nem são expostos pela API.

## 5. Como continuar o desenvolvimento

### Preparar o ambiente

A stack existente é Node.js, Express, TypeScript, PostgreSQL e Drizzle. Os materiais registram validação com Node 24 e PostgreSQL 16. Em `back`, execute `npm ci`, copie `.env.example` para `.env` e configure `DATABASE_URL`, `VERIFICATION_HMAC_KEY` e `TRUSTED_ORIGIN`. O template também apresenta porta e política de senha. Não versione segredos.

Depois, execute `npm run db:migrate`, `npm run build` e `npm start`. Para validar mudanças, use build, lint e testes pelos scripts do backend. **Sem `HU01_TEST_DATABASE_URL`, os testes reais de banco são pulados.** Consulte o Runbook para usar um banco dedicado e não interpretar a execução padrão como validação completa de persistência.

### Seguir os pontos de integração

- **Contratos:** consulte `identity.types.ts` (DTOs, estruturas de dados trocadas entre componentes) e `identity.errors.ts`. Identidade usa `{ "data": ... }` no sucesso e `{ "error": { "code", "message", "details" } }` no erro; logout não tem corpo. Outros módulos preservam formatos próprios.
- **Convenções:** campos em inglês e `snake_case`, IDs `bigint` como strings, desafios identificados por UUID e datas ISO UTC. Códigos também são strings, preservando zeros iniciais. Entradas HTTP precisam de validação, além da tipagem TypeScript.
- **Acesso:** monte novos routers de negócio depois da autenticação e da verificação globais. Permissões de grupo vêm do servidor, associadas ao ID real. Sem vínculo configurado, mesmo uma conta `verified` recebe `403` nesses recursos; headers mockados não concedem acesso.
- **Frontend:** envie o Bearer explicitamente. Trate `401` como autenticação inválida, examine a causa de `403` e respeite `Retry-After`/`details.retry_at` em `429`. O armazenamento do token no navegador ainda é escolha da equipe. CORS exige a origem exata, permite preflight sem Bearer e não substitui autenticação.
- **Evolução:** preserve transações e a ordem dos locks. Tentativas incorretas e bloqueios precisam permanecer gravados mesmo quando o HTTP retorna erro. Crie novas migrations, sem editar as já aplicadas. Provedores futuros devem integrar pela interface `sendVerification`, respeitando as garantias de falha e a proteção dos códigos.

## 6. Aprofundamentos

| Documento | Assunto |
|---|---|
| [Issue 1 — Contratos](identity-1-contracts.md) | Endpoints, DTOs, convenções e exemplos. |
| [Issue 2 — Banco e migrations](identity-2-database-runbook.md) | Ambiente, criação/aplicação de migrations e restrições. |
| [Issue 3 — Cadastro e senhas](identity-3-registration.md) | Normalização, Bcrypt, defaults e política mockada de domínios. |
| [Issue 4 — Sessões](identity-4-sessions.md) | Token, renovação, logout e estado por `/auth/me`. |
| [Issue 5 — Verificação](identity-5-verification.md) | Desafios, HMAC, confirmação atômica e falhas. |
| [Issue 6 — Comunicação e limites](identity-6-verification-delivery.md) | Mocks por canal, cotas, bloqueios e nova tentativa. |
| [Issue 7 — Reciclagem de telefone](identity-7-phone-recycling.md) | Transferência, concorrência e perda de acesso. |
| [Issue 8 — Acesso e frontend](identity-8-access-control.md) | Matriz final de acesso, CORS, grupos e respostas ao cliente. |

**Atenção às diferenças entre as etapas:** o modo sem banco descrito na Issue 4 foi substituído pela exigência de `DATABASE_URL` na Issue 8. O emissor simulado da Issue 3 foi integrado ao serviço persistido na Issue 5. Pendências e contagens de testes antigas retratam aquela entrega; para acesso e inicialização atuais, consulte a Issue 8.

**Lacunas explícitas:** provedores reais, filtro definitivo de e-mails, persistência dos vínculos de grupo e escolha de armazenamento do token ainda dependem de outras implementações ou decisões. Alguns exemplos da Issue 1 têm comentários e campos omitidos: são ilustrações, não JSON pronto para envio. Use os DTOs e os documentos específicos para montar requisições completas.
