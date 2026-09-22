/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import Historico from '../Historico';
import { mockDatabase } from '../data/mockDatabase';

describe('pagina Historico', () => {
  afterEach(() => {
    cleanup();
  });

  test('renderiza todas as categorias como filtros e todas as pautas', () => {
    render(createElement(Historico));

    for (const categoria of mockDatabase.categorias) {
      expect(screen.getByRole('button', { name: categoria })).toBeTruthy();
    }

    for (const pauta of mockDatabase.pautas) {
      expect(screen.getByRole('button', { name: new RegExp(pauta.nome) })).toBeTruthy();
    }
  });

  test('expande e fecha uma pauta ao clicar no botão correspondente', () => {
    render(createElement(Historico));

    const pauta = mockDatabase.pautas[0];
    const botaoPauta = screen.getByRole('button', { name: new RegExp(pauta.nome) });

    expect(botaoPauta.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(pauta.texto)).toBeNull();

    fireEvent.click(botaoPauta);
    expect(botaoPauta.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(pauta.texto)).toBeTruthy();

    fireEvent.click(botaoPauta);
    expect(botaoPauta.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(pauta.texto)).toBeNull();
  });

  test('aplica os filtros selecionados somente ao clicar em Aplicar', () => {
    render(createElement(Historico));

    const categoria = mockDatabase.categorias[2];
    const pautasDaCategoria = mockDatabase.pautas.filter((pauta) => (
      pauta.categorias.includes(2)
    ));
    const pautasForaDaCategoria = mockDatabase.pautas.filter((pauta) => (
      !pauta.categorias.includes(2)
    ));

    fireEvent.click(screen.getByRole('button', { name: categoria }));

    for (const pauta of mockDatabase.pautas) {
      expect(screen.getByRole('button', { name: new RegExp(pauta.nome) })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    for (const pauta of pautasDaCategoria) {
      expect(screen.getByRole('button', { name: new RegExp(pauta.nome) })).toBeTruthy();
    }

    for (const pauta of pautasForaDaCategoria) {
      expect(screen.queryByRole('button', { name: new RegExp(pauta.nome) })).toBeNull();
    }
  });
});