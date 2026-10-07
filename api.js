import { authToken } from './state.js';

// Since server.js now serves this game itself (see express.static in
// server.js), the API always lives at the same host/port this page was
// loaded from — whether that's http://localhost:3001 or a tunnel URL
// like https://abc123.ngrok-free.app. No hardcoded value to update.
export const API_BASE = window.location.origin;

export async function apiRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}
