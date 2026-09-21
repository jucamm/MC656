/** Erro conhecido que pode ser convertido em uma resposta HTTP na borda. */
export class DomainError<
  TCode extends string = string,
  TDetails = unknown,
> extends Error {
  constructor(
    public readonly code: TCode,
    message: string,
    public readonly details?: TDetails,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
