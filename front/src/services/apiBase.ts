const configuredBase = import.meta.env.VITE_API_URL?.trim() || 'https://localhost:3000';
let end = configuredBase.length;
while (end > 0 && configuredBase[end - 1] === '/') end--;

export const API_BASE = configuredBase.slice(0, end);
