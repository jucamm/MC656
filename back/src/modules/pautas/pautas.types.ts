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

export interface CreatePautaInput {
  title: string;
  description: string;
  author: string;
  context: PautaContext;
  submissionDeadline: Date | string; 
}