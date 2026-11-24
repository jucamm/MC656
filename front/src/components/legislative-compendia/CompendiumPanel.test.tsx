import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { legislativeCompendiaApi as api, type Compendium } from '../../services/legislativeCompendiaApi';
import { CompendiumPanel } from './CompendiumPanel';

const bill = { id: 'pl-35', label: 'PL 35/2036', status_label: 'Encerrado' };
const minute = { meeting_id: 'r-1', revision_id: 'ed-1', title: 'Ata do grupo', published_at: '2036-07-02T13:00:00Z' };
const emptyOpinion = { own_choice: null, can_vote: true, for_percent: null, against_percent: null } as const;
const initial: Compendium = {
  bill,
  opinion: emptyOpinion,
  summary: { status: 'ready', generated_at: minute.published_at, topics: [{
    stance: 'for', argument: 'Apoio ao transporte gratuito.',
    references: [{ ...minute, quote: 'Defendeu transporte gratuito.' }],
  }] },
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mockData(detail = initial) {
  const search = vi.spyOn(api, 'search').mockResolvedValue({ items: [bill], next_cursor: null });
  const details = vi.spyOn(api, 'detail').mockResolvedValue(detail);
  vi.spyOn(api, 'minutes').mockResolvedValue({ items: [minute], next_cursor: null });
  return { search, details };
}

it('busca PL histórico, mostra a fonte citada e abre a ata integral como texto', async () => {
  const actor = userEvent.setup();
  const { search } = mockData();
  const read = vi.spyOn(api, 'minute').mockResolvedValue({ ...minute, body: '<b>Texto integral da ata</b>' });
  render(<CompendiumPanel />);
  const query = screen.getByRole('textbox', { name: 'Buscar por projeto ou tema' });
  await actor.type(query, 'transporte');
  await actor.click(screen.getByRole('button', { name: 'Buscar' }));
  await actor.click(await screen.findByRole('button', { name: /PL 35.*Encerrado/ }));
  expect(search).toHaveBeenCalledWith('transporte', undefined, expect.any(AbortSignal));
  expect(await screen.findByText('Apoio ao transporte gratuito.')).toBeVisible();
  await actor.click(screen.getByRole('button', { name: 'Ler ata de origem' }));
  const reader = await screen.findByRole('region', { name: 'Leitura da ata' });
  expect(await within(reader).findByText('<b>Texto integral da ata</b>')).toBeVisible();
  expect(read).toHaveBeenCalledWith(bill.id, minute.meeting_id, expect.any(AbortSignal));
});

it('exige confirmação antes de emitir voto e carrega a escolha persistida', async () => {
  const actor = userEvent.setup();
  const { details } = mockData();
  const vote = vi.spyOn(api, 'vote').mockImplementation(async () => {
    details.mockResolvedValue({ ...initial, opinion: { own_choice: 'against', can_vote: false, for_percent: 0, against_percent: 100 } });
    return { own_choice: 'against' };
  });
  render(<CompendiumPanel />);
  await actor.click(await screen.findByRole('button', { name: /PL 35/ }));
  const opinion = await screen.findByRole('region', { name: 'Opinião dos usuários sobre o PL' });
  await actor.click(within(opinion).getByRole('button', { name: 'Contra' }));
  expect(vote).not.toHaveBeenCalled();
  expect(within(opinion).getByText(/A escolha é definitiva/)).toBeVisible();
  await actor.click(within(opinion).getByRole('button', { name: 'Confirmar voto' }));
  expect(await screen.findByText('Seu voto: Contra.')).toBeVisible();
  expect(vote).toHaveBeenCalledExactlyOnceWith(bill.id, 'against');
  expect(screen.queryByRole('button', { name: 'Confirmar voto' })).not.toBeInTheDocument();
});

it('trata versão substituída, indisponibilidade do resumo e conflito no voto', async () => {
  const actor = userEvent.setup();
  const { details } = mockData();
  vi.spyOn(api, 'minute').mockResolvedValue({ ...minute, revision_id: 'rev-nova', body: 'Resultado de outra versão' });
  vi.spyOn(api, 'vote').mockRejectedValue({ code: 'LEGISLATIVE_VOTE_ALREADY_CAST', message: 'O voto já foi registrado.' });
  render(<CompendiumPanel />);
  await actor.click(await screen.findByRole('button', { name: /PL 35/ }));
  await actor.click(await screen.findByRole('button', { name: 'Ler ata de origem' }));
  expect(await screen.findByText(/A publicação mudou/)).toBeVisible();
  expect(screen.queryByText('Resultado de outra versão')).not.toBeInTheDocument();
  await actor.click(screen.getByRole('button', { name: 'A favor' }));
  await actor.click(screen.getByRole('button', { name: 'Confirmar voto' }));
  expect(await screen.findByText('O voto já foi registrado.')).toBeVisible();
  details.mockResolvedValue({ ...initial, opinion: { ...emptyOpinion, can_vote: false },
    summary: { status: 'unavailable', generated_at: null, topics: [] } });
  await actor.click(screen.getByRole('button', { name: 'Atualizar votação' }));
  expect(await screen.findByText(/Resumo indisponível/)).toBeVisible();
  expect(await screen.findByRole('button', { name: minute.title })).toBeEnabled();
  expect(screen.queryByText('Apoio ao transporte gratuito.')).not.toBeInTheDocument();
});

it('mostra o estado vazio quando ainda não há publicações elegíveis', async () => {
  vi.spyOn(api, 'search').mockResolvedValue({ items: [], next_cursor: null });
  render(<CompendiumPanel />);
  expect(await screen.findByText('Nenhum resumo encontrado.')).toBeVisible();
});

it('mantém atas publicadas e votação com configuração da IA pendente', async () => {
  mockData({ ...initial, summary: { status: 'unavailable', topics: [], generated_at: null, reason: 'AI_CONFIGURATION_PENDING' } });
  render(<CompendiumPanel />);
  await userEvent.click(await screen.findByRole('button', { name: /PL 35/ }));
  expect(await screen.findByText('Configuração da IA pendente.')).toBeVisible();
  expect(await screen.findByText(minute.title)).toBeVisible();
  expect(screen.getByRole('button', { name: 'A favor' })).toBeEnabled();
});
