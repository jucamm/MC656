/**
 * ══════════════════════════════════════════════════════════════════════════════
 * TESTE FUNCIONAL — Escopo 1: PautasService.createPauta
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Técnicas aplicadas:
 *   • Particionamento em Classes de Equivalência (CE)
 *   • Análise de Valor Limite (AVL) — variável: janela temporal de submissão
 *
 * Função sob teste:
 *   PautasService.createPauta(input: CreatePautaInput): Promise<Pauta>
 *
 * Entradas consideradas:
 *   - title       (string — obrigatório, não pode ser vazio/espaços)
 *   - description (string — obrigatório, não pode ser vazio/espaços)
 *   - author      (string — obrigatório, não pode ser vazio/espaços)
 *   - context     (PautaContext — 'REPUBLICA' | 'CENTRO_ACADEMICO' | 'LEGISLATIVO')
 *   - submissionDeadline (Date | string — prazo limite para submissão)
 *
 * Saídas observadas:
 *   - Pauta criada com status 'ABERTA' e persistida no repositório (sucesso)
 *   - Error('Os campos obrigatórios devem estar preenchidos')
 *   - Error('Janela de submissão encerrada')
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PautasService } from '../pautas.service.js';
import { InMemoryPautasRepository } from '../repositories/in-memory-pautas.repository.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Deadline fixa usada nos testes de AVL: 2026-12-01T12:00:00.000Z */
const FIXED_DEADLINE = new Date('2026-12-01T12:00:00.000Z');

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Reforma do espaço comum',
    description: 'Planejar a reforma da área de convivência da república',
    author: 'Ana Silva',
    context: 'REPUBLICA' as const,
    submissionDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000), // +1 dia
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASSES DE EQUIVALÊNCIA
// ═══════════════════════════════════════════════════════════════════════════

