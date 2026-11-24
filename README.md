# MC656 — Plataforma de Tomada de Decisão Coletiva

Projeto desenvolvido para a disciplina **MC656 (Engenharia de Software)** no Instituto de Computação da Unicamp (2º semestre de 2026).

O objetivo do sistema é facilitar e estruturar processos de tomada de decisão coletiva em organizações como centros acadêmicos, repúblicas estudantis e assembleias, alinhado ao **ODS 16 da ONU** (Paz, Justiça e Instituições Eficazes).

---

## Estrutura do Projeto

O repositório é organizado no formato de monorepo:

* `back/`: API em **Node.js** com **Express**, **TypeScript**, **PostgreSQL** e **Drizzle ORM**. Contém autenticação (HU01), [grupos e convites (HU02)](back/docs/groups-contracts.md), [reuniões (HU03)](back/docs/meetings-contracts.md), criação de pautas e apuração de votações.
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

Use um banco vazio para a primeira instalação. As migrations preparam identidade, grupos e reuniões. Para reconstruir uma base local descartável ou rodar as suítes PostgreSQL, siga o [runbook de banco](back/docs/identity-2-database-runbook.md).

Com o banco configurado, aplique as migrações e inicie o servidor:

```bash
# Executar as migrações do banco de dados
npm run db:migrate

# Compilar e iniciar o servidor HTTPS
npm run build
npm start
```

O servidor backend estará disponível em `https://localhost:3000`.

Para enviar códigos de verificação por e-mail, configure `MAIL_SERVER`, `MAIL_PORT`, `MAIL_USE_TLS`, `MAIL_USERNAME` e `MAIL_PASSWORD` em `back/.env`. O backend usa Gmail SMTP com STARTTLS na porta 587. Em desenvolvimento, deixar usuário e senha vazios ativa o simulador. Para configurar a conta Google, testar uma entrega real ou diagnosticar falhas, consulte o [guia de Gmail SMTP](back/docs/README.md#gmail-smtp).

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

O frontend usa `https://localhost:3000` para autenticação, grupos, reuniões e pautas. Se usar outro endereço de API, configure `VITE_API_URL` em `front/.env.local`. Quando o backend local usar um certificado autoassinado, abra a URL da API no navegador para aceitar o certificado de desenvolvimento antes de entrar pelo frontend. Configure `TRUSTED_ORIGIN` no backend com a origem efetiva do Vite.

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

O job de backend inicia um PostgreSQL descartável e configura as URLs de teste da HU01, da HU02 e da HU03 para executar também as suítes de integração. O [runbook de banco](back/docs/identity-2-database-runbook.md#testar-em-postgresql-real) descreve como reproduzir a execução local.

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

## Atas de reuniões (HU07)

A partir de `back/`, rode `npm run db:migrate` e `npm run build`. Inicie `npm start` e, em outro processo supervisionado com a mesma `DATABASE_URL`, execute `npm run worker:minutes`. A geração por notas funciona com `MEET_TRANSCRIPTION_ENABLED=false`. Encerre uma reunião na plataforma, abra **Ata da reunião** com uma conta gestora, informe as notas e acompanhe a fila. A leitura de atas publicadas já está disponível para o público da reunião. A aprovação e publicação pelo painel serão entregues na HU08.

### Piloto de transcrição do Google Meet

1. Use uma conta anfitriã Workspace dedicada. Confirme suporte a transcrição em português, espaço no Drive, configurações de compartilhamento e consentimento explícito do Meet. Valide também o fluxo de entrada direta pelo link. Crie uma sala exclusiva por reunião. No Calendar, habilite a transcrição para o evento e garanta que o anfitrião/coanfitrião entre pela web. [Transcrições e consentimento](https://support.google.com/meet/answer/12849897?hl=en)
2. No Google Cloud, habilite a Google Meet API. Configure a tela OAuth conforme o tipo de app, inclua a conta piloto entre os usuários de teste quando aplicável e crie um cliente OAuth Web. Registre o URI de redirecionamento da ferramenta usada pelo operador. Para homologação, pode usar o [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) com **Use your own OAuth credentials** e o URI `https://developers.google.com/oauthplayground` registrado no cliente. Solicite acesso offline e conceda `https://www.googleapis.com/auth/meetings.space.readonly` como anfitrião dedicado. Troque o código por tokens e guarde o refresh token diretamente na configuração privada. O escopo é sensível e a duração da credencial depende da modalidade de publicação do cliente OAuth. [Escopos do Meet](https://developers.google.com/workspace/meet/api/guides/authenticate-authorize) · [OAuth para servidores](https://developers.google.com/identity/protocols/oauth2/web-server)
3. Em `back/.env`, configure `MEET_OAUTH_CLIENT_ID`, `MEET_OAUTH_CLIENT_SECRET` e `MEET_OAUTH_REFRESH_TOKEN`. Informe os IDs locais de organizadores operadores, separados por vírgula, em `MEET_TRANSCRIPTION_OPERATORS`. Defina `MEET_TRANSCRIPTION_POLICY_VERSION` e o aviso aprovado de finalidade, acesso e retenção em `MEET_TRANSCRIPTION_NOTICE`. Ative `MEET_TRANSCRIPTION_ENABLED=true` somente após verificar autorização de captura, revisão e retenção. Use as mesmas variáveis no servidor e no worker. Rotacione ou revogue credenciais pelo Google em caso de mudança de conta ou incidente. [Política de dados Workspace](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
4. Como organizador operador, cadastre o link em uma reunião remota futura e habilite **Transcrição** no painel. Confirme a exigência de aceite explícito antes de liberar a URL. Não altere o texto associado a uma versão de política já utilizada. Valide a política diretamente no Meet e a correlação de uma única chamada com o espaço cadastrado.
5. Encerre a chamada no Meet e a reunião no aplicativo. Acompanhe **Ata da reunião**, confirme a transcrição privada, o rascunho e o tempo entre fim local e disponibilidade. A ata guarda a referência privada à transcrição, lida sob demanda. A API do Meet remove as entradas da transcrição 30 dias após o fim da chamada. Defina com a equipe anfitriã o prazo de revisão e a política local de retenção. O sistema mantém o prazo de 24 horas e sinaliza vencimento mesmo quando uma retentativa posterior funciona. O backlog de produção, o processo worker e seus erros devem ser monitorados. Se OAuth, consentimento ou a edição forem incompatíveis, desative a captura e use notas. [Artefatos e retenção](https://developers.google.com/workspace/meet/api/guides/artifacts)

Para monitorar o piloto sem consultar o conteúdo das atas, execute a consulta abaixo com acesso de leitura. Investigue imediatamente as atas que tenham atingido o prazo ou que estejam há mais de 20 horas sem transcrição.

```sql
SELECT meeting_id, generation_status, attempt_count, deadline_at,
       transcript_ready_at, sla_missed_at, failure_code
FROM meeting_minutes
WHERE deadline_at IS NOT NULL
  AND (sla_missed_at IS NOT NULL OR
       (transcript_ready_at IS NULL AND deadline_at <= now() + interval '4 hours'))
ORDER BY deadline_at;
```

### Testes da HU07

Em `back/`, configure `HU07_TEST_DATABASE_URL` apontando para PostgreSQL descartável e execute `npm test -- src/modules/meeting-minutes/tests`. Para regressão, configure as URLs HU01–HU07 e execute `npm run test:coverage`. Em `front/`, execute `npm run test:coverage`. A suíte automatizada simula o transporte do Meet. A condição de menos de 24 horas com um artefato real é verificada no piloto.
