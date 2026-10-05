// Thin fetch wrapper. Every mutating request carries the CSRF header the API expects.
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.body = body;
    this.details = body?.details;
  }
}

async function request(method, url, body, isForm = false) {
  const opts = { method, credentials: 'same-origin', headers: { 'x-requested-with': 'project-explorer' } };
  if (body !== undefined) {
    if (isForm) opts.body = body;
    else { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (res.status === 401 && !url.startsWith('/api/auth')) window.dispatchEvent(new Event('pe:signed-out'));
  if (!res.ok) throw new ApiError(res.status, typeof data === 'string' ? { error: data } : data);
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b ?? {}),
  patch: (u, b) => request('PATCH', u, b),
  put: (u, b) => request('PUT', u, b),
  del: (u, b) => request('DELETE', u, b),
  upload: (u, form) => request('POST', u, form, true),
};
