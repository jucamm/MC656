import { Router } from 'express';
import { PautasController } from './pautas.controller.js';
import { PautasService } from './pautas.service.js';
import { InMemoryPautasRepository } from './repositories/in-memory-pautas.repository.js';

export const pautasRouter = Router();

// Montando as dependências (Injeção de dependência manual simples)
const repository = new InMemoryPautasRepository();
const service = new PautasService(repository);
const controller = new PautasController(service);

// Rota de criação
pautasRouter.post('/', controller.create.bind(controller));

// Rota de listagem (usando o repository direto para simplificar nesse momento inicial)
pautasRouter.get('/', async (_req, res) => {
  const pautas = await repository.findAll();
  res.status(200).json(pautas);
});
