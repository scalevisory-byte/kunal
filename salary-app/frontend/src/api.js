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
/*
 * The resolved module, kept so a synchronous caller can reach it. An <img>
 * src cannot await, and by the time any screen that needs one is on, the
 * store has long since loaded.
 */
let localCache = null;
const localStore = () => {
  localPromise ||= import('./localStore.js').then((mod) => {
    localCache = mod;
    return mod;
  });
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
  /*
   * A DELETE CAN CARRY A BODY, and one of them has to.
   *
   * This took no body at all, so "Take the approval back" - which the server
   * refuses without a reason - sent nothing and was refused every single
   * time. The reason was typed, the call went out empty, and the office saw
   * the app decline for no stated cause. It has never once worked.
   */
  del: (path, body) => request('DELETE', path, body),

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

  /**
   * AN UPLOAD WITH NO PASSWORD, for a joining form opened from a link.
   *
   * The token in the path is the identity - there is nobody to be yet - so
   * no authorization header goes with it, and the server reads which
   * invitation it is from the token rather than from anything sent.
   */
  async uploadOpen(path, formData) {
    const res = await fetch(`/api${path}`, { method: 'POST', body: formData });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || 'Upload failed');
    return data;
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
 * A page the server builds, fetched as TEXT rather than downloaded.
 *
 * The offer letter is the one of these: it is a whole HTML document with its
 * own stylesheet, so it cannot be rendered inside the app - it goes into an
 * iframe and is printed from there. Fetching it means the paper is literally
 * what the server sends, not a copy of it assembled here.
 *
 * Server build only. In the single file there is nothing to fetch from.
 */
export async function fetchPage(path) {
  const headers = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { headers, credentials: 'same-origin' });
  if (res.status === 401) throw new AuthError('Sign in again');
  const text = await res.text();
  if (!res.ok) {
    // The server answers a refusal with JSON, and its sentence is the useful
    // half - "this offer has not been approved yet", not "failed (409)".
    let said = '';
    try { said = JSON.parse(text)?.error || ''; } catch { said = ''; }
    throw new Error(said || `Could not open that page (${res.status})`);
  }
  return text;
}

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


/**
 * THE SAME FILE, AS TEXT RATHER THAN A DOWNLOAD.
 *
 * So a report that only ever existed as a CSV can be PRINTED - the office
 * files paper, and a bank file somebody opens in Excel is not a register
 * anybody signs. It goes through the same door as `download`, including the
 * standalone build's own store, so the paper and the spreadsheet are the
 * same bytes.
 */
export async function fetchText(path) {
  if (STANDALONE) return (await (await localStore()).file(path)).text();
  const headers = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { headers, credentials: 'same-origin' });
  if (res.status === 401) throw new AuthError('Sign in again');
  if (!res.ok) throw new Error(`Could not read the report (${res.status})`);
  return res.text();
}

/**
 * A download whose request carries a BODY.
 *
 * The asset report sends the ids on screen and the columns somebody ticked,
 * which is a POST - a thousand ids do not fit in a query string, and working
 * the same filters out again on the server is how an export comes to
 * disagree with the list it was taken from.
 */
export async function downloadPost(path, body, filename) {
  const headers = { 'content-type': 'application/json' };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new AuthError('Sign in again');
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
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

/** Empty this browser's copy. Only the single file has anything to empty. */
export async function eraseEverything() {
  (await localStore()).eraseEverything();
}

/**
 * A page the browser opens in a new tab - an asset label, a sheet of stickers,
 * a voucher.
 *
 * On the server these are ordinary URLs. In the single file there is no server
 * to serve them, so the same shared module builds the page here and it is
 * opened as a blob. Either way the caller just says "open this".
 */
export async function openPage(path) {
  if (!STANDALONE) {
    window.open(`/api${path}`, '_blank');
    return;
  }
  const { body, type } = (await localStore()).page(path);
  const url = URL.createObjectURL(new Blob([body], { type }));
  window.open(url, '_blank');
  // Revoked late: revoking at once can beat the new tab to it.
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * The same page as a data URI, for an <img> that cannot wait for a promise.
 *
 * Synchronous, so it only works in the single file - where localStore is
 * already loaded by the time any asset screen is on - and the caller falls
 * back to the server URL otherwise.
 */
export function pageDataUrl(path) {
  if (!STANDALONE || !localPromise) return '';
  // localStore is a loaded module by now; reach it through the same cache.
  const mod = localCache;
  if (!mod?.page) return '';
  const { body, type } = mod.page(path);
  return `data:${type};charset=utf-8,${encodeURIComponent(body)}`;
}
