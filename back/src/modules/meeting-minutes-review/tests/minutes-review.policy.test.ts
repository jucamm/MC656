import { describe, expect, it } from 'vitest';
import type { MeetingScope } from '../../meetings/meetings.types';
import { editorialActions, requireMinutesManager, validateTransition } from '../minutes-review.policy';
import type { EditorialState } from '../minutes-review.types';
import { validateReviewCommand } from '../minutes-review.validator';

const draft = 'a0000000-0000-4000-8000-000000000001';
const published = 'a0000000-0000-4000-8000-000000000002';
const pending: EditorialState = { version: 4, visibility: 'published', draft_status: 'pending',
  draft_revision_id: draft, published_revision_id: published };

describe('regras editoriais das atas', () => {
  it('autoriza somente o papel efetivo após o fim local', () => {
    const scope = { meeting: { ended_at: new Date() } as MeetingScope['meeting'],
      isOrganizer: false, isModerator: true, isEligibleParticipant: true, isBlocked: false };
    expect(() => requireMinutesManager(scope)).not.toThrow();
    expect(() => requireMinutesManager({ ...scope, isModerator: false, isOrganizer: true })).not.toThrow();
    expect(() => requireMinutesManager({ ...scope, isModerator: false, isBlocked: true })).toThrow(expect.objectContaining({ code: 'MINUTES_FORBIDDEN' }));
    expect(() => requireMinutesManager({ ...scope, meeting: { ...scope.meeting, ended_at: null } })).toThrow(expect.objectContaining({ code: 'MEETING_NOT_ENDED' }));
    expect(() => requireMinutesManager(null)).toThrow(expect.objectContaining({ code: 'MINUTES_NOT_FOUND' }));
  });

  it('aprova a revisão exata com versão atual e permite republicar só quando oculta', () => {
    const publish = { action: 'publish', expected_version: 4, revision_id: draft } as const;
    expect(validateTransition(pending, publish)).toEqual(pending);
    expect(() => validateTransition(pending, { ...publish, expected_version: 3 }))
      .toThrow(expect.objectContaining({ code: 'MINUTES_VERSION_CONFLICT' }));
    expect(() => validateTransition(pending, { ...publish, revision_id: published }))
      .toThrow(expect.objectContaining({ code: 'MINUTES_INVALID_TRANSITION' }));
    const hidden = { ...pending, visibility: 'hidden', draft_status: 'rejected' } as const;
    expect(validateTransition(hidden, { ...publish, revision_id: published })).toEqual(hidden);
    expect(editorialActions(hidden)).toMatchObject({ can_edit: true, can_republish: true, can_publish: false });
    expect(() => validateTransition(hidden, publish)).toThrow(expect.objectContaining({ code: 'MINUTES_INVALID_TRANSITION' }));
  });

  it('valida corpo estrito, versão, UUID e limites de texto', () => {
    const edit = { expected_version: 4, base_revision_id: draft, title: '  Ata  ', body: '  Texto  ' };
    expect(validateReviewCommand('edit', edit)).toMatchObject({ title: 'Ata', body: 'Texto' });
    for (const input of [{ ...edit, actor_user_id: '1' }, { ...edit, expected_version: 1.1 },
      { ...edit, base_revision_id: 'outro' }, { ...edit, body: 'a'.repeat(32001) },
      { ...edit, body: String.fromCharCode(0) }, { ...edit, title: '  ' }]) {
      expect(() => validateReviewCommand('edit', input)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    }
  });
});
