import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { monitoringApi } from '../services/monitoringApi.js';
import { supabase } from '../lib/supabase';

const ranges = [{ label: '1 hour', hours: 1 }, { label: '24 hours', hours: 24 }, { label: '7 days', hours: 168 }];
const formatTime = (value) => value ? new Date(value).toLocaleString() : 'No data received yet';

function TrendChart({ readings }) {
  const points = useMemo(() => readings.map((reading, index) => {
    const x = readings.length < 2 ? 200 : (index / (readings.length - 1)) * 400;
    return {
      x,
      temperature: reading.temperature == null ? null : 140 - ((reading.temperature + 20) / 80) * 125,
      humidity: reading.humidity == null ? null : 140 - (reading.humidity / 100) * 125,
    };
  }), [readings]);
  const pathFor = (key) => points.filter((point) => point[key] !== null)
    .map((point, index) => `${index ? 'L' : 'M'}${point.x},${point[key]}`).join(' ');

  if (!readings.length) return <div className="monitor-empty-chart">No readings in this time range.</div>;
  return <svg className="monitor-chart" viewBox="0 0 400 150" role="img" aria-label="Historical temperature and humidity chart">
    {[25, 65, 105, 145].map((y) => <line key={y} x1="0" x2="400" y1={y} y2={y} className="monitor-gridline" />)}
    <path d={pathFor('temperature')} className="monitor-temp-line" />
    <path d={pathFor('humidity')} className="monitor-humidity-line" />
  </svg>;
}

