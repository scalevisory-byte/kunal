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

/**
 * Five wrong passwords lock the address out for fifteen minutes. Without its own
 * type this arrives as a plain failure and the dashboard says "something went
 * wrong", which is both unhelpful and untrue - the server knows exactly what
 * happened and for how long.
 */
export class LockedOutError extends Error {
  constructor(seconds) {
    super('too many attempts');
    this.name = 'LockedOutError';
    this.retryAfterSeconds = Number(seconds) || 0;
  }
}

async function request(path, options = {}) {
  const token = getToken();
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    // "Failed to fetch" tells the user nothing they can act on.
    throw new Error('Could not reach the server. It may be restarting — try again in a moment.');
  }

  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    if (response.status === 429) {
      throw new LockedOutError(detail.retryAfterSeconds ?? response.headers.get('Retry-After'));
    }
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
  rescheduleTask: (taskId, body) =>
    request(`/tasks/${taskId}/reschedule`, { method: 'POST', body: JSON.stringify(body) }),
  snoozeReminder: (reminderId, minutes) =>
    request(`/tasks/reminders/${reminderId}/snooze`, { method: 'POST', body: JSON.stringify({ minutes }) }),
  acknowledgeReminder: (reminderId) =>
    request(`/tasks/reminders/${reminderId}/acknowledge`, { method: 'POST', body: JSON.stringify({}) }),

  attention: () => request('/attention'),

  history: (params = {}) => {
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    return request(`/history${query ? `?${query}` : ''}`);
  },
  historySummary: () => request('/history/summary'),
  historyTask: (id) => request(`/history/${id}`),
  restoreTask: (id) => request(`/tasks/${id}/restore`, { method: 'POST', body: JSON.stringify({}) }),

  notifications: () => request('/notifications'),
  readNotification: (id) => request(`/notifications/${id}/read`, { method: 'POST', body: JSON.stringify({}) }),
  readAllNotifications: () => request('/notifications/read-all', { method: 'POST', body: JSON.stringify({}) }),
  dismissNotification: (id) => request(`/notifications/${id}`, { method: 'DELETE' }),

  briefing: () => request('/briefing'),
  runBriefing: () => request('/briefing/run', { method: 'POST' }),
  weeklySummary: () => request('/briefing/weekly'),
  runWeekly: () => request('/briefing/weekly/run', { method: 'POST' }),
  authState: () => request('/auth-state'),

  /**
   * The CSV comes back behind the same bearer token as everything else, so it
   * cannot be a plain link - the browser would send no Authorization header and
   * get a 401. Fetch it, then hand the blob to a click.
   */
  async exportHistory(filters = {}) {
    const query = Object.entries(filters)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const token = getToken();
    const response = await fetch(`/api/history/export${query ? `?${query}` : ''}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (response.status === 401) throw new UnauthorizedError();
    if (!response.ok) throw new Error(`Export failed (${response.status})`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `wa-tasks-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on the next tick: Safari needs the URL to outlive the click.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

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
