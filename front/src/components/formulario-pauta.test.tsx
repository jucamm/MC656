import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import FormularioPauta from './formulario-pauta';

describe('FormularioPauta Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response())
    );
  });

  // CRITÉRIO DE ACEITE: Impedir envio caso campos obrigatórios não estejam preenchidos
  it('deve impedir o envio e exibir mensagens de erro quando os campos estiverem vazios', async () => {
    render(<FormularioPauta />);

    const submitButton = screen.getByRole('button', { name: /enviar pauta/i });
    await userEvent.click(submitButton);

    expect(screen.getByText('O título da pauta é obrigatório.')).toBeInTheDocument();
    expect(screen.getByText('A descrição da pauta é obrigatória.')).toBeInTheDocument();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // CRITÉRIO DE ACEITE: Preencher e enviar o formulário com sucesso + Mensagem de sucesso
  it('deve enviar os dados corretamente e exibir mensagem de sucesso', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: 'Pauta criada com sucesso' }),
    } as Response);

    render(<FormularioPauta />);

    const inputTitulo = screen.getByLabelText(/título da pauta/i);
    const inputDescricao = screen.getByLabelText(/descrição/i);
    const submitButton = screen.getByRole('button', { name: /enviar pauta/i });

    await userEvent.type(inputTitulo, 'Sprint Planning');
    await userEvent.type(inputDescricao, 'Definição das tarefas da próxima sprint.');

    await userEvent.click(submitButton);

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3000/api/pautas',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo: 'Sprint Planning',
          descricao: 'Definição das tarefas da próxima sprint.',
        }),
      })
    );

    await waitFor(() => {
      expect(screen.getByText('Pauta submetida com sucesso!')).toBeInTheDocument();
    });

    expect(inputTitulo).toHaveValue('');
    expect(inputDescricao).toHaveValue('');
  });

  // CRITÉRIO DE ACEITE: Desabilitar botão de envio durante a requisição
  it('deve desabilitar o botão durante o envio da requisição', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ ok: true } as Response), 100)
        )
    );

    render(<FormularioPauta />);

    await userEvent.type(screen.getByLabelText(/título da pauta/i), 'Pauta Teste');
    await userEvent.type(screen.getByLabelText(/descrição/i), 'Descrição Teste');

    const submitButton = screen.getByRole('button', { name: /enviar pauta/i });
    await userEvent.click(submitButton);

    const loadingButton = screen.getByRole('button', { name: /enviando.../i });
    expect(loadingButton).toBeDisabled();
  });

  it('deve exibir mensagem de erro se a requisição HTTP falhar', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
    } as Response);

    render(<FormularioPauta />);

    await userEvent.type(screen.getByLabelText(/título da pauta/i), 'Pauta com erro');
    await userEvent.type(screen.getByLabelText(/descrição/i), 'Descrição qualquer');

    await userEvent.click(screen.getByRole('button', { name: /enviar pauta/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Falha ao enviar a pauta. Tente novamente.')
      ).toBeInTheDocument();
    });
  });
});
