import { PautasRepository } from './pautas.repository.js';
import { Pauta } from '../pautas.types.js';

export class InMemoryPautasRepository implements PautasRepository {
  private pautas: Pauta[] = [];

  async save(pauta: Pauta): Promise<void> {
    this.pautas.push(pauta);
  }

  async findAll(): Promise<Pauta[]> {
    return this.pautas;
  }
}