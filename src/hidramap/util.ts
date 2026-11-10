import type { EstadoHidrante, FilaImportada, Hidrante, TipoHidrante } from '../lib/types'

export const TIPOS: TipoHidrante[] = ['63', '114']
export const ESTADOS: EstadoHidrante[] = ['Operativo', 'No operativo', 'No se encuentra']
export const COLOR_ESTADO: Record<EstadoHidrante, string> = {
  Operativo: '#2e7d32',
  'No operativo': '#ef6c00',
  'No se encuentra': '#757575',
}
export const PRECISION_MAX = 30 // metros
export const ANTIGUEDAD_MAX_MS = 2 * 60_000 // el celular acepta lecturas de hasta 2 minutos

export const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export const comoLlegar = (h: { lat: number; lng: number }) => `https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`

/** Achica la foto a 1280 px de lado mayor y la pasa a JPEG con calidad 0,72 (como la app anterior) */
export async function achicarFoto(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions).catch(() => null)
  const src: CanvasImageSource & { width: number; height: number } =
    bmp ??
    (await new Promise<HTMLImageElement>((ok, bad) => {
      const img = new Image()
      img.onload = () => ok(img)
      img.onerror = () => bad(new Error('No se pudo leer la foto'))
      img.src = URL.createObjectURL(file)
    }))
  const max = 1280
  const k = Math.min(1, max / Math.max(src.width, src.height))
  const w = Math.round(src.width * k)
  const h = Math.round(src.height * k)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(src, 0, 0, w, h)
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.72))
  if (!blob) throw new Error('No se pudo procesar la foto')
  if (blob.size > 8 * 1024 * 1024) throw new Error('La foto es demasiado pesada')
  return blob
}

// ---------------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------------
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function aCSV(hs: Hidrante[]): string {
  const head = ['ID_Hidrante', 'Latitud', 'Longitud', 'Tipo', 'Estado', 'Fecha_Carga', 'Cargado_por', 'Precision_GPS', 'Foto']
  const rows = hs.map((h) => [h.id, h.lat, h.lng, h.tipo, h.estado, fechaCorta(h.created_at), h.cargado_por_nombre ?? '', h.precision_m ?? '', h.foto ?? ''])
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** KML para importar en Google My Maps (reemplaza la actualización manual del mapa público) */
export function aKML(hs: Hidrante[]): string {
  const kmlColor = (hex: string) => 'ff' + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3) // aabbggrr
  const styles = ESTADOS.map(
    (e, i) => `<Style id="e${i}"><IconStyle><color>${kmlColor(COLOR_ESTADO[e])}</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>`,
  ).join('')
  const marks = hs
    .map((h) => {
      const desc = [`Tipo: ${h.tipo}`, `Estado: ${h.estado}`, `Fecha: ${fechaCorta(h.created_at)}`, h.cargado_por_nombre ? `Cargó: ${h.cargado_por_nombre}` : '', h.foto ? `Foto: ${h.foto}` : '']
        .filter(Boolean)
        .join('<br/>')
      return `<Placemark><name>${xml(`Hidrante ${h.tipo} · ${h.estado}`)}</name><description><![CDATA[${desc}]]></description><styleUrl>#e${ESTADOS.indexOf(h.estado)}</styleUrl><Point><coordinates>${h.lng},${h.lat},0</coordinates></Point></Placemark>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Hidrantes Bomberos Morón</name>${styles}\n${marks}\n</Document></kml>`
}

export function descargar(nombre: string, contenido: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// ---------------------------------------------------------------------------
// Importar la planilla "BDD HidraMap BVM" (hoja Hidrantes descargada como CSV)
// ---------------------------------------------------------------------------
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  const t = text.replace(/^﻿/, '')
  const sep = (t.split('\n')[0].match(/;/g)?.length ?? 0) > (t.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === sep) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Fecha de la planilla: "1/5/2025 10:00:00" (día/mes/año, hora de Argentina) o ISO */
function fecha(s: string): string | null {
  const v = s.trim()
  if (!v) return null
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) {
    const [, d, mo, y, h = '0', mi = '0', se = '0'] = m
    const p = (n: string) => n.padStart(2, '0')
    return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(se)}-03:00`
  }
  const iso = Date.parse(v)
  return Number.isNaN(iso) ? null : new Date(iso).toISOString()
}

export interface ResultadoLectura {
  filas: FilaImportada[]
  problemas: string[]
}

export function leerPlanilla(text: string): ResultadoLectura {
  const rows = parseCSV(text)
  if (rows.length < 2) return { filas: [], problemas: ['El archivo está vacío.'] }
  const head = rows[0].map(norm)
  const col = (...names: string[]) => head.findIndex((h) => names.map(norm).includes(h))
  const cId = col('ID_Hidrante', 'id')
  const cUb = col('Ubicación', 'Ubicacion')
  const cLat = col('Latitud', 'lat')
  const cLng = col('Longitud', 'lng', 'lon')
  const cTipo = col('Tipo')
  const cEst = col('Estado')
  const cFecha = col('Fecha_Carga', 'Fecha')
  const cPor = col('Cargado_por', 'Cargado por')
  const cImg = col('URL_Imagen')
  const cFoto = col('Foto')
  const cPrec = col('Precision_GPS', 'Precision')
  if (cTipo < 0 || cEst < 0 || (cUb < 0 && (cLat < 0 || cLng < 0)))
    return { filas: [], problemas: ['No encuentro las columnas Ubicación, Tipo y Estado. ¿Es la hoja "Hidrantes" descargada como CSV?'] }

  const filas: FilaImportada[] = []
  const problemas: string[] = []
  rows.slice(1).forEach((r, i) => {
    const n = i + 2
    let lat: number, lng: number
    if (cUb >= 0) {
      const parts = (r[cUb] ?? '').split(/[,;\s]+/).map((x) => parseFloat(x)).filter((x) => !Number.isNaN(x))
      ;[lat, lng] = parts
    } else {
      lat = parseFloat((r[cLat] ?? '').replace(',', '.'))
      lng = parseFloat((r[cLng] ?? '').replace(',', '.'))
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      problemas.push(`Fila ${n}: ubicación inválida`)
      return
    }
    const tipo = String(parseInt(r[cTipo] ?? '', 10)) as TipoHidrante
    if (!TIPOS.includes(tipo)) { problemas.push(`Fila ${n}: tipo "${r[cTipo] ?? ''}" no es 63 ni 114`); return }
    const estado = ESTADOS.find((e) => norm(e) === norm(r[cEst] ?? ''))
    if (!estado) { problemas.push(`Fila ${n}: estado "${r[cEst] ?? ''}" no reconocido`); return }
    const img = cImg >= 0 ? (r[cImg] ?? '').trim() : ''
    const foto = cFoto >= 0 ? (r[cFoto] ?? '').trim() : ''
    filas.push({
      id: cId >= 0 && /^[0-9a-zA-Z_-]{3,40}$/.test((r[cId] ?? '').trim()) ? r[cId].trim() : undefined,
      lat, lng, tipo, estado,
      precision_m: cPrec >= 0 && r[cPrec]?.trim() ? Math.round(parseFloat(r[cPrec])) || null : null,
      foto_url: /^https?:\/\//.test(img) ? img : /^https?:\/\//.test(foto) ? foto : null,
      cargado_por_nombre: cPor >= 0 ? (r[cPor] ?? '').trim() || null : null,
      created_at: cFecha >= 0 ? fecha(r[cFecha] ?? '') : null,
    })
  })
  return { filas, problemas }
}
