# Integração de pautas, videoconferência e moderação

A implementação parte de `a2710db` da `feature/hu03`, com a HU02 na ancestralidade. A composição do servidor monta reuniões, pautas, videoconferência, moderação e revisão abaixo do mesmo gate de sessão e e-mail verificado. O detalhe recarrega os painéis após gravações que afetam o conjunto de pautas ou a autorização de outras operações.

- [Pautas e contrato de revisão](meeting-agenda-contracts.md)
- [Configuração, consentimento e homologação do Google Meet](meeting-conferencing.md)
- [Bloqueio local, revisão, votação e encerramento](meeting-moderation-contracts.md)
- [Reuniões e participação da HU03](meetings-contracts.md)

## Migrations

A cadeia consolidada adiciona, em ordem, escopo e bloqueios, pautas, configuração da videoconferência e ciclo de votação. As migrations provisórias das branches de trabalho foram substituídas pelos snapshots encadeados na branch de integração. Para uma base de teste que recebeu migrations provisórias, crie outra base descartável. Uma base da HU03 pode receber a cadeia consolidada por `npm run db:migrate`.

## Regressão

Na pasta `back/`, aponte as seis variáveis para uma base PostgreSQL de testes criada para a integração.

```bash
export HU01_TEST_DATABASE_URL='postgresql://localhost/mc656_test'
export HU02_TEST_DATABASE_URL="$HU01_TEST_DATABASE_URL"
export HU03_TEST_DATABASE_URL="$HU01_TEST_DATABASE_URL"
export HU04_TEST_DATABASE_URL="$HU01_TEST_DATABASE_URL"
export HU05_TEST_DATABASE_URL="$HU01_TEST_DATABASE_URL"
export HU06_TEST_DATABASE_URL="$HU01_TEST_DATABASE_URL"
npm run build
npm run lint
npm run test:coverage
```

Em `front/`, execute build, lint e cobertura. O cenário integrado no backend usa as rotas da aplicação e PostgreSQL real. Ele cobre reunião presencial, pautas, revisão, ingresso, bloqueio, ciclo de votação, encerramento e leitura histórica. Os testes do detalhe exercitam a atualização entre painéis.

Na regressão local com Node 24 e PostgreSQL 17, build e lint passaram nas duas aplicações. Foram 638 testes de backend em 35 arquivos e 39 de frontend em 10 arquivos, com cobertura de linhas de 95,57% e 85,24%, respectivamente. A cadeia de migrations foi aplicada em base vazia e sobre uma base da HU03 com reunião e participante existentes, preservando os registros. O runner do GitHub Actions será exercitado quando o PR for publicado.

## Publicação do stack

A branch de integração concentra os commits dos três agentes, a composição, os snapshots definitivos e os testes conjuntos. O PR empilhado de integração usa `feature/hu03` como base enquanto ela estiver pendente. Promova primeiro a HU02, depois a HU03 e por fim a integração. Quando a HU03 estiver em `develop`, confira o diff e rode a regressão sobre a nova base antes de alterar o destino do PR. Em caso de squash da HU03, preserve os worktrees e prepare uma nova branch de revisão a partir da base integrada, reaplicando o diff próprio da integração.

A homologação de admissão e moderação no Google Meet requer contas e políticas do Google Workspace. O teste automatizado local verifica a emissão do link e o estado da aplicação. A homologação externa precisa confirmar o controle de entrada, silenciamento, remoção, bloqueio e fim na conta anfitriã. [Roteiro externo](meeting-conferencing.md)
