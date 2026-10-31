const TOKEN_KEY = 'recruitment-token';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

/** Thrown on 401 so the app drops back to the password screen. */
export class AuthError extends Error {}

async function request(method, path, body, { auth = true } = {}) {
  const headers = {};
  if (auth && getToken()) headers.authorization = `Bearer ${getToken()}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) throw new AuthError('Wrong password');
  if (res.status === 204) return null;

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),

  /** The candidate side, which has no password to send. */
  public: {
    get: (path) => request('GET', `/public${path}`, undefined, { auth: false }),
    post: (path, body) => request('POST', `/public${path}`, body, { auth: false }),
    async upload(path, formData) {
      const res = await fetch(`/api/public${path}`, { method: 'POST', body: formData });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Upload failed');
      return data;
    },
  },

  /** Multipart, for a CV the recruiter attaches by hand. */
  async upload(path, formData) {
    const headers = {};
    if (getToken()) headers.authorization = `Bearer ${getToken()}`;
    const res = await fetch(`/api${path}`, { method: 'POST', headers, body: formData });
    if (res.status === 401) throw new AuthError('Wrong password');
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || 'Upload failed');
    return data;
  },
};

/** CSVs go through fetch so the bearer token travels with them. */
export async function download(path, filename) {
  const headers = {};
  if (getToken()) headers.authorization = `Bearer ${getToken()}`;
  const res = await fetch(`/api${path}`, { headers });
  if (res.status === 401) throw new AuthError('Wrong password');
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
