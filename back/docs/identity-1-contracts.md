# HU01 — Issue 1 (Contratos de Identidade)

Este documento descreve os contratos de integração (interfaces, rotas e payloads) para o módulo de Identidade.

> **Atenção ao Escopo:** Esta *Issue* define **apenas os contratos**. A aplicação continuará iniciando normalmente, mas não haverá registro de *handlers* executáveis, *migrations*, autenticação real ou acesso ao banco de dados nesta etapa. Isso garante que o time de Front-end tenha os contratos (mocks) liberados o mais rápido possível, enquanto o Back-end constrói a lógica nas Issues subsequentes (3, 4 e 5).

---

## Passo 1: Configuração e Execução do Ambiente local

Antes de iniciar a visualização ou implementação dos contratos, o ambiente precisa ser configurado com as variáveis de ambiente base.

1. **Instalação e Build:**
Navegue até a pasta `back` e execute:
```bash
npm ci
cp .env.example .env
npm run build
npm start

```


2. **Validação:**
Os comandos de validação de qualidade de código já estão configurados:
```bash
npm run lint
npm test

```


3. **Variáveis de Ambiente (`.env`):**
Apenas a `PORT` (padrão `3000`) é consumida ativamente nesta etapa. No entanto, o template já mapeia a infraestrutura futura:
* `DATABASE_URL`: Conexão com PostgreSQL.
* `TRUSTED_ORIGIN`: Define a origem única permitida (CORS).
* `BCRYPT_COST`: Custo do hash de senha (padrão sugerido: `12`).
* `PASSWORD_MIN_LENGTH`: Tamanho mínimo de senha (padrão sugerido: `8`).
* `VERIFICATION_HMAC_KEY`: Chave para assinar os tokens de verificação. **Deve ser gerada localmente** usando `openssl rand -hex 32`. Nunca versione esta chave.



---

## Passo 2: Convenções de Código e Schemas de Dados

Para garantir consistência entre o front e o back-end, adotamos as seguintes regras para a troca de informações:

* **Localização dos Contratos:** Os schemas TypeScript estão centralizados em `src/modules/identity/identity.types.ts`.
* **Padrões JSON:**
* Chaves em `snake_case`.
* IDs (`bigint`) devem trafegar como `strings` decimais para evitar perda de precisão no JavaScript.
* Identificadores de desafio (códigos de verificação) são `UUIDs`.
* Datas sempre no formato ISO 8601 UTC.


* **Canais Permitidos:** O campo `channel` aceita estritamente `"email"` ou `"phone"`.
* **Códigos numéricos:** Trafegam como `string` para preservar zeros à esquerda (ex: `"001234"`).
* **Objeto UserDto:** Representa o usuário exposto nas requisições.
* O `status` será `pending` (aguardando confirmação) ou `verified`.
* Telefones são normalizados e exibidos como `+55 (XX) 9XXXX-XXXX`.
* Senhas não sofrem manipulação (*trim* ou *lowercase*) e limitam-se a 72 bytes por segurança.



---

## Passo 3: Mapeamento de Endpoints e Regras de Acesso

O sistema utilizará autenticação via *Header* `Authorization: Bearer <token>`. **Não usaremos cookies automáticos, JWT ou Refresh Tokens**. O armazenamento e o envio do token são responsabilidades exclusivas do Front-end.

| Método | Rota | Payload (Entrada) | Resposta (Saída) | HTTP | Regra de Acesso |
| --- | --- | --- | --- | --- | --- |
| POST | `/auth/register` | `RegisterRequest` | `RegisterData` | 201 | Público |
| POST | `/auth/login` | `LoginRequest` | `LoginData` | 200 | Público |
| POST | `/auth/logout` | Nenhum | Nenhum | 204 | Requer Sessão ativa |
| GET | `/auth/me` | Nenhum | `MeData` | 200 | Requer Sessão ativa |
| POST | `/auth/verifications/:channel/send` | Nenhum | `ChallengeDto` | 200 | Requer Sessão ativa |
| POST | `/auth/verifications/:channel/confirm` | `ConfirmVerificationRequest` | `{ user: UserDto }` | 200 | Requer Sessão ativa |

