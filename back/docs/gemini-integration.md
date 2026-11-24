# Gemini: configuração e operação

O backend centraliza proposta de ata e extração de argumentos em `modules/ai/GeminiClient`. A API REST utiliza HTTPS para `generativelanguage.googleapis.com`, chave no header `x-goog-api-key`, instrução de sistema separada e JSON Schema. Não habilita ferramentas, navegação ou function calling. As respostas permanecem `unknown` até a validação local. Referências: [generateContent](https://ai.google.dev/api/generate-content), [saída estruturada](https://ai.google.dev/gemini-api/docs/structured-output), [contagem de tokens](https://ai.google.dev/api/tokens).

## Configuração

Crie um projeto/API key no Google AI Studio com as permissões e condições de dados aprovadas para o piloto. Confirme faturamento, cotas e suporte do modelo escolhido a `generateContent`, `countTokens` e saída estruturada. Nenhum modelo de produção foi homologado nesta implementação; defina explicitamente a versão, sem fallback silencioso. O modelo Gemini do produto é independente do modelo utilizado no Codex CLI.

| Variável backend | Uso |
| --- | --- |
| `AI_ENABLED` | `true` habilita IA; padrão desabilitado. |
| `GEMINI_API_KEY` | Segredo do projeto, somente no backend/worker. |
| `GEMINI_MODEL` | Nome explícito do modelo compatível. |
| `AI_REQUEST_TIMEOUT_MS` | Prazo total por tentativa, padrão 25000, máximo 60000. |
| `AI_MAX_INPUT_TOKENS` | Orçamento por chamada, padrão 16000, máximo 1000000. |
| `AI_MAX_OUTPUT_TOKENS` | Orçamento por saída, padrão 4000, máximo 32000. |
| `LEGISLATIVE_SYNTHESIS_ENABLED` | Opt-in adicional do worker de compêndios. |

API e workers usam o mesmo modelo para identificar a versão do pipeline. Limites são inteiros positivos. O cliente consulta os limites do modelo e aplica o menor orçamento configurado; chama o tokenizer remoto antes de gerar, sem estimar tokens por caracteres. Entrada acima do orçamento falha integralmente. Tamanho de lote em caracteres é apenas controle operacional prévio, nunca prova de caber no contexto. Chave não vai em `VITE_*`, URL, JSON do modelo ou logs. Use gerenciador de segredos; para rotação, atualize o segredo, reinicie/valide com dado sintético e revogue a chave antiga.

Sem chave/modelo ou com flag desligada, os workers encerram informando **Configuração da IA pendente**. O worker de atas não reivindica jobs sem cliente. Notas ficam preservadas; leitura, edição, publicação de versões existentes, reuniões e a captura/download de transcrições continuam independentes. Configuração completa inválida gera somente erro operacional seguro da IA. Não existe proposta fixa simulando sucesso no produto.

## Fontes e revisão

Notas de até 8000 caracteres e transcrições locais completas são minimizadas antes do envio: contatos/documentos/links reconhecíveis e nomes completos conhecidos das contas envolvidas são removidos. Nomes livres, autoria incerta e outras informações pessoais exigem revisão e política de dados; a minimização não constitui anonimização completa. Não se deduz presença da lista de participantes ou do clique no link.

Transcrição é consumida exclusivamente por `TranscriptSourceReader`: estado `available`, referência com snapshot/versão/hash/política, fim remoto comprovado e fim local. Estados pending/processing aguardam a importação sem consumir tentativa Gemini; unavailable/failed não viram fonte vazia. O GET legado de transcrição lê o snapshot privado e revalida o gestor; não acessa Google sob demanda. A composição injeta o reader PostgreSQL e armazenamento privado disponibilizados pelo módulo Meet.

A geração usa no máximo 16 partes e prazo global de oito minutos, inferior ao lease de dez minutos. Cada afirmação deve referenciar segmento existente e citação literal curta. O servidor valida campos, limites e evidências, depois combina apenas afirmações validadas. Seções **Resumo**, **Discussão**, **Decisões explicitamente registradas** e **Pendências** ficam no mesmo `body` editável da HU08. Datas e pautas são inseridas pelo servidor. Corpo maior que 32000 caracteres falha sem truncar. Nenhuma decisão, tarefa ou publicação é executada pela IA.

O rótulo “Proposta gerada por IA — requer revisão” permanece no corpo inicial. Citações verificam vínculo textual, sem garantir correção semântica ou português perfeito: o revisor deve conferir divergências, ausência de decisão, atribuições e fidelidade. Dados contêm instruções não confiáveis; a proteção depende de escopo mínimo, ausência de ferramentas e validação, além do prompt.

## Fila, recuperação e caches

O processamento reutiliza `meeting_minutes` com claim/lease e CAS. Proveniência inclui hash, snapshot/versão/política e pipeline `gemini-minutes-v1:<modelo>`. Estado editorial, grupo ativo, fonte e lease são revalidados antes/depois de cada parte e antes de persistir. Fonte alterada descarta resposta; rascunhos ou publicações existentes nunca são sobrescritos. Rota retry inicial preserva notas e reinicia tentativas apenas quando não há versão editorial.

Cliente não repete chamadas. Jobs repetem falhas de rede, timeout, 429 e 5xx com backoff; máximo quatro tentativas de processamento. 401/403, modelo ausente, bloqueio, truncamento, JSON/schema ou evidência inválida são definitivos. `Retry-After` do provedor é limitado a 60 segundos; os workers aplicam seus prazos globais. Nenhuma espera mantém conexão ou transação aberta. Lease perdido descarta efeito local; queda pode repetir cobrança externa, sem promessa de faturamento exatamente uma vez.

Compêndios mantêm elegibilidade HU12, coleção/votos independentes e contrato `points`. Pipeline `gemini-insights-v2:<modelo>` invalida cache antigo OpenAI e mudança de modelo. GET exige pipeline e manifesto corrente; descoberta remove extrações inelegíveis/antigas. Revisões legadas sem hash/pipeline não são declaradas propostas Gemini, e excerpt/contagem antiga nunca se torna transcrição válida.

Supervisione `npm run worker:minutes` e `npm run worker:legislative-synthesis` separadamente com banco correto. Registre apenas código seguro, ID técnico, duração e contagens permitidas; nunca conteúdo, prompt, resposta bruta, nomes, tokens OAuth ou chave. Consulte status/failure_code/attempt_count/lease_until das filas. Corrigida a configuração, reinicie worker; jobs queued continuam, failed exigem retry autorizado ou refileiramento operacional limitado ao registro afetado. Atualização de fonte/pipeline refileira compêndios na descoberta.

## Dados e homologação

Aprovar finalidade, consentimento, retenção e condições do projeto antes de conteúdo real. Conta Workspace não implica API paga nem autoriza automaticamente envio a outro serviço. Não enviar conteúdo sensível a serviço gratuito sem condições aprovadas. Aplicam-se [termos Gemini](https://ai.google.dev/gemini-api/terms) e [política Workspace](https://developers.google.com/workspace/workspace-api-user-data-developer-policy). Revogação local impede nova leitura/publicação; não promete apagar instantaneamente cópias já recebidas pelo provedor. Retenção de fontes, snapshots e derivados deve seguir a política institucional e os processos de exclusão aprovados.

Testes automatizados usam transporte simulado e PostgreSQL descartável. Homologação externa continua pendente: projeto/chave/modelo/quota/billing, política de dados, amostras sintéticas em português, p95/tokens/custo, bloqueios e revisão humana de fidelidade. Avalie opiniões opostas, ausência de conclusão, autoria incerta, repetições, injeções pt/en e dados pessoais. Sucesso do mock não habilita produção.
