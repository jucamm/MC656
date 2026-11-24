# Compêndios públicos de projetos de lei (HU12, #35)

A aba **Compêndios de PLs** reúne atas publicadas e opiniões sobre cada projeto. Contas verificadas têm acesso mesmo fora do grupo. A coleção inclui reuniões públicas encerradas que apontem para o PL e sejam avulsas ou associadas a grupo ativo. Somente a revisão atualmente publicada com evento de aprovação da HU08 é exibida. A criação de reuniões com PL segue o [catálogo da HU11](legislative-sources.md).

## Configuração

1. Em `back/`, use o PostgreSQL da API via `DATABASE_URL` e execute `npm run db:migrate` e `npm run build`. Com a síntese desabilitada, a API já atende a consulta de atas e a votação.
2. Para testar a síntese externa, use atas sintéticas em homologação. Antes de habilitar atas reais, aprove o tratamento de dados, a retenção do provedor e o uso de texto derivado de transcrições. Revise o conteúdo antes da publicação. O redator automático reduz a exposição de e-mails, telefones, documentos e URLs reconhecíveis, enquanto a revisão editorial trata nomes, endereços e outros dados presentes em texto livre.
3. Configure o projeto Google AI Studio e o módulo central conforme [Gemini](gemini-integration.md). Defina modelo, limites, faturamento e condições de dados aprovados. Não há modelo de produção homologado por esta entrega.
4. Use gerenciador de segredos para a chave backend, sem `VITE_*`. API e worker devem usar o mesmo `GEMINI_MODEL`.
5. Em `back/`, execute `npm run worker:legislative-synthesis` como processo supervisionado separado, com saída HTTPS para `generativelanguage.googleapis.com` e o mesmo banco da API. Após publicar uma ata sintética, confira coleção, citações e votação.

| Variável | Finalidade |
| --- | --- |
| `DATABASE_URL` | Conexão PostgreSQL da API e do worker. Exemplo local fictício `postgresql://mc656:senha-exemplo@localhost:5432/mc656_dev`. |
| `LEGISLATIVE_SYNTHESIS_ENABLED` | `true` habilita o worker. Use o mesmo valor na API para indicar sínteses pendentes na interface. Ausente ou `false` mantém o worker desligado. |
| `AI_ENABLED` | Opt-in do módulo central; ausente/false mantém geração pendente. |
| `GEMINI_MODEL` | Versão explícita compatível com generateContent/countTokens/JSON Schema, igual na API e no worker. |
| `GEMINI_API_KEY` | Chave privada do projeto Gemini, necessária ao worker habilitado. |
| `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_INPUT_TOKENS`, `AI_MAX_OUTPUT_TOKENS` | Limites do módulo central documentados em Gemini. |
| `HU12_TEST_DATABASE_URL` | Banco descartável e exclusivo da suíte HU12. Exemplo fictício `postgresql://mc656:senha-exemplo@localhost:5432/mc656_hu12_test`. Os testes injetam um provedor simulado. |

## Operação

- A coleção consulta as publicações vigentes no PostgreSQL. O primeiro GET após o commit pode retornar a nova ata, inclusive com o worker desligado. O requisito de uma hora mede o intervalo até ela aparecer na coleção. A geração da síntese tem medição separada.
- A descoberta roda a cada cinco minutos. O worker divide atas longas em segmentos, usa até 17 chamadas por revisão e valida citações literais em texto minimizado. Processa somente revisões que ainda precisam de uma extração. Agrupa pontos idênticos, conserva posições divergentes e vincula cada ponto às suas revisões de origem.
- A aplicação revalida elegibilidade no GET, antes de cada chamada externa e antes de gravar resultados. Ocultar uma ata bloqueia sua leitura e invalida a síntese que a usava após o commit. A descoberta seguinte remove extrações sem fonte elegível. Essa remoção depende de um worker em execução. Caso o serviço tenha sido desativado permanentemente, um responsável pelo banco pode descartar os caches derivados das tabelas `legislative_minute_insights` e `legislative_compendium_summaries`.
- As chamadas Gemini enviam somente segmentos minimizados da revisão publicada. JSON Schema e citações são validados localmente. Pipeline `gemini-insights-v2:<modelo>` rejeita cache antigo OpenAI; mudança de modelo invalida extrações. Revogação local não elimina uma requisição já recebida pelo provedor. Veja [dados e operação Gemini](gemini-integration.md).
- Falhas transitórias têm até quatro tentativas por revisão, com retentativa progressiva e respeito a `Retry-After` limitado a 60 segundos pelo cliente, sob o teto de backoff da fila. Falhas definitivas deixam a síntese indisponível e preservam a coleção. Após corrigir a causa, o operador pode refileirar apenas o job com falha, atualizando `state='queued'`, `attempts=0`, `failure_code=NULL` e `next_attempt_at=now()` para o PL afetado. Mudanças de manifesto ou versão também refileiram o trabalho. Logs registram códigos, duração, IDs técnicos sem conteúdo nem segredos.

## API e voto

As rotas abaixo usam a sessão de conta verificada, o envelope `{ data }` e `Cache-Control: no-store`.

| Rota | Resultado |
| --- | --- |
| `GET /legislative-bills/compendia?q=...` | Busca paginada de PLs com atas elegíveis, incluindo PLs encerrados. |
| `GET /legislative-bills/:billId/compendium` | Dados do PL, síntese vigente ou estado da geração, percentuais e escolha do titular. PL existente sem atas retorna vazio. |
| `GET /legislative-bills/:billId/compendium/minutes` | Atas atuais por data de publicação e ID de reunião, com cursor exclusivo. |
| `GET /legislative-bills/:billId/compendium/minutes/:meetingId` | Texto completo da revisão publicada ou 404 quando inelegível. |
| `PUT /legislative-bills/:billId/compendium/vote` | Recebe apenas `{"choice":"for"}` ou `{"choice":"against"}`. Retorna 201 no primeiro voto, 200 na repetição da mesma escolha, 409 em mudança de voto ou na primeira emissão sem ata elegível, e 404 se o PL for desconhecido. |

O voto é definitivo por conta e PL. Um PL encerrado pode receber votos enquanto houver ata elegível. Um voto existente permanece registrado quando a coleção fica vazia. A API arredonda o percentual a favor para o inteiro mais próximo e calcula o percentual contra pelo complemento. Ambos são nulos quando ainda não há votos.

## Homologação

- Em `back/`, configure `HU12_TEST_DATABASE_URL` e execute `npm test -- compendium`. A suíte integra publicação da HU08, revogação, incorporação no primeiro GET, conflito de voto e falhas simuladas de IA no PostgreSQL. Em `front/`, execute `npx --no-install vitest run src/components/legislative-compendia`.
- No piloto, meça o intervalo entre a confirmação da publicação e o primeiro GET da coleção que inclui a nova ata. Refaça o teste com o worker desligado e registre o prazo com carga representativa.
- Revise atas sintéticas em português com opiniões opostas, posição ambígua, repetição, falta de conclusão e instruções inseridas no texto. Confira a fidelidade das citações e das posições, registre recusas, volume de tokens, custo e latência p95 antes de habilitar o serviço com dados reais.
