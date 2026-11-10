// Supabase Edge Function: enviar-reporte
// Manda por mail el reporte de guardias confirmadas a quien las confirmó.
// Usa Brevo (plan gratis) y no necesita dominio propio: alcanza con verificar
// tu mail como remitente.
//
// Secretos a cargar en Supabase > Edge Functions > Secrets:
//   BREVO_API_KEY     la API key de Brevo
//   REMITENTE_EMAIL   el mail verificado en Brevo desde el que se envía
//   REMITENTE_NOMBRE  (opcional) ej: "Guardias Cuartel Central"
//   COPIA_EMAIL       (opcional) mail del cuartel que recibe copia de cada reporte

import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const fecha = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const s = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // Cliente con la sesión de quien llama: solo puede leer sus propias guardias
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) return json({ error: 'No autenticado' }, 401)

    const { data: perfil } = await supabase.from('profiles').select('nombre, apellido, legajo').eq('id', user.id).maybeSingle()
    const quien = perfil?.apellido ? `${perfil.nombre} ${perfil.apellido} (legajo ${perfil.legajo})` : user.email

    const { data: mes } = await supabase.rpc('target_month')
    const [y, m] = (mes as string).split('-').map(Number)
    const fin = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`

    const { data: guardias, error } = await supabase
      .from('reservations')
      .select('shift_date, shift_type')
      .eq('status', 'confirmed')
      .gte('shift_date', mes)
      .lt('shift_date', fin)
      .order('shift_date')
      .order('shift_type')
    if (error) throw error
    if (!guardias?.length) return json({ error: 'No hay guardias confirmadas' }, 400)

    const nombreMes = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es-AR', { month: 'long', timeZone: 'UTC' })
    const filas = guardias
      .map((g) => `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #d6dce5">${fecha(g.shift_date)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #d6dce5;color:${g.shift_type === 'dia' ? '#9a6a00' : '#3b4a9c'}">
          ${g.shift_type === 'dia' ? 'Diurna' : 'Nocturna'}</td></tr>`)
      .join('')

    const html = `<div style="font-family:Arial,sans-serif;color:#15233b;max-width:520px">
      <h2 style="margin:0 0 6px">Tus guardias de ${nombreMes}</h2>
      <p style="margin:0 0 16px;color:#5b6779">Confirmadas por ${quien}. Total: ${guardias.length}.</p>
      <table style="border-collapse:collapse;width:100%;border-top:2px solid #15233b">${filas}</table>
      <p style="margin:16px 0 0;font-size:13px;color:#5b6779">Si necesitás un cambio, hablá con la jefatura del cuartel.</p>
    </div>`

    const copia = Deno.env.get('COPIA_EMAIL')
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': Deno.env.get('BREVO_API_KEY')!,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: {
          email: Deno.env.get('REMITENTE_EMAIL'),
          name: Deno.env.get('REMITENTE_NOMBRE') ?? 'Guardias del cuartel',
        },
        to: [{ email: user.email }],
        ...(copia ? { bcc: [{ email: copia }] } : {}),
        subject: `Tus guardias de ${nombreMes} (${guardias.length})`,
        htmlContent: html,
      }),
    })
    if (!res.ok) throw new Error(`Brevo respondió ${res.status}: ${await res.text()}`)

    return json({ ok: true, enviadas: guardias.length })
  } catch (e) {
    console.error(e)
    return json({ error: (e as Error).message }, 500)
  }
})
