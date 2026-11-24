import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MeetingTranscriptPanel } from './MeetingTranscriptPanel';
import { authApi } from '../../services/authApi';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); authApi.setToken(null); });
it('não oferece download de fonte pendente e traduz falha de acesso', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { state: 'pending', ref: null, actions: { can_download: false } } })));
  render(<MeetingTranscriptPanel meetingId="meeting" />);
  expect(await screen.findByText(/Aguardando o encerramento/)).toBeVisible();
  expect(screen.queryByText('Baixar transcrição DOCX')).toBeNull();
});
it('baixa com Bearer e versão sem colocar token na URL e revoga objectURL', async () => {
  authApi.setToken('private-token'); const create = vi.fn(() => 'blob:private'); const revoke = vi.fn();
  URL.createObjectURL = create; URL.revokeObjectURL = revoke;
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ data: { state: 'available', ref: { version: 3 }, actions: { can_download: true } } }))
    .mockResolvedValueOnce(new Response('docx', {
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    }));
  vi.stubGlobal('fetch', fetch);
  render(<MeetingTranscriptPanel meetingId="meeting" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Baixar transcrição DOCX' }));
  expect(fetch.mock.calls[1][0]).toMatch(/download\?version=3$/); expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer private-token');
  expect(create).toHaveBeenCalledTimes(1); expect(click).toHaveBeenCalled();
  await new Promise(resolve => setTimeout(resolve, 1050)); expect(revoke).toHaveBeenCalledWith('blob:private'); click.mockRestore();
});
