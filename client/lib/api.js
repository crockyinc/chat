/** Thin wrapper over fetch: JSON in, JSON out, cookies included. */

class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function request(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: { ...headers },
  };
  if (body instanceof FormData) {
    options.body = body;
  } else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(path, options);
  } catch (err) {
    throw new ApiError('Cannot reach the server. Is it still running?', 0, null);
  }

  if (raw && response.ok) return response;
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    throw new ApiError(payload?.error || `Request failed (${response.status})`, response.status, payload);
  }
  return payload;
}

export const api = {
  room: () => request('/api/auth/room'),
  me: () => request('/api/auth/me'),
  identify: (deviceId, displayName, password) =>
    request('/api/auth/identify', { method: 'POST', body: { deviceId, displayName, password } }),
  rename: (displayName) => request('/api/auth/me', { method: 'PATCH', body: { displayName } }),

  history: (limit = 60, before = null) =>
    request(`/api/messages?limit=${limit}${before ? `&before=${before}` : ''}`),

  send: (body, attachmentIds) =>
    request('/api/messages', { method: 'POST', body: { body, attachmentIds } }),

  deleteMessage: (id) => request(`/api/messages/${id}`, { method: 'DELETE' }),

  upload(files) {
    const form = new FormData();
    for (const file of files) form.append('images', file, file.name || 'pasted-image.png');
    return request('/api/uploads', { method: 'POST', body: form });
  },
};

export { ApiError };
