// Deploy: supabase functions deploy ingest-reading --no-verify-jwt
// ESP32 sends POST with headers x-device-id and x-device-key (HTTPS only).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const sha256 = async (s: string) => {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : null)

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  const code = req.headers.get('x-device-id'), key = req.headers.get('x-device-key')
  if (!code || !key) return new Response('Unauthorized', { status: 401 })

  const { data: dev } = await db.from('devices').select('id,key_hash').eq('device_code', code).maybeSingle()
  if (!dev || dev.key_hash !== (await sha256(key))) return new Response('Unauthorized', { status: 401 })

  const b = await req.json().catch(() => ({}))
  const t = num(b.temperature, -60, 125), h = num(b.humidity, 0, 100), s = num(b.shock, 0, 50), v = num(b.vibration, 0, 50)
  if (t === null && h === null && s === null && v === null) return new Response('Invalid payload', { status: 400 })

  await db.from('devices').update({ last_seen: new Date().toISOString() }).eq('id', dev.id)

  const { data: sh } = await db.from('shipments').select('id, products(category)')
    .eq('device_id', dev.id).eq('status', 'in_transit').maybeSingle()
  if (!sh) return Response.json({ ok: true, stored: false })

  await db.from('sensor_readings').insert({
    shipment_id: sh.id, device_id: dev.id, temperature: t, humidity: h, shock: s, vibration: v,
    lat: num(b.lat, -90, 90), lng: num(b.lng, -180, 180),
  })

  // Compare against the product's reference dataset
  const category = (sh as any).products?.category
  const { data: ref } = await db.from('reference_datasets').select('*').eq('category', category).maybeSingle()
  let severity: 'safe' | 'warning' | 'critical' = 'safe'
  const msgs: string[] = []
  if (ref) {
    if (t !== null && ((ref.temp_max != null && t > ref.temp_max) || (ref.temp_min != null && t < ref.temp_min))) {
      severity = 'warning'; msgs.push(`Temperature ${t} C outside configured range`)
    }
    if (h !== null && ref.humidity_max != null && h > ref.humidity_max) {
      severity = 'warning'; msgs.push(`Humidity ${h}% above configured limit`)
    }
    if (s !== null && ref.shock_max != null && s > ref.shock_max) {
      severity = 'critical'; msgs.push(`Shock ${s} g above configured limit`)
    }
  }
  if (msgs.length) {
    await db.from('alerts').insert({ shipment_id: sh.id, kind: 'condition', severity, message: msgs.join('; ') })
    const q = db.from('shipments').update({ condition: severity }).eq('id', sh.id)
    await (severity === 'warning' ? q.eq('condition', 'safe') : q) // never downgrade critical
  }
  return Response.json({ ok: true, severity })
})
