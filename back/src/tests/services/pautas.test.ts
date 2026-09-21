import { describe, it, expect } from 'vitest';
import { createPauta } from '../../services/pautas.js';

describe('Serviço de Pautas - createPauta', () => {

  it('deve criar uma pauta com sucesso quando os dados forem válidos e o prazo estiver no futuro', () => {
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000); // Daqui 1 dia
    const result = createPauta('Limpeza do CA', 'Higienizar o sofá', 'Lari', 'CENTRO_ACADEMICO', futureDeadline);

    expect(result.statusCode).toBe(201);
    expect(result.success).toBe(true);
    expect(result.pauta?.status).toBe('ABERTA');
  });
  it('deve retornar erro 400 quando o título estiver vazio', () => {
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const result = createPauta('   ', 'Descrição válida', 'Lari', 'CENTRO_ACADEMICO', futureDeadline);

    expect(result.statusCode).toBe(400);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Os campos obrigatórios devem estar preenchidos');
    expect(result.pauta).toBeUndefined();
  });

  it('deve retornar erro 400 quando a descrição estiver vazia', () => {
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const result = createPauta('Título válido', '', 'Lari', 'REPUBLICA', futureDeadline);

    expect(result.statusCode).toBe(400);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Os campos obrigatórios devem estar preenchidos');
  });

  it('deve retornar erro 400 quando o autor estiver vazio', () => {
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const result = createPauta('Título válido', 'Descrição válida', '  ', 'LEGISLATIVO', futureDeadline);

    expect(result.statusCode).toBe(400);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Os campos obrigatórios devem estar preenchidos');
  });

  it('deve retornar erro 403 quando o prazo de submissão já tiver expirado', () => {
    const pastDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000); // Ontem (prazo vencido)
    const result = createPauta('Título válido', 'Descrição válida', 'Lari', 'CENTRO_ACADEMICO', pastDeadline);

    expect(result.statusCode).toBe(403);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Janela de submissão encerrada');
    expect(result.pauta).toBeUndefined();
  });
});