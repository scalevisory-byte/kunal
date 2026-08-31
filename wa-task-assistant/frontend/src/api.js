const TOKEN_KEY = 'wa-tasks-token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'UnauthorizedError';
  }
}

async function request(path, options = {}) {
  const token = getToken();
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `Request failed (${response.status})`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export const api = {
  status: () => request('/status'),
  listTasks: (status) => request(`/tasks?status=${encodeURIComponent(status)}`),
  createTask: (task) => request('/tasks', { method: 'POST', body: JSON.stringify(task) }),
  updateTask: (id, patch) => request(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),
  runReminders: () => request('/reminders/run', { method: 'POST' }),
  blockedChats: () => request('/blocked-chats'),
  blockChat: (pattern) =>
    request('/blocked-chats', { method: 'POST', body: JSON.stringify({ pattern }) }),
  unblockChat: (id) => request(`/blocked-chats/${id}`, { method: 'DELETE' }),
  flushExtraction: () => request('/extract/flush', { method: 'POST' }),
  pushPublicKey: () => request('/push/public-key'),
  subscribePush: (subscription) =>
    request('/push/subscribe', { method: 'POST', body: JSON.stringify(subscription) }),
};
