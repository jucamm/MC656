# MC656 — Plataforma de Tomada de Decisão Coletiva

Projeto desenvolvido para a disciplina **MC656 (Engenharia de Software)** no Instituto de Computação da Unicamp (2º semestre de 2026).

O objetivo do sistema é facilitar e estruturar processos de tomada de decisão coletiva em organizações como centros acadêmicos, repúblicas estudantis e assembleias, alinhado ao **ODS 16 da ONU** (Paz, Justiça e Instituições Eficazes).

---

## Estrutura do Projeto

O repositório é organizado no formato de monorepo:

* `back/`: API em **Node.js** com **Express**, **TypeScript**, **PostgreSQL** e **Drizzle ORM**. Contém autenticação (HU01), [grupos e convites (HU02)](back/docs/groups-contracts.md), criação de pautas e apuração de votações.
* `front/`: Interface web desenvolvida em **React 19**, **Vite** e **Tailwind CSS**.
* `.github/workflows/`: Pipeline de Integração Contínua (CI) com GitHub Actions.

Para integrar as próximas histórias, consulte o [guia de reuso da HU02](back/docs/groups-contracts.md#reuso-da-hu02).

---

## Pré-requisitos

Para executar o projeto localmente, você precisará de:

* **Node.js** (versão 22 ou superior recomendada);
* **npm**;
* **PostgreSQL** (versão 16 recomendada) ou **Docker** para subir o banco local com `create_bd.sh`.

---

## Como Executar

### 1. Configurar e rodar o Backend

Se for usar Docker, execute na raiz do repositório:

```bash
./create_bd.sh
```

O script inicia o PostgreSQL 16 em `127.0.0.1:5432` e exibe a `DATABASE_URL` para o backend. O volume `mc656-postgres-data` preserva os dados entre execuções. Se a porta `5432` já estiver ocupada, escolha outra antes da primeira execução, por exemplo `POSTGRES_PORT=5433 ./create_bd.sh`, e use a mesma porta nas próximas execuções.

Abra um terminal e acesse a pasta `back`:

```bash
cd back

# Instalar dependências
npm ci

# Configurar variáveis de ambiente
cp .env.example .env
```

> **Atenção:** Se `back/.env` já existir, pule o `cp`. Configure `DATABASE_URL` com a linha exibida pelo script ou com os dados do seu PostgreSQL local. Defina também uma string de pelo menos 32 caracteres em `VERIFICATION_HMAC_KEY`.

Use um banco vazio com a migration consolidada de identidade. Para reconstruir uma base local descartável ou rodar as suítes PostgreSQL, siga o [runbook de banco](back/docs/identity-2-database-runbook.md).

Com o banco configurado, aplique as migrações e inicie o servidor:

```bash
# Executar as migrações do banco de dados
npm run db:migrate

# Compilar e iniciar o servidor HTTPS
npm run build
npm start
```

O servidor backend estará disponível em `https://localhost:3000`.

Para enviar códigos de verificação por e-mail, configure `RESEND_API_KEY` e `RESEND_FROM_EMAIL` em `back/.env` antes de iniciar o backend. O remetente de teste `onboarding@resend.dev` só envia para o endereço associado à sua conta no Resend. Para enviar a outros destinatários, use um remetente de um domínio verificado no Resend. Sem a chave do Resend, o backend usa Gmail SMTP se `GMAIL_USER` e `GMAIL_APP_PASSWORD` estiverem configuradas ou simula o envio localmente.

---

### 2. Configurar e rodar o Frontend

Abra outro terminal e acesse a pasta `front`:

```bash
cd front

# Instalar dependências
npm ci

# Iniciar o servidor de desenvolvimento
npm run dev
```

A interface estará acessível no navegador pelo endereço indicado pelo Vite (normalmente `http://localhost:5173`).

O frontend usa `https://localhost:3000` para autenticação, grupos e pautas. Se usar outro endereço de API, configure `VITE_API_URL` em `front/.env.local`. Quando o backend local usar um certificado autoassinado, abra a URL da API no navegador para aceitar o certificado de desenvolvimento antes de entrar pelo frontend. Configure `TRUSTED_ORIGIN` no backend com a origem efetiva do Vite.

---

## Testes Automatizados e Qualidade

O projeto conta com suítes de testes automatizados integradas à esteira de CI. Para rodar as verificações, execute a partir da pasta `back`:

```bash
# Rodar todos os testes unitários e funcionais
npm test

# Rodar testes com relatório de cobertura (Vitest + V8)
npm run test:coverage

# Rodar testes de mutação (StrykerJS)
npm run test:mutation

# Verificação estática (TypeScript e ESLint)
npm run build
npm run lint
```

---

## Pipeline de Integração Contínua (CI)

O repositório utiliza o **GitHub Actions** (`.github/workflows/ci.yml`). A cada *Pull Request* e *Push* nas branches `develop` e `main`, a esteira executa automaticamente:

1. Checagem de tipos do TypeScript (`npm run build`);
2. Análise estática com ESLint (`npm run lint`);
3. Execução completa dos testes automatizados e medição de cobertura com Vitest.

O job de backend inicia um PostgreSQL descartável e configura as URLs de teste da HU01 e da HU02 para executar também as suítes de integração. O [runbook de banco](back/docs/identity-2-database-runbook.md#testar-em-postgresql-real) descreve como reproduzir a execução local.

---

## Histórico de Entregas e Tags

* `a2-v1.0.0`: Atividade 2 — Protótipo de pautas e contagem de votos.
* `a4-v1.0.0`: Atividade 4 — Arquitetura de software e autenticação (HU01).
* `a5-v1.0.0`: Atividade 5 — Testes funcionais, estruturais e de mutação.
* `final-v1.0.0`: Entrega Final — Projeto consolidado.

---

## Equipe

* Állan Rocha Pereira — RA: 252694
* Felipe Gayotto Bianchessi — RA: 281174
* Juca Magalhães Meniconi — RA: 281803
* Larissa Gabriela Arantes Palhares — RA: 177154
* Yago Eizo Yonemura — RA: 222807
