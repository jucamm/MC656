import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { pautasRouter } from '../pautas.routes.js';

// Criação de um App Express isolado apenas para testar essa rota específica (sem afetar o global)
const app = express();
app.use(express.json());
app.use('/api/pautas', pautasRouter);

describe('API de Pautas - Integração (Supertest)', () => {
  it('deve retornar 201 ao criar uma pauta com dados válidos', async () => {
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000); // Daqui 1 dia
    
    const response = await request(app)
      .post('/api/pautas')
      .send({
        title: 'Nova Pauta de Teste API',
        description: 'Descrição de teste integração',
        author: 'Lari',
        context: 'REPUBLICA',
        submissionDeadline: futureDeadline
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.pauta.title).toBe('Nova Pauta de Teste API');
    expect(response.body.pauta.status).toBe('ABERTA');
  });

  it('deve retornar 400 ao tentar criar pauta sem título ou campos vazios', async () => {
    const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    const response = await request(app)
      .post('/api/pautas')
      .send({
        title: '   ', // Título vazio
        description: 'Descrição de teste API',
        author: 'Lari',
        context: 'REPUBLICA',
        submissionDeadline: futureDeadline
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Os campos obrigatórios devem estar preenchidos');
  });

  it('deve retornar 403 ao tentar submeter pauta fora da janela de submissão', async () => {
    const pastDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000); // Ontem
    
    const response = await request(app)
      .post('/api/pautas')
      .send({
        title: 'Pauta Atrasada',
        description: 'Descrição atrasada',
        author: 'Lari',
        context: 'CENTRO_ACADEMICO',
        submissionDeadline: pastDeadline
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Janela de submissão encerrada');
  });

  it('deve retornar a lista de pautas no GET /api/pautas', async () => {
    const response = await request(app).get('/api/pautas');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});
