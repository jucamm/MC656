import { Pauta } from '../pautas.types.js';

export interface PautasRepository {
  save(pauta: Pauta): Promise<void>;
  findAll(): Promise<Pauta[]>;
}