describe('Escopo 1 — PautasService.createPauta', () => {
  let repository: InMemoryPautasRepository;
  let service: PautasService;

  beforeEach(() => {
    repository = new InMemoryPautasRepository();
    service = new PautasService(repository);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── CE-1.1 (Válida): Todos os campos preenchidos e prazo no futuro ─────

  describe('CE-1.1 — Classe Válida: entrada completa e dentro do prazo', () => {
    it('[CE-1.1] Deve criar pauta com sucesso quando todos os campos obrigatórios estão preenchidos e o prazo está no futuro', async () => {
      const pauta = await service.createPauta(validInput());

      expect(pauta).toBeDefined();
      expect(pauta.id).toBeDefined();
      expect(pauta.title).toBe('Reforma do espaço comum');
      expect(pauta.description).toBe('Planejar a reforma da área de convivência da república');
      expect(pauta.author).toBe('Ana Silva');
      expect(pauta.context).toBe('REPUBLICA');
      expect(pauta.status).toBe('ABERTA');
      expect(pauta.createdAt).toBeInstanceOf(Date);

      const salvas = await repository.findAll();
      expect(salvas).toHaveLength(1);
      expect(salvas[0].id).toBe(pauta.id);
    });

    it('[CE-1.1] Deve criar pauta com contexto CENTRO_ACADEMICO', async () => {
      const pauta = await service.createPauta(validInput({ context: 'CENTRO_ACADEMICO' }));
      expect(pauta.context).toBe('CENTRO_ACADEMICO');
      expect(pauta.status).toBe('ABERTA');
    });

    it('[CE-1.1] Deve criar pauta com contexto LEGISLATIVO', async () => {
      const pauta = await service.createPauta(validInput({ context: 'LEGISLATIVO' }));
      expect(pauta.context).toBe('LEGISLATIVO');
      expect(pauta.status).toBe('ABERTA');
    });

    it('[CE-1.1] Deve aceitar submissionDeadline como string ISO', async () => {
      const futureISO = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const pauta = await service.createPauta(validInput({ submissionDeadline: futureISO }));
      expect(pauta.status).toBe('ABERTA');
    });

    it('[CE-1.1] Deve gerar IDs únicos para pautas diferentes', async () => {
      const p1 = await service.createPauta(validInput({ title: 'Pauta A' }));
      const p2 = await service.createPauta(validInput({ title: 'Pauta B' }));
      expect(p1.id).not.toBe(p2.id);

      const salvas = await repository.findAll();
      expect(salvas).toHaveLength(2);
    });
  });

  // ─── CE-1.2 (Inválida): Título vazio ou apenas espaços ─────────────────

  describe('CE-1.2 — Classe Inválida: título vazio', () => {
    it('[CE-1.2] Deve rejeitar quando o título é string vazia', async () => {
      await expect(
        service.createPauta(validInput({ title: '' })),
      ).rejects.toThrow('Os campos obrigatórios devem estar preenchidos');
    });

    it('[CE-1.2] Deve rejeitar quando o título contém apenas espaços em branco', async () => {
      await expect(
        service.createPauta(validInput({ title: '     ' })),
      ).rejects.toThrow('Os campos obrigatórios devem estar preenchidos');
    });

    it('[CE-1.2] Deve rejeitar quando o título contém apenas tabulações e quebras de linha', async () => {
      await expect(
        service.createPauta(validInput({ title: '\t\n\r' })),
      ).rejects.toThrow('Os campos obrigatórios devem estar preenchidos');
    });

    it('[CE-1.2] Não deve persistir nenhuma pauta no repositório após rejeição por título vazio', async () => {
      await expect(service.createPauta(validInput({ title: '' }))).rejects.toThrow();
      const salvas = await repository.findAll();
      expect(salvas).toHaveLength(0);
    });
  });

  // ─── CE-1.3 (Inválida): Descrição vazia ou apenas espaços ──────────────

  describe('CE-1.3 — Classe Inválida: descrição vazia', () => {
    it('[CE-1.3] Deve rejeitar quando a descrição é string vazia', async () => {
      await expect(
        service.createPauta(validInput({ description: '' })),
      ).rejects.toThrow('Os campos obrigatórios devem estar preenchidos');
    });

    it('[CE-1.3] Deve rejeitar quando a descrição contém apenas espaços em branco', async () => {
      await expect(
        service.createPauta(validInput({ description: '   ' })),
      ).rejects.toThrow('Os campos obrigatórios devem estar preenchidos');
    });

    it('[CE-1.3] Não deve persistir nenhuma pauta no repositório após rejeição por descrição vazia', async () => {
      await expect(service.createPauta(validInput({ description: '' }))).rejects.toThrow();
      const salvas = await repository.findAll();
      expect(salvas).toHaveLength(0);
    });
  });

  // ─── CE-1.4 (Inválida): Autor vazio ou apenas espaços ──────────────────

  describe('CE-1.4 — Classe Inválida: autor vazio', () => {
    it('[CE-1.4] Deve rejeitar quando o autor é string vazia', async () => {
      await expect(
        service.createPauta(validInput({ author: '' })),
      ).rejects.toThrow('Os campos obrigatórios devem estar preenchidos');
    });

    it('[CE-1.4] Deve rejeitar quando o autor contém apenas espaços em branco', async () => {
      await expect(
        service.createPauta(validInput({ author: '   ' })),
      ).rejects.toThrow('Os campos obrigatórios devem estar preenchidos');
    });
  });

  // ─── CE-1.5 (Inválida): Prazo de submissão já expirado ─────────────────

  describe('CE-1.5 — Classe Inválida: janela de submissão encerrada', () => {
    it('[CE-1.5] Deve rejeitar quando a data limite já passou (1 dia atrás)', async () => {
      const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await expect(
        service.createPauta(validInput({ submissionDeadline: ontem })),
      ).rejects.toThrow('Janela de submissão encerrada');
    });

    it('[CE-1.5] Deve rejeitar quando a data limite já passou (1 segundo atrás)', async () => {
      const umSegundoAtras = new Date(Date.now() - 1000);
      await expect(
        service.createPauta(validInput({ submissionDeadline: umSegundoAtras })),
      ).rejects.toThrow('Janela de submissão encerrada');
    });

    it('[CE-1.5] Não deve persistir nenhuma pauta no repositório após rejeição por prazo expirado', async () => {
      const passado = new Date(Date.now() - 60 * 60 * 1000);
      await expect(service.createPauta(validInput({ submissionDeadline: passado }))).rejects.toThrow();
      const salvas = await repository.findAll();
      expect(salvas).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ANÁLISE DE VALOR LIMITE (AVL)
  // Variável de limite: Instante de submissão vs. submissionDeadline
  //
  // A condição no código-fonte é:
  //   const currentDate = new Date();
  //   if (currentDate > deadline) → rejeita
  //
  // Portanto o deadline exato (currentDate === deadline) é aceito,
  // e currentDate > deadline por 1ms já é rejeitado.
  //
  // Usamos vi.setSystemTime() para controlar `new Date()` com precisão de ms.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('AVL — Valor Limite: Fronteira temporal da janela de submissão', () => {
    it('[AVL-Tempo][Abaixo do Limite] Deve aceitar submissão 1ms antes do encerramento do prazo', async () => {
      // Simula o relógio 1ms antes do deadline
      vi.useFakeTimers();
      vi.setSystemTime(new Date(FIXED_DEADLINE.getTime() - 1));

      const pauta = await service.createPauta(
        validInput({ submissionDeadline: FIXED_DEADLINE }),
      );

      expect(pauta.status).toBe('ABERTA');
      expect(pauta.createdAt.getTime()).toBe(FIXED_DEADLINE.getTime() - 1);
    });

    it('[AVL-Tempo][No Limite Exato] Deve aceitar submissão no instante exato do deadline (currentDate === deadline)', async () => {
      // Simula o relógio exatamente no instante do deadline
      vi.useFakeTimers();
      vi.setSystemTime(FIXED_DEADLINE);

      const pauta = await service.createPauta(
        validInput({ submissionDeadline: FIXED_DEADLINE }),
      );

      // currentDate > deadline é false quando são iguais → aceita
      expect(pauta.status).toBe('ABERTA');
      expect(pauta.createdAt.getTime()).toBe(FIXED_DEADLINE.getTime());
    });

    it('[AVL-Tempo][Acima do Limite] Deve rejeitar submissão 1ms após o encerramento do prazo', async () => {
      // Simula o relógio 1ms depois do deadline
      vi.useFakeTimers();
      vi.setSystemTime(new Date(FIXED_DEADLINE.getTime() + 1));

      await expect(
        service.createPauta(validInput({ submissionDeadline: FIXED_DEADLINE })),
      ).rejects.toThrow('Janela de submissão encerrada');
    });

    it('[AVL-Tempo] Não deve persistir pauta quando rejeitada 1ms após o deadline', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(FIXED_DEADLINE.getTime() + 1));

      await expect(
        service.createPauta(validInput({ submissionDeadline: FIXED_DEADLINE })),
      ).rejects.toThrow();

      const salvas = await repository.findAll();
      expect(salvas).toHaveLength(0);
    });
  });
});
