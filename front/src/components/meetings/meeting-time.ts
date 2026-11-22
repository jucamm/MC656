export const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const meetingTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function formatMeetingTime(startsAt: string) {
  return meetingTime.format(new Date(startsAt));
}

export function parseLocalMeetingTime(value: string): Date | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  // Date ajusta automaticamente horários inexistentes na mudança de fuso.
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
  return local.slice(0, 16) === value ? date : null;
}
