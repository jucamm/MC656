export type PautaContext = 'REPUBLICA' | 'CENTRO_ACADEMICO' | 'LEGISLATIVO';

export interface Pauta {
  id: string;
  title: string;
  description: string;
  author: string;
  context: PautaContext;
  status: 'ABERTA' | 'ENCERRADA';
  createdAt: Date;
}

export interface CreatePautaResponse {
  success: boolean;
  pauta?: Pauta;
  error?: string;
  statusCode: number;
}

export function createPauta(
  title: string,
  description: string,
  author: string,
  context: PautaContext,
  submissionDeadline: Date
): CreatePautaResponse {
  // Validação de campos obrigatórios
  if (!title.trim() || !description.trim() || !author.trim()) {
    return {
      success: false,
      error: 'Os campos obrigatórios devem estar preenchidos',
      statusCode: 400,
    };
  }

  // Validação da janela de submissão
  const currentDate: Date = new Date();
  if (currentDate > submissionDeadline) {
    return {
      success: false,
      error: 'Janela de submissão encerrada',
      statusCode: 403,
    };
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

  // Se chegou aqui, retorna com sucesso
  return {
    success: true,
    pauta: newPauta,
    statusCode: 201,
  };
}