export function meetingFromNotification(fragment: string) {
  const value = new URLSearchParams(fragment.replace(/^#/, '')).get('meeting');
  return value && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
}
