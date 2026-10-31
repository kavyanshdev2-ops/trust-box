# TRUSTBOX — React conversion

This is the React/Vite version of the supplied TRUSTBOX HTML prototype.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (normally http://localhost:5173).

## Production build

```bash
npm run build
npm run preview
```

## Fidelity note

The supplied `trustbox.html` was preserved as the React-rendered markup, with its original CSS and browser behaviour moved into separate source files. This intentionally keeps the original page copy, layout, colors, sections, navigation, demo data, simulated seller/customer/admin views, charts and Three.js package interaction unchanged. The DOM-driven prototype is mounted once inside the React app so its existing interactions continue to work.

## IoT monitoring (ESP32 + MQTT + Supabase)

The existing shipment schema and original demo flows remain intact. IoT monitoring uses separate `iot_devices`, `iot_sensor_readings`, and `iot_device_events` tables so it does not collide with the existing shipment tables.

### Supabase setup

1. Apply `database/migrations/202610310001_iot_monitoring.sql` to the existing Supabase project after the current `supabase/schema.sql` has been applied. Do not rerun or replace existing tables.
2. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env`. The service-role key is backend-only.
3. Use a signed-in Supabase seller/admin account for registered devices. For local simulator-only viewing, enable `ALLOW_DEMO_READS=true` in development and `VITE_MONITORING_DEMO_MODE=true` in the frontend `.env`; both must be disabled in production.

### Mosquitto setup

Install Mosquitto locally or run it with Docker, then configure it with `backend/mosquitto/mosquitto.conf` and `backend/mosquitto/acl.example` (copy the latter to the broker's `acl` file). Create a broker password file and backend user:

```sh
mosquitto_passwd -c /path/to/mosquitto/passwd trustbox-backend
```

Add the username/password from `MQTT_USERNAME` / `MQTT_PASSWORD` to that password file, then restart Mosquitto. For every registered physical device, add the returned one-time MQTT password with `mosquitto_passwd /path/to/mosquitto/passwd ESP32_001`; the device ID must match its MQTT username so the ACL permits it to publish only to its own telemetry/status topics. MQTT listener 1883 is for isolated development networks only. In production configure broker certificates and the documented 8883 TLS listener, then set `MQTT_URL=mqtts://...` and `MQTT_TLS_REJECT_UNAUTHORIZED=true`.

### Run the application

```sh
npm install
cp .env.example .env
npm run dev

cd backend
npm install
cp .env.example .env
npm run dev
```

Configure the frontend `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as usual. The Vite dev server proxies `/api` and `/socket.io` to the backend on port 3001. `VITE_MONITORING_API_URL` may be set to the deployed backend origin when not using that proxy. Backend setup and simulator configuration are in `backend/.env.example`.

### Simulator and verification

Set `SIMULATOR_ENABLED=true` and comma-separated `SIMULATOR_DEVICE_IDS` in backend `.env` to start multiple MQTT-published simulated devices. The simulator uses the same topic subscription, payload validation, Supabase write, and Socket.IO broadcast pipeline as hardware. It periodically reports offline/online transitions. It is rejected in production mode.

Run backend validation tests with `cd backend && npm test`; verify `/api/health` reports database and MQTT connection as healthy. Apply the migration and start Mosquitto/Supabase to exercise the full end-to-end live flow.

### Firmware

See [esp32/README.md](./esp32/README.md). Hardware is intentionally not assumed: confirm the ESP32 board, sensor models, wiring/I2C addresses, and broker CA certificate before production flashing. Firmware defaults to simulated sensor data; implement its sensor adapter and set `SIMULATED_SENSOR_MODE=0` for real sensors. Physical sensor/GPIO configuration and broker certificates are required manual hardware steps.

The original front-page and shipment demo content remains available at `#demo`; the separate `#monitoring` dashboard shows authenticated real devices or explicitly labeled development simulator devices.

Copy `.env.example` to `.env` and fill in your Supabase URL and anon public key when integrating Supabase. Never put the service-role key in frontend environment variables.
