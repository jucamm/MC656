import 'dotenv/config';

import { app } from './app';

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('A variável PORT deve conter uma porta válida.');
}

export const server = app.listen(port, () => {
  console.log(`Servidor executando na porta ${port}.`);
});
