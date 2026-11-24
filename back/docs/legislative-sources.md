# HU11 (#34) — Catálogo e fontes legislativas

A referência `meetings.legislative_bill_id` aponta para um UUID local estável. Atualizar o PL não altera o assunto gravado numa reunião. A chave de origem combina casa e ID externo, inclusive quando Senado e Câmara compartilham número e ano. A criação livre e as sugestões federais continuam disponíveis sem preferência de UF. A UF selecionada fica no navegador, por conta.

## Cobertura inicial

Sondagem pontual com os adaptadores do projeto em 24/11/2026, sem chave. Os números identificam candidatos importáveis/status ativo na amostra. O status da CLDF pode vir da situação explícita ou de uma fase reconhecida e conservadora, como Comissões. Fases ambíguas permanecem fora das sugestões. Catálogos são recortes operacionais, sujeitos ao estado da origem.

| Origem | Disponibilidade |
|---|---|
| Senado | 60/60. API `/processo`, filtro de matérias do Senado e detalhe para revalidar IDs conhecidos. Substitutivos retornados pela busca são descartados. A fonte documenta 429 acima de 10 req/s. [Contrato oficial](https://legis.senado.leg.br/dadosabertos/api-docs/swagger-ui/index.html) |
| Câmara | 20/10. Descoberta amostra quatro páginas do ano corrente e confirma o estado no detalhe. Propostas recém-protocoladas e estado desconhecido ficam fora da oferta. [API oficial](https://dadosabertos.camara.leg.br/swagger/api.html) |
| DF | 40/27. PLe via consulta paginada pública e reconsulta por número/ano com conferência do ID. O detalhe por ID devolveu lista vazia na amostra, e `number` da resposta não distinguiu as páginas. [CLDF](https://dados.cl.df.gov.br/dataset/proposicoes) |
| AC, AL, AM, PB, PI, RO | SAPL via HTTPS, 20/14, 20/10, 20/12, 20/19, 40/13 e 20/7, respectivamente. Os códigos locais de tipo são resolvidos em cada casa. Páginas usam `tipo` e `ano` e o booleano `em_tramitacao`. [SAPL Interlegis](https://github.com/interlegis/sapl) |
| SP | O arquivo oficial diário de proposituras respondeu, mas a amostra não continha marcador de situação atual. O arquivo de andamentos tem contrato distinto e exige homologação do vínculo e da interpretação de status. O portal fica acessível na interface. [Proposituras](https://dadosabertos.al.sp.gov.br/group/processo-legislativo/dataset/proposituras?from=groups) · [Andamentos](https://www.al.sp.gov.br/dados-abertos/recurso/221) |
| MG e PR | Adaptadores pendentes. MG respondeu 403 nas rotas sondadas. A URL HTTPS de PR falhou na verificação de certificado. [ALMG](https://dadosabertos.almg.gov.br/documentacao/index) · [ALEP](https://transparencia.assembleia.pr.leg.br/servicos/dados-abertos) |
| RR, MA, AP e SE | Adaptadores pendentes. Sondagens tiveram timeout, TLS inválido ou host SAPL não confirmado. |
| BA, CE, ES, GO, MT, MS, PA, PE, RJ, RN, RS, SC e TO | Portais oficiais disponíveis como referência. API ou exportação estruturada de tramitação ainda precisa de validação. |

A oferta regional cobre **7 das 27 UFs** no registro de adaptadores. A exigência de cobertura nacional permanece pendente. Uma UF sem conector exibe sua situação e o link oficial, preservando a reunião com assunto livre. Cadência oficial de publicação e latência até a aplicação precisam de acompanhamento por casa, inclusive nas fontes sondadas.

## Execução e atualização

1. Em `back/`, configure a `DATABASE_URL` já usada pela API e execute `npm run db:migrate` e `npm run build`.
2. Execute `LEGISLATIVE_SYNC_ENABLED=true npm run worker:legislative-sync` com a mesma base. O processo usa as origens HTTPS fixadas no código. Não exige chave, OAuth nem novo serviço. Em implantação, supervisione o worker separadamente da API e habilite saída HTTPS para as fontes.
3. A primeira coleta começa com pequeno atraso distribuído. Depois há revalidação aproximadamente a cada 6 h e retentativa a partir de 15 min, respeitando `Retry-After`. Cada casa tem lease próprio e limite de 2 req/s. O worker reconsulta até 120 IDs ativos ou vinculados mais antigos e faz descoberta limitada por rodada. Um projeto fora desse recorte perde a oferta ao expirar a confirmação anterior. A ausência numa página não encerra um projeto.
4. Nas sugestões, confira a origem e a hora de confirmação. Só é selecionável PL com tramitação confirmada há **até 24 h**, inclusive. A API revalida ao gravar. A falha conserva o último registro e os vínculos. O catálogo histórico por ID continua disponível. O recorte inicial usa fontes dinâmicas e desconta da confirmação a maior idade de cache informada no lote. Respostas com idade explicitamente superior a 24 h são rejeitadas.

Monitore a partir de 18 h da última coleta válida e observe registros antigos e a situação dos jobs por origem.

```sql
SELECT house_key, last_success_at, next_attempt_at, failure_code
FROM legislative_source_sync
WHERE last_success_at IS NULL OR last_success_at < now() - interval '18 hours'
   OR failure_code IS NOT NULL;
```

Para homologar o requisito de atualização em relação ao Legislativo, amostre mudanças reais de situação/ementa, guarde o instante de publicação oficial e o primeiro instante observado no catálogo e confirme diferença de até 24 h por casa. O teste de idade na aplicação e a sondagem pontual não medem toda a cadeia de publicação. Uma UF sem fontes recentes apresenta estado de indisponibilidade em vez de PL desatualizado.

## Contrato HTTP e testes

Contas verificadas usam `GET /legislative-bills/suggestions?uf=AC`, `GET /legislative-bills?house_key=SF&q=educação` e `GET /legislative-bills/:id`. `POST /meetings` aceita `legislative_bill_id` opcional e usa o assunto canônico do catálogo. IDs inválidos retornam 400. Estado sem tramitação confirmada, projeto ausente ou expirado retornam 422 `LEGISLATIVE_BILL_UNAVAILABLE`. Lista e detalhe da reunião devolvem a FK ou `null`.

Configure `HU11_TEST_DATABASE_URL` para um PostgreSQL 17 descartável exclusivo. Rode `npm test -- legislative` em `back/`. O CI usa fixtures sem acessar os provedores. Para regressão, configure as URLs HU01–HU11 e execute build, lint e cobertura no backend e no frontend.