export default function MonitoringDashboard() {
  const [token, setToken] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [devices, setDevices] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [readings, setReadings] = useState([]);
  const [events, setEvents] = useState([]);
  const [range, setRange] = useState(24);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('connecting');
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [registration, setRegistration] = useState(null);
  const [credentials, setCredentials] = useState({ email: '', password: '' });
  const [signingIn, setSigningIn] = useState(false);
  const [form, setForm] = useState({ device_id: '', device_name: '' });
  const selectedIdRef = useRef(selectedId);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const updateDevice = useCallback((deviceId, update) => {
    setDevices((current) => current.map((device) => device.device_id === deviceId ? { ...device, ...update } : device));
  }, []);

  const loadDevices = useCallback(async (accessToken) => {
    const result = await monitoringApi.listDevices(accessToken);
    setDevices(result.devices);
    setSelectedId((current) => current && result.devices.some((device) => device.device_id === current)
      ? current
      : result.devices[0]?.device_id ?? '');
    setError('');
  }, []);

  useEffect(() => {
    let active = true;
    let socket;
    let authSubscription;

    const connect = async (accessToken) => {
      if (!active) return;
      setToken(accessToken);
      setAuthReady(true);
      if (!accessToken && !monitoringApi.demoMode) {
        setError('Sign in with a Supabase account to view registered devices.');
        setLoading(false);
        return;
      }

      try {
        await loadDevices(accessToken);
        if (!active) return;
        socket?.disconnect();
        socket = monitoringApi.connect(accessToken);
        socket.on('connect', () => { if (active) setConnection('connected'); });
        socket.on('disconnect', () => { if (active) setConnection('reconnecting'); });
        socket.on('connect_error', (socketError) => {
          if (active) {
            setConnection('reconnecting');
            setError(socketError.message || 'Real-time connection failed.');
          }
        });
        socket.on('telemetry', ({ deviceId, reading }) => {
          if (!active) return;
          updateDevice(deviceId, { status: 'online', last_seen: reading.received_at });
          setReadings((current) => deviceId === selectedIdRef.current
            ? [...current, reading].slice(-1000)
            : current);
        });
        socket.on('device:status', ({ deviceId, status, timestamp }) => {
          if (!active) return;
          updateDevice(deviceId, { status, ...(status === 'online' ? { last_seen: timestamp } : {}) });
          setEvents((current) => deviceId === selectedIdRef.current
            ? [{ event_type: status, description: `Device reported ${status}`, occurred_at: timestamp }, ...current].slice(0, 100)
            : current);
        });
        socket.on('device:event', (event) => {
          if (active && event.deviceId === selectedIdRef.current) {
            setEvents((current) => [event, ...current].slice(0, 100));
          }
        });
      } catch (loadError) {
        if (active) setError(loadError.message);
      } finally {
        if (active) setLoading(false);
      }
    };

    const start = async () => {
      if (supabase) {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          if (active) {
            setError(sessionError.message);
            setAuthReady(true);
            setLoading(false);
          }
          return;
        }
        if (active) {
          authSubscription = supabase.auth.onAuthStateChange((_event, session) => {
            void connect(session?.access_token ?? null);
          }).data.subscription;
        }
        await connect(data.session?.access_token ?? null);
      } else {
        await connect(null);
      }
    };
    void start();

    return () => {
      active = false;
      authSubscription?.unsubscribe();
      socket?.disconnect();
    };
  }, [loadDevices, updateDevice]);

  useEffect(() => {
    if (!selectedId || !authReady || (!token && !monitoringApi.demoMode)) {
      setReadings([]);
      setEvents([]);
      return;
    }
    let active = true;
    setReadings([]);
    setEvents([]);
    Promise.all([
      monitoringApi.readings(token, selectedId, range),
      monitoringApi.events(token, selectedId),
    ]).then(([readingResult, eventResult]) => {
      if (!active) return;
      setReadings(readingResult.readings);
      setEvents(eventResult.events);
      setError('');
    }).catch((loadError) => {
      if (active) setError(loadError.message);
    });
    return () => { active = false; };
  }, [authReady, range, selectedId, token]);

  const selected = devices.find((device) => device.device_id === selectedId);
  const latest = readings.at(-1);
  const canRegister = Boolean(token);

  async function submitRegistration(event) {
    event.preventDefault();
    setRegistering(true);
    setError('');
    setRegistration(null);
    try {
      const result = await monitoringApi.registerDevice(token, form);
      setRegistration(result);
      setForm({ device_id: '', device_name: '' });
      await loadDevices(token);
      setSelectedId(result.device.device_id);
    } catch (registerError) {
      setError(registerError.message);
    } finally {
      setRegistering(false);
    }
  }

  async function submitSignIn(event) {
    event.preventDefault();
    if (!supabase) {
      setError('Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before signing in.');
      return;
    }
    setSigningIn(true);
    setError('');
    const { error: signInError } = await supabase.auth.signInWithPassword(credentials);
    if (signInError) setError(signInError.message);
    setSigningIn(false);
  }

  async function signInGoogle() {
    if (!supabase) {
      setError('Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before signing in.');
      return;
    }
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/#monitoring` },
    });
    if (signInError) setError(signInError.message);
  }

  return <div className="monitor-dashboard">
    <header className="monitor-heading">
      <div>
        <div className="eyebrow">IoT device monitoring</div>
        <h2>Live Monitoring</h2>
        <p className="mut">Live sensor telemetry, device health, and historical readings.</p>
      </div>
      <span className={`monitor-connection ${connection}`}>
        <i /> {connection === 'connected' ? 'Live connection' : connection === 'connecting' ? 'Connecting' : 'Reconnecting'}
      </span>
    </header>

    {monitoringApi.demoMode && !token && <div className="monitor-notice">Development simulator view — simulated readings only. This mode is disabled in production.</div>}
    {error && <div className="monitor-notice monitor-error" role="alert">{error}</div>}
    {!token && !monitoringApi.demoMode && <form className="monitor-sign-in card" onSubmit={submitSignIn}>
      <h3>Sign in to monitor your devices</h3>
      <input type="email" autoComplete="email" aria-label="Email" placeholder="Email"
        value={credentials.email} onChange={(event) => setCredentials({ ...credentials, email: event.target.value })} required />
      <input type="password" autoComplete="current-password" aria-label="Password" placeholder="Password"
        value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} required />
      <button className="btn p" disabled={signingIn}>{signingIn ? 'Signing in…' : 'Sign in'}</button>
      <button className="btn" type="button" onClick={signInGoogle}>Continue with Google</button>
    </form>}

    {canRegister && <details className="monitor-register">
      <summary>Register a device</summary>
      <form onSubmit={submitRegistration}>
        <input aria-label="Device ID" placeholder="Device ID, e.g. ESP32_001" value={form.device_id}
          onChange={(event) => setForm({ ...form, device_id: event.target.value })} required />
        <input aria-label="Device name" placeholder="Device name" value={form.device_name}
          onChange={(event) => setForm({ ...form, device_name: event.target.value })} required maxLength={100} />
        <button className="btn p" disabled={registering}>{registering ? 'Registering…' : 'Register'}</button>
      </form>
    </details>}

    {registration && <div className="monitor-credentials" role="status">
      <b>Save the device MQTT password now; it is shown only once.</b>
      <code>username: {registration.mqtt.username}</code>
      <code>password: {registration.mqtt.password}</code>
      <small>{registration.brokerSetupMessage}</small>
      <button className="btn" onClick={() => setRegistration(null)}>Dismiss</button>
    </div>}

    {loading ? <div className="monitor-state">Loading registered devices…</div> : devices.length === 0
      ? <div className="monitor-state"><h3>No devices registered</h3><p>Register an ESP32 or enable the development simulator in the backend.</p></div>
      : <>
        <div className="monitor-toolbar">
          <label>Device
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {devices.map((device) => <option key={device.device_id} value={device.device_id}>
                {device.device_name} ({device.device_id}){device.is_simulated ? ' — simulated' : ''}
              </option>)}
            </select>
          </label>
          <label>History
            <select value={range} onChange={(event) => setRange(Number(event.target.value))}>
              {ranges.map((item) => <option key={item.hours} value={item.hours}>{item.label}</option>)}
            </select>
          </label>
        </div>

        {selected && <>
          {selected.status !== 'online' && <div className="monitor-notice monitor-error" role="status">
            {selected.device_name} is offline. The dashboard will update automatically when it reconnects.
          </div>}
          <div className="monitor-summary">
            <article className="card monitor-device">
              <span className={`monitor-status ${selected.status}`}>{selected.status}</span>
              <h3>{selected.device_name}</h3>
              <code>{selected.device_id}</code>
              {selected.is_simulated && <span className="demo">SIMULATED DEVICE</span>}
              {latest?.simulated && !selected.is_simulated && <span className="demo">SIMULATED SENSOR DATA</span>}
              <dl><dt>Connection</dt><dd>{connection}</dd><dt>Last received</dt><dd>{formatTime(selected.last_seen)}</dd></dl>
            </article>
            <div className="monitor-readings">
              <article className="card"><small>TEMPERATURE</small><b>{latest?.temperature == null ? '—' : `${latest.temperature} °C`}</b></article>
              <article className="card"><small>HUMIDITY</small><b>{latest?.humidity == null ? '—' : `${latest.humidity} %`}</b></article>
              {Object.entries(latest?.additional_sensors ?? {})
                .filter(([name]) => name !== 'temperature' && name !== 'humidity')
                .map(([name, value]) => <article className="card" key={name}><small>{name.replaceAll('_', ' ').toUpperCase()}</small><b>{value ?? '—'}</b></article>)}
            </div>
          </div>

          <article className="card monitor-history">
            <div className="monitor-card-heading"><div><h3>Sensor history</h3><small className="mut">Live updates with saved history · {readings.length} readings</small></div>
              <span className="monitor-legend"><i className="temp" /> Temperature <i className="humidity" /> Humidity</span>
            </div>
            <TrendChart readings={readings} />
            {readings.length > 0 && <div className="monitor-time-range"><span>{formatTime(readings[0].recorded_at)}</span><span>{formatTime(readings.at(-1).recorded_at)}</span></div>}
          </article>

          <div className="monitor-lower">
            <article className="card"><h3>Recent readings</h3>
              <div className="monitor-table-scroll"><table><thead><tr><th>Recorded</th><th>Temperature</th><th>Humidity</th><th>Other sensors</th></tr></thead>
                <tbody>{[...readings].reverse().slice(0, 12).map((reading) => <tr key={reading.id ?? reading.recorded_at}>
                  <td>{formatTime(reading.recorded_at)}</td><td>{reading.temperature ?? '—'}</td><td>{reading.humidity ?? '—'}</td>
                  <td>{Object.entries(reading.additional_sensors ?? {}).filter(([name]) => !['temperature', 'humidity'].includes(name))
                    .map(([name, value]) => `${name}: ${value ?? '—'}`).join(', ') || '—'}</td>
                </tr>)}</tbody>
              </table></div>
            </article>
            <article className="card"><h3>Device activity</h3>
              {events.length ? <ul className="monitor-events">{events.slice(0, 10).map((event, index) => <li key={event.id ?? `${event.event_type}-${event.occurred_at}-${index}`}>
                <span className={`monitor-event-dot ${event.event_type}`} />
                <div><b>{event.description}</b><small>{formatTime(event.occurred_at)}</small></div>
              </li>)}</ul> : <p className="mut monitor-no-events">No activity events recorded.</p>}
            </article>
          </div>
        </>}
      </>}
  </div>;
}
