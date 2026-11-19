# MC656 — Plataforma de Tomada de Decisão Coletiva

Projeto desenvolvido para a disciplina **MC656 (Engenharia de Software)** no Instituto de Computação da Unicamp (2º semestre de 2026).

O objetivo do sistema é facilitar e estruturar processos de tomada de decisão coletiva em organizações como centros acadêmicos, repúblicas estudantis e assembleias, alinhado ao **ODS 16 da ONU** (Paz, Justiça e Instituições Eficazes).

---

## Estrutura do Projeto

O repositório é organizado no formato de monorepo:

* `back/`: API em **Node.js** com **Express**, **TypeScript**, **PostgreSQL** e **Drizzle ORM**. Contém as regras de autenticação (HU01), criação de pautas e apuração de votações.
* `front/`: Interface web desenvolvida em **React 19**, **Vite** e **Tailwind CSS**.
* `.github/workflows/`: Pipeline de Integração Contínua (CI) com GitHub Actions.

---

## Pré-requisitos

Para executar o projeto localmente, você precisará de:

* **Node.js** (versão 22 ou superior recomendada);
* **npm**;
* **PostgreSQL** (versão 16 recomendada, para persistência do módulo de identidade).

---

## Como Executar

### 1. Configurar e rodar o Backend

Abra um terminal e acesse a pasta `back`:

```bash
cd back

# Instalar dependências
npm ci

# Configurar variáveis de ambiente
cp .env.example .env
```

> **Atenção:** No arquivo `.env`, certifique-se de configurar a `DATABASE_URL` com os dados do seu PostgreSQL local e definir uma string de pelo menos 32 caracteres em `VERIFICATION_HMAC_KEY`.

Com o banco configurado, aplique as migrações e inicie o servidor:

```bash
# Executar as migrações do banco de dados
npm run db:migrate

# Compilar e iniciar o servidor HTTPS
npm run build
npm start
```

O servidor backend estará disponível em `https://localhost:3000`.

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
