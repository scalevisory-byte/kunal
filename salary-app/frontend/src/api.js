/**
 * The single-file build has no server behind it, so every call is answered by
 * localStore.js instead of fetch. The components never know which one they are
 * running in.
 *
 * localStore pulls in ExcelJS, which the server build has no use for, so it is
 * imported only when this is the standalone build - the constant below is
 * substituted at build time, and the server bundle drops these branches whole.
 */
export const STANDALONE = import.meta.env.VITE_STANDALONE === 'true';

let localPromise = null;
const localStore = () => {
  localPromise ||= import('./localStore.js');
  return localPromise;
};

const TOKEN_KEY = 'salary-app-token';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

/** Thrown on 401 so the app can drop back to the password screen. */
export class AuthError extends Error {}

async function request(method, path, body) {
  if (STANDALONE) {
    try {
      return await (await localStore()).handle(method, path, body);
    } catch (err) {
      if (err.status === 401) throw new AuthError(err.message);
      throw err;
    }
  }

  const headers = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    // The session is a cookie. Same-origin fetch sends it by default, but
    // saying so means a reverse proxy or a tool that copies these calls does
    // not have to guess.
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // 401 means "we do not know who you are" and goes back to the sign-in
  // screen. 403 means "we know, and your role may not" - a very different
  // thing, and signing somebody out for it would be baffling, so it falls
  // through to the normal error below and shows the server's own sentence.
  if (res.status === 401) throw new AuthError('Sign in again');
  if (res.status === 204) return null;

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    /*
     * Anything else the server sent with the refusal comes with it. The
     * duplicate-service check answers 409 with the row it resembles, and the
     * screen needs that row to show what it is asking about - a bare message
     * would make it a refusal rather than a question.
     */
    if (data && typeof data === 'object') Object.assign(err, data, { message: err.message });
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),

  /**
   * The candidate's side of hiring, which has no password to send. Only
   * exists on the server build - the standalone file has no public URL.
   */
  public: {
    get: (path) => request('GET', `/public${path}`),
    post: (path, body) => request('POST', `/public${path}`, body),
    async upload(path, formData) {
      const res = await fetch(`/api/public${path}`, { method: 'POST', body: formData });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Upload failed');
      return data;
    },
  },

  /** Multipart upload for the spreadsheet importer. */
  async upload(path, formData) {
    if (STANDALONE) return (await localStore()).upload(path, formData);

    const headers = {};
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`/api${path}`, { method: 'POST', headers, body: formData });
    if (res.status === 401) throw new AuthError('Wrong password');
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Upload failed');
    return data;
  },
};

/**
 * Downloads go through fetch rather than a plain link so the bearer token
 * travels with them.
 */
export async function download(path, filename) {
  let blob;
  if (STANDALONE) {
    blob = await (await localStore()).file(path);
  } else {
    const headers = {};
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`/api${path}`, { headers, credentials: 'same-origin' });
    if (res.status === 401) throw new AuthError('Sign in again');
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    blob = await res.blob();
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}


/** Standalone only: the whole store as JSON, and putting one back. */
export async function downloadBackup() {
  const blob = new Blob([(await localStore()).backup()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `salary-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function restoreBackup(file) {
  (await localStore()).restore(await file.text());
}
