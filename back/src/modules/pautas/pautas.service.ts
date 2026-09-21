import { CreatePautaInput, Pauta } from './pautas.types.js';
import { PautasRepository } from './repositories/pautas.repository.js';
import crypto from 'crypto';

export class PautasService {
  constructor(private readonly pautasRepository: PautasRepository) {}

  async createPauta(input: CreatePautaInput): Promise<Pauta> {
    const { title, description, author, context, submissionDeadline } = input;

    // Validações de campos obrigatórios
    if (!title.trim() || !description.trim() || !author.trim()) {
      throw new Error('Os campos obrigatórios devem estar preenchidos');
    }

    // Validação da janela de submissão
    const deadline = new Date(submissionDeadline);
    const currentDate = new Date();
    
    if (currentDate > deadline) {
      throw new Error('Janela de submissão encerrada');
    }

    // Criação da nova pauta
    const newPauta: Pauta = {
      id: crypto.randomUUID(),
      title,
      description,
      author,
      context,
      status: 'ABERTA',
      createdAt: currentDate,
    };

    // Salvando no repositório
    await this.pautasRepository.save(newPauta);

    return newPauta;
  }
}