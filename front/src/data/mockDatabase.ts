export type MockFilter = {
  id: number;
  categoria: number;
};

export const categorias = [
  'Limpeza',
  'Republica',
  'Casa',
] as const;

export type MockPauta = {
  id: number;
  nome: string;
  texto: string;
  categorias: number[];
};

export const mockDatabase = {
  categorias,
  pautas: [
    {
      id: 1,
      nome: 'Limpeza da Rep',
      texto: 'Texto placeholder da pauta sobre limpeza.',
      categorias: [0],
    },
    {
      id: 2,
      nome: 'Chamar jardineiro',
      texto: 'Texto placeholder da pauta sobre jardinagem.',
      categorias: [2],
    },
    {
      id: 3,
      nome: 'Continuidade da Rep',
      texto: 'Texto placeholder sobre a continuidade da republica.',
      categorias: [1],
    },
    {
      id: 4,
      nome: 'Cultura da Casa',
      texto: 'Texto placeholder da pauta sobre cultura da casa.',
      categorias: [1],
    },
    {
      id: 5,
      nome: 'Sobre o Gato',
      texto: 'Texto placeholder da pauta sobre o gato.',
      categorias: [2, 1],
    },
    {
      id: 6,
      nome: 'Comprar Varal novo',
      texto: 'Texto placeholder da pauta sobre o varal.',
      categorias: [2],
    },
  ] satisfies MockPauta[],
};
