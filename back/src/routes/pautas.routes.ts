import { Router, Request, Response } from 'express';
import { createPauta, Pauta } from '../services/pautas.js';

export const pautasRouter = Router();

const pautasDatabase: Pauta[] = [];

// POST: Criaçao de nova pauta
pautasRouter.post('/', (req: Request, res: Response) => {
  const { title, description, author, context, submissionDeadline } = req.body;

  const deadline = new Date(submissionDeadline);
  const result = createPauta(title, description, author, context, deadline);

  if (result.success && result.pauta) {
    pautasDatabase.push(result.pauta);
  }

  return res.status(result.statusCode).json(result);
});

// GET: Listagem das pautas cadastradas
pautasRouter.get('/', (_req: Request, res: Response) => {
  return res.status(200).json(pautasDatabase);
});