**Regras de Negócio Importantes:**

* **Sessão:** A validade do token é de 1 mês de calendário. O *logout* revoga apenas a sessão atual (múltiplos dispositivos são independentes).
* **Bloqueio Progressivo:** Para confirmar o telefone, o e-mail **precisa** estar confirmado antes. Tentar burlar isso retorna `403 EMAIL_VERIFICATION_REQUIRED`. Qualquer outra rota da aplicação (fora do onboarding) exigirá status `verified`.

---

## Passo 4: Estrutura de Respostas (Payloads)

Todas as respostas de sucesso são envelopadas em um objeto `data`. Respostas de erro são envelopadas em um objeto `error`.

### A. Fluxo de Autenticação

**Cadastro (`POST /auth/register`)**
O sistema já retorna o envio do desafio de e-mail embutido no cadastro para economizar requisições do front-end.

```json
// Requisição
{"name":"Ana Silva","email":"ana@example.com","phone":"11987654321","password":"senha-exemplo"}

// Resposta (201 Created)
{
  "data": {
    "user": {
      "id": "1",
      "status": "pending",
      "email_verified_at": null,
      // ... outros dados omitidos para brevidade
    },
    "email_verification": {
      "delivery_status": "sent",
      "challenge_id": "11111111-1111-4111-8111-111111111111",
      "expires_at": "2026-10-22T12:30:00.000Z"
    }
  }
}

```

*Nota: Se o envio do e-mail falhar, a conta é criada mesmo assim (201), mas `delivery_status` virá como `"failed"`. O front deve instruir o usuário a fazer login e pedir reenvio.*

**Login (`POST /auth/login`)**
Único momento em que o Token é trafegado para o cliente.

```json
// Resposta (200 OK)
{
  "data": {
    "token": "token-opaco-ilustrativo",
    "token_type": "Bearer",
    "expires_at": "2026-11-22T12:00:00.000Z",
    "user": { /* ... */ }
  }
}

```

### B. Fluxo de Verificação (Desafios)

**Solicitar Código (`POST /auth/verifications/email/send`)**
Gera um novo código. E-mail expira em 30 min, telefone em 5 min.

```json
{
  "data": {
    "challenge_id": "22222222-2222-4222-8222-222222222222",
    "channel": "email",
    "expires_at": "2026-10-22T12:35:00.000Z"
  }
}

```

**Confirmar Código (`POST /auth/verifications/email/confirm`)**
Valida o código associado ao `challenge_id`. Três erros invalidam o desafio permanentemente.

```json
// Requisição
{
  "challenge_id": "22222222-2222-4222-8222-222222222222",
  "code": "001234"
}

```

---

## Passo 5: Dicionário de Erros e Rate Limiting

Erros trafegam envelopados para facilitar o *parse* no Front-end. Nunca exponha *stack traces* ou SQL nas respostas.

**Formato padrão de erro:**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Dados inválidos.",
    "details": {
      "fields": { "email": "Informe um e-mail válido." }
    }
  }
}

```

**Políticas de Rate Limit (Anti-Spam para envios):**

* **Limites:** 3 envios por hora / 6 envios por dia (por canal e por conta).
* **Punição:** Ultrapassar o limite diário resulta em um bloqueio de 3 dias no canal.
* **Exemplo de Resposta (429 Too Many Requests):**
A resposta incluirá o cabeçalho HTTP `Retry-After`.
```json
{
  "error": {
    "code": "VERIFICATION_RATE_LIMITED",
    "message": "Limite de envios atingido. Tente novamente mais tarde.",
    "details": { "retry_after_seconds": 3600 }
  }
}

```



---