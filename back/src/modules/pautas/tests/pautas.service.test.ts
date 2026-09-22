import { describe, it, expect, beforeEach } from 'vitest';
import { PautasService } from '../pautas.service.js';
import { InMemoryPautasRepository } from '../repositories/in-memory-pautas.repository.js';

describe('Serviço de Pautas - createPauta', () => {
  let repository: InMemoryPautasRepository;
  let service: PautasService;

  beforeEach(() => {
    repository = new InMemoryPautasRepository();
    service = new PautasService(repository);
  });

  it('deve criar uma pauta com sucesso quando os dados forem válidos e o prazo estiver no futuro', async () => {
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000); // Daqui 1 dia
    
    const pauta = await service.createPauta({
      title: 'Limpeza do CA',
      description: 'Higienizar o sofá',
      author: 'Lari',
      context: 'CENTRO_ACADEMICO',
      submissionDeadline: futureDeadline
    });

    expect(pauta).toBeDefined();
    expect(pauta.status).toBe('ABERTA');
    
    const pautasSalvas = await repository.findAll();
    expect(pautasSalvas.length).toBe(1);
    expect(pautasSalvas[0].title).toBe('Limpeza do CA');
  });

  it('deve retornar erro quando o título estiver vazio', async () => {
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    await expect(service.createPauta({
      title: '   ',
      description: 'Descrição válida',
      author: 'Lari',
      context: 'CENTRO_ACADEMICO',
      submissionDeadline: futureDeadline
    })).rejects.toThrow('Os campos obrigatórios devem estar preenchidos');
  });

  it('deve retornar erro quando a descrição estiver vazia', async () => {
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    await expect(service.createPauta({
      title: 'Título válido',
      description: '',
      author: 'Lari',
      context: 'REPUBLICA',
      submissionDeadline: futureDeadline
    })).rejects.toThrow('Os campos obrigatórios devem estar preenchidos');
  });

  it('deve retornar erro quando o autor estiver vazio', async () => {
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    await expect(service.createPauta({
      title: 'Título válido',
      description: 'Descrição válida',
      author: '  ',
      context: 'LEGISLATIVO',
      submissionDeadline: futureDeadline
    })).rejects.toThrow('Os campos obrigatórios devem estar preenchidos');
  });

  it('deve retornar erro quando o prazo de submissão já tiver expirado', async () => {
    const pastDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000); // Ontem
    
    await expect(service.createPauta({
      title: 'Título válido',
      description: 'Descrição válida',
      author: 'Lari',
      context: 'CENTRO_ACADEMICO',
      submissionDeadline: pastDeadline
    })).rejects.toThrow('Janela de submissão encerrada');
  });
});
