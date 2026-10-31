# TRUSTBOX: Supabase database + Google sign-in

## 1. Database
1. Open Supabase, then SQL Editor.
2. You said you already have a schema. Compare `supabase/schema.sql` with it first and merge, do not blindly run both.
3. Run the script. It creates tables, role trigger, RLS policies, realtime and demo reference datasets.
4. Make yourself admin (replace the email):
   `update public.profiles set role='admin', role_chosen=true where email='you@example.com';`

## 2. Google sign-in
1. Google Cloud Console, then APIs and Services, then OAuth consent screen. Configure it.
2. Credentials, then Create credentials, then OAuth client ID, type Web application.
3. Authorized JavaScript origins: `http://localhost:5173` and your production URL.
4. Authorized redirect URI: `https://<PROJECT-REF>.supabase.co/auth/v1/callback`
5. Supabase, then Authentication, then Providers, then Google. Enable it and paste the Client ID and Secret.
6. Supabase, then Authentication, then URL Configuration. Set Site URL to your production URL. Add Redirect URLs:
   `http://localhost:5173/auth/callback`, `https://<your-domain>/auth/callback`, `https://<your-domain>/auth/reset`
7. Email/password: Authentication, then Providers, then Email. Keep "Confirm email" on for email verification. Customize the emails under Authentication, then Email Templates.

## 3. Frontend
```
npm i @supabase/supabase-js react-router-dom
```
`.env`
```
VITE_SUPABASE_URL=https://<PROJECT-REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```
- Create `src/lib/supabase.ts` (two lines are in the header of `AuthProvider.tsx`).
- Wrap the app in `<AuthProvider>`. Guard pages with `<RequireRole allow={['seller']}>`.
- Add routes: `/login`, `/auth/callback` (just render a spinner, the session is picked up automatically), `/auth/reset` (call `supabase.auth.updateUser({password})`), `/choose-role` (call `chooseRole('seller'|'customer')`, needed for new Google users), `/forbidden`.
- Realtime for the live monitor:
```ts
supabase.channel('readings').on('postgres_changes',
  { event: 'INSERT', schema: 'public', table: 'sensor_readings', filter: `shipment_id=eq.${id}` },
  (p) => setReadings((r) => [...r, p.new])).subscribe()
```

## 4. ESP32 ingestion
```
supabase functions deploy ingest-reading --no-verify-jwt
```
Register a device: generate a random key, store only its SHA-256 in `devices.key_hash`, flash the raw key to the ESP32.
ESP32 sends HTTPS POST to `https://<PROJECT-REF>.supabase.co/functions/v1/ingest-reading` with headers `x-device-id`, `x-device-key` and JSON `{"temperature":24.8,"humidity":52.4,"shock":0.3}`.
Readings are only stored while a shipment with that device is `in_transit`.

## Notes
- The service role key lives only in the Edge Function environment. Never ship it to the browser.
- RLS is the real security. `RequireRole` only hides UI.
- The existing demo values in `reference_datasets` are placeholders, set real tolerances per category.
