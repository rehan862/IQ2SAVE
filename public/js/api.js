/**
 * Thin wrapper over the JSON envelope every route returns:
 *   { success: true, data }  |  { success: false, error: { code, message } }
 */

export class ApiError extends Error {
  constructor(code, message, { status = 0, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('NETWORK', 'Could not reach the local server. Is it still running?');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('BAD_RESPONSE', 'The server sent a response we could not read.', {
      status: response.status,
    });
  }

  if (!response.ok || payload?.success === false) {
    const error = payload?.error ?? {};
    throw new ApiError(error.code ?? 'UNKNOWN', error.message ?? 'Something went wrong.', {
      status: response.status,
      details: error.details,
    });
  }

  return payload.data;
}

export const api = {
  system: () => request('/system'),
  services: () => request('/services'),
  analyze: (url, signal) => request('/analyze', { method: 'POST', body: { url }, signal }),
  download: (url, formatId) => request('/download', { method: 'POST', body: { url, formatId } }),
  job: (id) => request(`/job/${encodeURIComponent(id)}`),
  jobLogs: (id) => request(`/job/${encodeURIComponent(id)}/logs`),
  removeJob: (id) => request(`/job/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  jobs: ({ limit = 50, offset = 0, status = null } = {}) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status) params.set('status', status);
    return request(`/jobs?${params}`);
  },
  fileUrl: (id) => `/api/file/${encodeURIComponent(id)}`,
};
