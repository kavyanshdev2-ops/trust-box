import { io } from 'socket.io-client';

const apiUrl = import.meta.env.VITE_MONITORING_API_URL || undefined;
const demoMode = import.meta.env.VITE_MONITORING_DEMO_MODE === 'true';

async function request(path, token, options = {}) {
  const response = await fetch(`${apiUrl ?? ''}/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Monitoring API returned ${response.status}`);
  return body;
}

export const monitoringApi = {
  demoMode,
  listDevices: (token) => request('/devices', token),
  readings: (token, deviceId, hours) => request(`/devices/${encodeURIComponent(deviceId)}/readings?hours=${hours}`, token),
  events: (token, deviceId) => request(`/devices/${encodeURIComponent(deviceId)}/events`, token),
  registerDevice: (token, device) => request('/devices', token, { method: 'POST', body: JSON.stringify(device) }),
  connect: (token) => io(apiUrl, {
    auth: token ? { token } : {},
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  }),
};
