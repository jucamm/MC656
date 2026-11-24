export function reminderWindows(now: Date, week: Date, endOfWeekDay: Date, due: Date, endOfDueDay: Date) {
  const windows: { kind: 'reminder_week' | 'reminder_due'; event_at: Date; expires_at: Date }[] = [];
  if (now <= week) windows.push({ kind: 'reminder_week', event_at: week, expires_at: endOfWeekDay });
  if (now < endOfDueDay) windows.push({ kind: 'reminder_due', event_at: now > due ? now : due, expires_at: endOfDueDay });
  return windows;
}
