import { Request, Response } from 'express';
import { PautasService } from './pautas.service.js';

export class PautasController {
  constructor(private readonly pautasService: PautasService) {}

  async create(req: Request, res: Response) {
    try {
      const pauta = await this.pautasService.createPauta(req.body);
      
      return res.status(201).json({
        success: true,
        pauta,
        statusCode: 201
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erro interno do servidor';
      
      // Mapeamento de erro para 403 se for prazo vencido, ou 400 para erros de validação
      if (message === 'Janela de submissão encerrada') {
        return res.status(403).json({
          success: false,
          error: message,
          statusCode: 403
        });
      }
      
      return res.status(400).json({
        success: false,
        error: message,
        statusCode: 400
      });
    }
  }
}
