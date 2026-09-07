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

  // What the app has actually read, and what each message produced. The only
  // thing that separates "it never arrived" from "nothing was made of it".
  messagesRead: (limit = 60) => request(`/messages?limit=${limit}`),

  // Costs one API call, so it is asked for rather than automatic, and it only
  // ever proposes — applying is a second, explicit call.
  tidyPreview: () => request('/tasks/tidy/preview', { method: 'POST', body: JSON.stringify({}) }),
  tidyApply: (titles) =>
    request('/tasks/tidy/apply', { method: 'POST', body: JSON.stringify({ titles }) }),

  // Copies of the same job already on the list. Reading is free; merging only
  // happens on a press, because two rows that look alike are not always one job.
  duplicates: () => request('/tasks/duplicates/open'),
  mergeDuplicates: (keep, drop) =>
    request('/tasks/duplicates/merge', { method: 'POST', body: JSON.stringify({ keep, drop }) }),

  // Work with somebody else's name on it. `nudge` is the only call in the whole
  // client that sends a WhatsApp message to anybody but the user, and it exists
  // solely so a person can press a button.
  delegation: (status = 'open') => request(`/delegation?status=${status}`),
  delegationCounts: () => request('/delegation/counts'),
  assign: (taskId, name, wid = null) =>
    request(`/delegation/tasks/${taskId}/assign`, {
      method: 'POST', body: JSON.stringify({ name, wid }),
    }),
  nudgePreview: (taskId) => request(`/delegation/tasks/${taskId}/nudge`),
  sendNudge: (taskId, text) =>
    request(`/delegation/tasks/${taskId}/nudge`, {
      method: 'POST', body: JSON.stringify({ text }),
    }),

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

  subtasks: (taskId) => request(`/tasks/${taskId}/subtasks`),
  addSubtask: (taskId, title) =>
    request(`/tasks/${taskId}/subtasks`, { method: 'POST', body: JSON.stringify({ title }) }),
  updateSubtask: (taskId, id, patch) =>
    request(`/tasks/${taskId}/subtasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteSubtask: (taskId, id) => request(`/tasks/${taskId}/subtasks/${id}`, { method: 'DELETE' }),

  dependencies: (taskId) => request(`/tasks/${taskId}/dependencies`),
  addDependency: (taskId, dependsOnId) =>
    request(`/tasks/${taskId}/dependencies`, {
      method: 'POST', body: JSON.stringify({ depends_on_id: dependsOnId }),
    }),
  removeDependency: (taskId, blockerId) =>
    request(`/tasks/${taskId}/dependencies/${blockerId}`, { method: 'DELETE' }),

  groups: () => request('/groups'),
  createGroup: (body) => request('/groups', { method: 'POST', body: JSON.stringify(body) }),
  updateGroup: (id, body) => request(`/groups/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteGroup: (id) => request(`/groups/${id}`, { method: 'DELETE' }),
  applyGroup: (id) => request(`/groups/${id}/apply`, { method: 'POST', body: JSON.stringify({}) }),

  templates: () => request('/templates'),
  createTemplate: (body) => request('/templates', { method: 'POST', body: JSON.stringify(body) }),
  updateTemplate: (id, body) =>
    request(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTemplate: (id) => request(`/templates/${id}`, { method: 'DELETE' }),
  useTemplate: (id, overrides = {}) =>
    request(`/templates/${id}/use`, { method: 'POST', body: JSON.stringify(overrides) }),

  needsConfirmation: () => request('/tasks/pending/confirmation'),
  confirmTask: (id) => request(`/tasks/${id}/confirm`, { method: 'POST', body: JSON.stringify({}) }),
  rejectTask: (id) => request(`/tasks/${id}/reject`, { method: 'POST', body: JSON.stringify({}) }),

  attachments: (taskId) => request(`/tasks/${taskId}/attachments`),
  deleteAttachment: (id) => request(`/attachments/${id}`, { method: 'DELETE' }),

  /**
   * The bytes go up as the raw body - one file per request needs no multipart
   * boundary and no extra dependency on either side. Name and type ride along
   * as query parameters.
   */
  async uploadAttachment(taskId, file) {
    const token = getToken();
    const query = `filename=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || '')}`;
    let response;
    try {
      response = await fetch(`/api/tasks/${taskId}/attachments?${query}`, {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: file,
      });
    } catch {
      throw new Error('Could not reach the server. It may be restarting — try again in a moment.');
    }
    if (response.status === 401) throw new UnauthorizedError();
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error || `Upload failed (${response.status})`);
    }
    return response.json();
  },

  /** Opens a stored file. Fetched with the token, then handed to the browser. */
  async openAttachment(attachment) {
    const token = getToken();
    const response = await fetch(`/api/attachments/${attachment.id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (response.status === 401) throw new UnauthorizedError();
    if (!response.ok) throw new Error(`Could not open that file (${response.status})`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  recurring: () => request('/recurring'),
  createRule: (body) => request('/recurring', { method: 'POST', body: JSON.stringify(body) }),
  updateRule: (id, body) => request(`/recurring/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRule: (id) => request(`/recurring/${id}`, { method: 'DELETE' }),

  engine: () => request('/attention/engine'),
  runEngine: () => request('/reminders/exact', { method: 'POST' }),

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
