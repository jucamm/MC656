import { describe, expect, it } from 'vitest';
import { validateConferencing, validateJoinConsent } from '../meeting-conferencing.validator';

const canonical = 'https://meet.google.com/abc-defg-hij';

describe('validação de configuração do Meet', () => {
  it('aceita somente os formatos esperados para cada modalidade', () => {
    expect(validateConferencing({ mode: 'in_person' })).toEqual({ mode: 'in_person' });
    for (const mode of ['virtual', 'hybrid']) {
      expect(validateConferencing({ mode, google_meet_url: canonical })).toEqual({ mode, google_meet_url: canonical });
    }
  });

  it.each([
    'http://meet.google.com/abc-defg-hij',
    'https://meet.google.com:443/abc-defg-hij',
    'https://meet.google.com@external.example/abc-defg-hij',
    'https://me@meet.google.com/abc-defg-hij',
    'https://meet.google.com.external.example/abc-defg-hij',
    'https://meet.google.com/abc-defg-hij#fragmento',
    'https://meet.google.com/abc-defg-hij?param=valor',
    'https://meet.google.com/landing/abc-defg-hij',
    'https://meet.google.com/abc-defg-hi%6a',
    'https://meet.google.com/abc-defg-hij/',
    'https://meet.google.com/ABC-DEFG-HIJ',
    canonical + '\n',
  ])('rejeita endereço fora do formato canônico %j', google_meet_url => {
    expect(() => validateConferencing({ mode: 'virtual', google_meet_url })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR', details: { fields: { google_meet_url: expect.any(String) } } }),
    );
  });

  it.each([{}, [], null, { mode: 'remote' }, { mode: 'in_person', google_meet_url: null },
    { mode: 'hybrid' }, { mode: 'in_person', actorId: '1' }])('rejeita configuração inválida %j', body => {
    expect(() => validateConferencing(body)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  it('exige aceite estritamente booleano e afirmativo', () => {
    expect(() => validateJoinConsent({ accepted_audio_video: true })).not.toThrow();
    for (const body of [{}, { accepted_audio_video: 'true' }, { accepted_audio_video: false },
      { accepted_audio_video: true, user_id: '1' }]) {
      expect(() => validateJoinConsent(body)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    }
  });
});
