import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { AppRol, EstadoHidrante, Hidrante, TipoHidrante } from '../lib/types'
import { MapaHidrantes, MiniMapa } from './Mapa'
import {
  ANTIGUEDAD_MAX_MS, COLOR_ESTADO, ESTADOS, PRECISION_MAX, TIPOS,
  aCSV, aKML, achicarFoto, comoLlegar, descargar, fechaCorta, leerPlanilla, type ResultadoLectura,
} from './util'

export type Vista = 'cargar' | 'mapa' | 'mias'

export default function HidraMap({ vista, rol, go }: { vista: Vista; rol: AppRol; go: (page: string) => void }) {
  const tabs: { id: Vista; label: string; page: string }[] = [
    { id: 'cargar', label: 'Cargar', page: 'hidramap' },
    { id: 'mapa', label: 'Mapa', page: 'hidramap-mapa' },
    { id: 'mias', label: 'Mis cargas', page: 'hidramap-mias' },
  ]
  return (
    <div className="hm">
      <header className="hm-top">
        <div>
          <p className="small hm-kicker">Bomberos Voluntarios de Morón</p>
          <h1>HidraMap</h1>
        </div>
        <nav className="top-links">
          <button className="link small" onClick={() => go('')}>Inicio</button>
          <button className="link small" onClick={() => api.signOut()}>Salir</button>
        </nav>
      </header>
      <nav className="hm-tabs" aria-label="Secciones de HidraMap">
        {tabs.map((t) => (
          <button key={t.id} aria-current={vista === t.id ? 'page' : undefined} onClick={() => go(t.page)}>
            {t.label}
          </button>
        ))}
      </nav>
      {vista === 'cargar' && <Cargar onVerMias={() => go('hidramap-mias')} />}
      {vista === 'mapa' && <VerMapa admin={rol === 'admin'} />}
      {vista === 'mias' && <MisCargas onCargar={() => go('hidramap')} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cargar un hidrante
// ---------------------------------------------------------------------------
interface Fix {
  lat: number
  lng: number
  precision: number
  t: number
}

function useGPS() {
  const [fix, setFix] = useState<Fix | null>(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setError('Este celular no tiene GPS disponible en el navegador.')
      return
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError('')
        setFix({ lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy, t: p.timestamp || Date.now() })
      },
      (e) =>
        setError(
          e.code === e.PERMISSION_DENIED
            ? 'Sin permiso para usar la ubicación. Activalo en la configuración del navegador para este sitio.'
            : 'No se pudo obtener la ubicación. Revisá que el GPS esté prendido.',
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    )
    const tick = setInterval(() => setNow(Date.now()), 1000)
    // Se apaga el GPS al salir de la pantalla
    return () => {
      navigator.geolocation.clearWatch(id)
      clearInterval(tick)
    }
  }, [])

  const viejo = fix ? now - fix.t > ANTIGUEDAD_MAX_MS : false
  const listo = !!fix && fix.precision <= PRECISION_MAX && !viejo
  return { fix, error, viejo, listo }
}

function Cargar({ onVerMias }: { onVerMias: () => void }) {
  const { fix, error: gpsError, viejo, listo } = useGPS()
  const [tipo, setTipo] = useState<TipoHidrante | null>(null)
  const [estado, setEstado] = useState<EstadoHidrante | null>(null)
  const [foto, setFoto] = useState<Blob | null>(null)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [procesando, setProcesando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [hecho, setHecho] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const enviando = useRef(false)

  useEffect(() => () => { if (fotoUrl) URL.revokeObjectURL(fotoUrl) }, [fotoUrl])

  async function elegirFoto(f: File | undefined) {
    if (!f) return
    setProcesando(true)
    setError('')
    try {
      const b = await achicarFoto(f)
      setFoto(b)
      setFotoUrl(URL.createObjectURL(b))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setProcesando(false)
      if (input.current) input.current.value = ''
    }
  }

  const faltan = [!listo && 'ubicación GPS precisa', !tipo && 'tipo', !estado && 'estado', !foto && 'foto'].filter(Boolean) as string[]

  async function guardar() {
    if (enviando.current || faltan.length || !fix || !tipo || !estado || !foto) return
    enviando.current = true // evita el doble envío
    setGuardando(true)
    setError('')
    try {
      const id = await api.guardarHidrante({
        lat: fix.lat, lng: fix.lng, precision: fix.precision, lectura: new Date(fix.t).toISOString(), tipo, estado, foto,
      })
      setHecho(id)
      setTipo(null)
      setEstado(null)
      setFoto(null)
      setFotoUrl(null)
      window.scrollTo(0, 0)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGuardando(false)
      enviando.current = false
    }
  }

  if (hecho)
    return (
      <section className="hm-done">
        <span className="hm-check" aria-hidden="true">✓</span>
        <h2>Hidrante guardado</h2>
        <p className="muted">Código {hecho}. Quedó firmado con tu nombre y la hora.</p>
        <button className="btn primary wide" onClick={() => setHecho(null)}>Cargar otro hidrante</button>
        <button className="link" onClick={onVerMias}>Ver mis cargas</button>
      </section>
    )

  const gpsClase = gpsError ? 'err' : !fix ? 'wait' : listo ? 'ok' : 'warn'
  return (
    <section className="hm-form">
      <div className={`hm-gps ${gpsClase}`} aria-live="polite">
        <MiniMapa lat={fix?.lat ?? null} lng={fix?.lng ?? null} precision={fix?.precision ?? null} />
        <p className="hm-gps-state">
          {gpsError ? gpsError
            : !fix ? 'Buscando señal GPS…'
            : viejo ? 'La ubicación quedó vieja. Esperá a que se actualice.'
            : listo ? <>Ubicación lista, <strong>±{Math.round(fix.precision)} m</strong></>
            : <>Precisión <strong>±{Math.round(fix.precision)} m</strong>. Hace falta ±{PRECISION_MAX} m o mejor: esperá unos segundos al aire libre.</>}
        </p>
      </div>

      <fieldset className="hm-field">
        <legend>Tipo</legend>
        <div className="hm-opts two">
          {TIPOS.map((t) => (
            <button key={t} type="button" aria-pressed={tipo === t} onClick={() => setTipo(t)}>{t}</button>
          ))}
        </div>
      </fieldset>

      <fieldset className="hm-field">
        <legend>Estado</legend>
        <div className="hm-opts">
          {ESTADOS.map((e) => (
            <button key={e} type="button" aria-pressed={estado === e} style={{ ['--c' as string]: COLOR_ESTADO[e] }} onClick={() => setEstado(e)}>
              <span className="dot" style={{ background: COLOR_ESTADO[e] }} aria-hidden="true" />
              {e}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="hm-field">
        <legend>Foto</legend>
        <input
          ref={input}
          id="hm-foto"
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => elegirFoto(e.target.files?.[0])}
        />
        {fotoUrl ? (
          <div className="hm-foto">
            <img src={fotoUrl} alt="Foto del hidrante" />
            <button type="button" className="btn" onClick={() => input.current?.click()}>Sacar otra</button>
          </div>
        ) : (
          <button type="button" className="hm-camara" onClick={() => input.current?.click()} disabled={procesando}>
            {procesando ? 'Procesando la foto…' : 'Sacar foto'}
          </button>
        )}
      </fieldset>

      {error && <p className="msg error" role="alert">{error}</p>}
      <div className="hm-save">
        <button className="btn primary wide" disabled={faltan.length > 0 || guardando} onClick={guardar}>
          {guardando ? 'Guardando…' : 'Guardar hidrante'}
        </button>
        {faltan.length > 0 && <p className="muted small">Falta: {faltan.join(', ')}.</p>}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Datos compartidos por Mapa y Mis cargas
// ---------------------------------------------------------------------------
function useHidrantes() {
  const [items, setItems] = useState<Hidrante[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try {
      setItems(await api.listHidrantes())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])
  return { items, error, reload: load }
}

function Ficha({ h, onClose }: { h: Hidrante; onClose: () => void }) {
  return (
    <article className="hm-ficha">
      <header>
        <h2>
          <span className="dot" style={{ background: COLOR_ESTADO[h.estado] }} aria-hidden="true" /> Hidrante {h.tipo}, {h.estado.toLowerCase()}
        </h2>
        <button className="link" onClick={onClose}>Cerrar</button>
      </header>
      {h.foto ? (
        <a href={h.foto} target="_blank" rel="noreferrer"><img src={h.foto} alt={`Foto del hidrante ${h.id}`} loading="lazy" /></a>
      ) : (
        <p className="muted small">Sin foto disponible.</p>
      )}
      <dl className="user-facts">
        <dt>Cargado</dt><dd>{fechaCorta(h.created_at)}{h.cargado_por_nombre ? `, por ${h.cargado_por_nombre}` : ''}</dd>
        <dt>Precisión</dt><dd>{h.precision_m != null ? `±${h.precision_m} m` : 'Sin dato'}</dd>
        <dt>Código</dt><dd className="sel-all">{h.id}</dd>
      </dl>
      <a className="btn wide" href={comoLlegar(h)} target="_blank" rel="noreferrer">Cómo llegar</a>
    </article>
  )
}

// ---------------------------------------------------------------------------
// Mapa
// ---------------------------------------------------------------------------
function VerMapa({ admin }: { admin: boolean }) {
  const { items, error, reload } = useHidrantes()
  const [estados, setEstados] = useState<EstadoHidrante[]>(ESTADOS)
  const [tipo, setTipo] = useState<TipoHidrante | 'todos'>('todos')
  const [sel, setSel] = useState<Hidrante | null>(null)

  const visibles = useMemo(
    () => (items ?? []).filter((h) => estados.includes(h.estado) && (tipo === 'todos' || h.tipo === tipo)),
    [items, estados, tipo],
  )
  const onSelect = useCallback((h: Hidrante) => setSel(h), [])
  const toggle = (e: EstadoHidrante) => setEstados((p) => (p.includes(e) ? p.filter((x) => x !== e) : [...p, e]))

  return (
    <section className="hm-mapa">
      <div className="hm-filtros">
        <div className="chips" role="group" aria-label="Estado">
          {ESTADOS.map((e) => (
            <button key={e} className="chip" aria-pressed={estados.includes(e)} onClick={() => toggle(e)}>
              <span className="dot" style={{ background: COLOR_ESTADO[e] }} aria-hidden="true" /> {e} ({(items ?? []).filter((h) => h.estado === e).length})
            </button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Tipo">
          {(['todos', ...TIPOS] as const).map((t) => (
            <button key={t} className="chip" aria-pressed={tipo === t} onClick={() => setTipo(t)}>{t === 'todos' ? 'Todos los tipos' : `Tipo ${t}`}</button>
          ))}
        </div>
      </div>
      {error && <p className="msg error">{error}</p>}
      <div className="hm-map-wrap">
        <MapaHidrantes items={visibles} onSelect={onSelect} foco={sel} />
        {!items && !error && <p className="hm-map-msg">Cargando hidrantes…</p>}
      </div>
      <p className="muted small">{items ? `${visibles.length} de ${items.length} hidrantes en el mapa. Tocá uno para ver la foto y los datos.` : ''}</p>
      {sel && <Ficha h={sel} onClose={() => setSel(null)} />}
      {admin && items && <Admin items={items} visibles={visibles} onImportado={reload} />}
    </section>
  )
}

function Admin({ items, visibles, onImportado }: { items: Hidrante[]; visibles: Hidrante[]; onImportado: () => void }) {
  const [lectura, setLectura] = useState<ResultadoLectura | null>(null)
  const [nombre, setNombre] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const hoy = new Date().toISOString().slice(0, 10)

  async function leer(f: File | undefined) {
    if (!f) return
    setMsg(null)
    setNombre(f.name)
    setLectura(leerPlanilla(await f.text()))
  }
  async function importar() {
    if (!lectura?.filas.length) return
    setBusy(true)
    try {
      const n = await api.importarHidrantes(lectura.filas)
      const rep = lectura.filas.length - n
      const yaEstaban = rep === 1 ? ' 1 ya estaba cargado y se salteó.' : rep > 1 ? ` ${rep} ya estaban cargados y se saltearon.` : ''
      setMsg({ ok: true, text: `${n === 1 ? 'Se importó 1 hidrante.' : `Se importaron ${n} hidrantes.`}${yaEstaban}` })
      setLectura(null)
      onImportado()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="hm-admin">
      <h2>Administración de HidraMap</h2>
      <div className="hm-admin-block">
        <h3>Exportar</h3>
        <p className="muted small">
          Se exportan los {visibles.length} hidrantes que se ven con los filtros actuales. El archivo KML se importa en Google My Maps para actualizar el mapa público.
        </p>
        <div className="hm-admin-actions">
          <button className="btn" disabled={!visibles.length} onClick={() => descargar(`hidrantes-${hoy}.kml`, aKML(visibles), 'application/vnd.google-earth.kml+xml')}>Descargar KML</button>
          <button className="btn" disabled={!visibles.length} onClick={() => descargar(`hidrantes-${hoy}.csv`, aCSV(visibles), 'text/csv;charset=utf-8')}>Descargar planilla (CSV)</button>
        </div>
      </div>
      <div className="hm-admin-block">
        <h3>Importar el historial</h3>
        <p className="muted small">
          En la planilla "BDD HidraMap BVM", abrí la hoja Hidrantes y elegí Archivo, Descargar, Valores separados por comas (.csv). Después elegí ese archivo acá.
          Los hidrantes que ya estén cargados (mismo código) no se duplican. Hoy hay {items.length} en la plataforma.
        </p>
        <label className="btn file-btn">
          Elegir archivo CSV
          <input id="hm-csv" type="file" accept=".csv,text/csv" hidden onChange={(e) => leer(e.target.files?.[0])} />
        </label>
        {lectura && (
          <div className="hm-preview">
            <p>
              <strong>{nombre}</strong>: {lectura.filas.length} hidrantes listos para importar
              {lectura.problemas.length ? `, ${lectura.problemas.length} filas con problemas que se van a saltear` : ''}.
            </p>
            {lectura.problemas.length > 0 && (
              <details>
                <summary>Ver filas con problemas</summary>
                <ul>{lectura.problemas.slice(0, 50).map((p) => <li key={p}>{p}</li>)}</ul>
              </details>
            )}
            <button className="btn primary" disabled={busy || !lectura.filas.length} onClick={importar}>
              {busy ? 'Importando…' : `Importar ${lectura.filas.length} hidrantes`}
            </button>
          </div>
        )}
        {msg && <p className={`msg ${msg.ok ? 'ok' : 'error'}`} role="status">{msg.text}</p>}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Mis cargas
// ---------------------------------------------------------------------------
function MisCargas({ onCargar }: { onCargar: () => void }) {
  const { items, error } = useHidrantes()
  const mias = useMemo(() => (items ?? []).filter((h) => h.mio), [items])
  const [sel, setSel] = useState<Hidrante | null>(null)

  if (error) return <p className="msg error">{error}</p>
  if (!items) return <p className="muted">Cargando…</p>
  if (!mias.length)
    return (
      <section className="empty">
        <h2>Todavía no cargaste hidrantes</h2>
        <p className="muted">Cuando cargues uno, lo vas a ver acá con su foto.</p>
        <button className="btn primary" onClick={onCargar}>Cargar el primero</button>
      </section>
    )
  return (
    <section>
      <p className="muted small">{mias.length === 1 ? 'Cargaste 1 hidrante.' : `Cargaste ${mias.length} hidrantes.`} Para corregir una carga, avisale a un administrador.</p>
      <ul className="hm-list">
        {mias.map((h) => (
          <li key={h.id}>
            <button onClick={() => setSel(h)}>
              {h.foto ? <img src={h.foto} alt="" loading="lazy" /> : <span className="hm-nofoto" aria-hidden="true" />}
              <span>
                <strong>Tipo {h.tipo}</strong>
                <span className="hm-estado"><span className="dot" style={{ background: COLOR_ESTADO[h.estado] }} aria-hidden="true" /> {h.estado}</span>
                <span className="muted small">{fechaCorta(h.created_at)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {sel && <Ficha h={sel} onClose={() => setSel(null)} />}
    </section>
  )
}
