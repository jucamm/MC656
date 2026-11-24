# HU08 (#27) — Revisão e moderação de atas

A revisão está disponível no detalhe da reunião após o encerramento na plataforma. O organizador vigente e os moderadores que ainda têm participação elegível podem editar, aprovar, rejeitar, ocultar, republicar e excluir atas. Consulta e histórico seguem a audiência da reunião, inclusive para reuniões de grupo. O bloqueio local revoga a moderação efetiva e preserva a leitura que a audiência permite.

## Configuração e validação local

A HU08 usa o PostgreSQL, a sessão e o worker da HU07. Os comandos abaixo partem de `back/` com a `DATABASE_URL` da aplicação, conforme o [runbook de banco](identity-2-database-runbook.md). A revisão de atas por notas dispensa OAuth e funciona com `MEET_TRANSCRIPTION_ENABLED=false`. Para habilitar captura, siga as [instruções da HU07](meetings-hu07-atas.md).

1. Execute `npm run db:migrate` para criar `meeting_minute_events`. A migração é aditiva e mantém as atas e revisões anteriores.
2. Execute `npm run build` e inicie a API com `npm start`. Em outro terminal, execute `npm run worker:minutes` com o mesmo banco.
3. No frontend, crie uma reunião presencial, encerre-a no horário previsto e envie notas no detalhe com uma conta gestora. Aguarde a geração ou clique em **Atualizar ata**.
4. Quando o rascunho aparecer, abra **Editar ata**, salve uma revisão e confirme **Publicar rascunho**. Consulte a ata em outra conta com acesso à reunião. Abra nova edição e confirme que a versão pública segue indicando o texto anterior até a aprovação.
5. Oculte a publicação e confira a retirada do detalhe e do histórico dessa outra conta. Republique a versão oculta. Exclua uma ata de teste e confira que a reunião continua acessível pela audiência original e que não é possível solicitar nova geração.
6. Para a suíte integrada, aponte `HU08_TEST_DATABASE_URL` para um banco descartável exclusivo, diferente de `HU07_TEST_DATABASE_URL`. Os dois testes executam workers que consomem a fila do próprio banco.

   ```bash
   createdb mc656_hu08_test
   HU08_TEST_DATABASE_URL=postgresql:///mc656_hu08_test \
     npm test -- src/modules/meetings/tests/meetings-minutes-review.postgres.test.ts
   ```

Para a regressão completa, execute `npm run build`, `npm run lint` e `npm run test:coverage` no backend e no frontend. Configure as URLs de teste de HU01 a HU07 conforme os runbooks existentes e mantenha o banco da HU08 separado.

## Decisões editoriais e operação

| Ação | Efeito |
|---|---|
| Editar | Cria revisão imutável. A publicação vigente continua visível com o mesmo texto. |
| Publicar | Promove exatamente a revisão confirmada e registra o responsável. Uma publicação oculta pode voltar ao público pela confirmação da versão anterior. |
| Rejeitar | Mantém o rascunho para nova edição. Se já havia publicação, ela permanece disponível. |
| Ocultar | Retira a publicação do detalhe e do histórico. Conserva a versão para gestores. |
| Excluir | Torna a retirada definitiva na interface, revoga a geração ativa e conserva a reunião. Os dados e os eventos permanecem para auditoria até definição de política de descarte. |

O organizador vigente e os moderadores efetivos usam a mesma política para todos os tipos de reunião do schema atual. Uma futura regra exclusiva para o criador no Legislativo depende de definição de produto e de um tipo de reunião persistido. A publicação de trechos da transcrição e a retenção da fonte precisam seguir a política aprovada para o piloto da HU07. Falha ou expiração do Meet afeta a consulta à fonte. Revisões já gravadas continuam disponíveis aos gestores.

A API registra ação, ator, horário, versão e revisão envolvida na mesma transação. Conflitos de versão exigem recarregar a ata e comparar o texto local antes de escolher a nova base. Consulte [os contratos HTTP](meetings-contracts.md#revisão-e-moderação-de-atas-hu08).
