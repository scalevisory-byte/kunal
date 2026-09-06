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
  selfTest: () => request('/selftest', { method: 'POST' }),
  usage: (days = 30) => request(`/usage?days=${days}`),

  taskReminders: (taskId) => request(`/tasks/${taskId}/reminders`),
  addTaskReminder: (taskId, body) =>
    request(`/tasks/${taskId}/reminders`, { method: 'POST', body: JSON.stringify(body) }),
  removeTaskReminder: (taskId, reminderId) =>
    request(`/tasks/${taskId}/reminders/${reminderId}`, { method: 'DELETE' }),
  snoozeReminder: (reminderId, minutes) =>
    request(`/tasks/reminders/${reminderId}/snooze`, { method: 'POST', body: JSON.stringify({ minutes }) }),
  acknowledgeReminder: (reminderId) =>
    request(`/tasks/reminders/${reminderId}/acknowledge`, { method: 'POST', body: JSON.stringify({}) }),

  followUps: (status) => request(`/follow-ups${status ? `?status=${status}` : ''}`),
  createFollowUp: (body) => request('/follow-ups', { method: 'POST', body: JSON.stringify(body) }),
  updateFollowUp: (id, body) =>
    request(`/follow-ups/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  snoozeFollowUp: (id, body) =>
    request(`/follow-ups/${id}/snooze`, { method: 'POST', body: JSON.stringify(body) }),
  deleteFollowUp: (id) => request(`/follow-ups/${id}`, { method: 'DELETE' }),

  notifications: () => request('/notifications'),
  readNotification: (id) => request(`/notifications/${id}/read`, { method: 'POST', body: JSON.stringify({}) }),
  readAllNotifications: () => request('/notifications/read-all', { method: 'POST', body: JSON.stringify({}) }),
  dismissNotification: (id) => request(`/notifications/${id}`, { method: 'DELETE' }),

  schedulingSettings: () => request('/scheduling-settings'),
  saveSchedulingSettings: (body) =>
    request('/scheduling-settings', { method: 'PATCH', body: JSON.stringify(body) }),
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
