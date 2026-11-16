# Testes de mutação de identidade

O StrykerJS avalia se os testes detectam alterações incorretas na política de senhas. A configuração em `back/stryker.config.json` limita a mutação a `src/modules/identity/password.service.ts` e usa o runner de comando para executar a suíte `src/modules/identity/tests/registration.test.ts` inteira por mutante.

## Ambiente e execução

Usar Node compatível com o projeto: StrykerJS 10.1.1 exige Node >=22. O ambiente local validado usa Node 24.21.0; a CI está configurada com Node 22. A versão exata do core e a árvore de dependências estão no lockfile do backend.

A partir da raiz do repositório:

```bash
cd back
npm ci
npm run test:mutation:dry-run
npm run test:mutation
```

O dry run instrumenta o arquivo e verifica se a suíte passa sem ativar mutantes; não calcula a efetividade dos testes. O segundo comando executa a campanha real. Antes de iniciar, os testes originais precisam passar.

Não é necessário PostgreSQL, SMTP ou credenciais externas para essa campanha. Os testes usam bcrypt real com custo 4 e dependências de cadastro em memória. A ferramenta precisa abrir uma porta local para seu servidor de logs; ambientes que bloqueiam essa operação podem apresentar `listen EPERM`.

## Parâmetros

- `testRunner: command`: reutiliza o comando Vitest, sem plugin adicional.
- `coverageAnalysis: off`: executa a suíte inteira por mutante, sem otimização por teste ou distinção de `NoCoverage`.
- `concurrency: 2`: limita o número de processos.
- `timeoutMS: 10000`: timeout base; investigar instabilidade antes de alterar esse parâmetro.
- `thresholds.break: 0`: não impõe percentual mínimo para interromper a execução.
- Operadores padrão: sem exclusões para aumentar o score.

O runner de comando conta a execução do comando como unidade. `testsCompleted: 1` não significa que apenas um caso Vitest foi executado. Para descobrir qual teste matou um mutante, consultar o `statusReason` no JSON e a saída do Vitest.

## Relatórios e preservação local

O comando gera `back/reports/mutation/mutation.html` e `mutation.json`. Outra execução pode sobrescrevê-los. Preservar os relatórios antes de repetir a campanha, em um diretório novo:

```bash
cd back
mkdir -p evidence/a5
snapshot_dir=$(mktemp -d evidence/a5/run-XXXXXX)
set -o pipefail
npm run test:mutation 2>&1 | tee "$snapshot_dir/run.log"
# Executar a cópia após confirmar que a campanha terminou com sucesso.
cp -R reports/mutation "$snapshot_dir/"
git rev-parse HEAD > "$snapshot_dir/commit.txt"
```

Registrar também versões de Node/npm, alterações ainda não commitadas, configuração, duração e hashes dos arquivos quando for necessário comparar campanhas. Para reproduzir estados anteriores, usar checkouts separados dos commits desejados, sem descartar alterações locais, executar `npm ci` e manter o mesmo escopo e comando.

`back/evidence/`, `back/reports/mutation/` e `back/.stryker-tmp/` são ignorados pelo Git e pelo lint. Não adicionar essas pastas com `git add -f`. Relatórios da atividade e PDFs permanecem locais para posterior incorporação ao relatório da equipe.

## Interpretação

| Estado | Interpretação |
|---|---|
| `Killed` | Um teste falhou com a mutação ativa; conferir se foi pelo comportamento alterado |
| `Survived` | O comando passou; investigar lacuna de entrada/asserção, equivalência ou problema de execução |
| `Timeout` | Execução excedeu o limite; verificar repetibilidade e infraestrutura |
| Erro de compilação/execução | Separar de detecção legítima de comportamento incorreto |

O score bruto é `100 × (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage)`. Erros e ignorados ficam fora desse denominador. Não confundir essa métrica com cobertura de linhas nem excluir equivalentes silenciosamente. Com o runner de comando, a coluna de score de código coberto não demonstra cobertura medida.

Um sobrevivente equivalente pode preservar exatamente o comportamento do original. Por exemplo, a equivalência entre `'utf8'` e encoding vazio em `Buffer.byteLength` deve ser justificada pelo comportamento do runtime usado; não criar mocks para matar artificialmente esse tipo de mutante.

Ao melhorar testes, validar comportamentos públicos: fronteiras da política, mensagens por campo e rejeição de credenciais acima do teto mesmo com prefixo válido compartilhado. Comparar o mesmo mutante por arquivo, localização, operador e substituição, pois IDs podem mudar entre configurações ou versões.

## Validação de regressão

```bash
cd back
npm run test:coverage
npm run build
npm run lint
```

A suíte completa usa Supertest e precisa de portas locais. As suítes PostgreSQL são condicionadas a `HU01_TEST_DATABASE_URL`; testes pulados não comprovam integração com banco. Usar somente banco dedicado de teste conforme o [runbook de identidade](identity-2-database-runbook.md).

A CI existente executa build, lint e cobertura; a campanha de mutação é executada pelo script dedicado. Após integrar alterações de cadastro, repetir as verificações no estado integrado antes de consolidar a entrega.

Referências: [configuração do StrykerJS](https://stryker-mutator.io/docs/stryker-js/configuration/) e [estados e métricas](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/).
