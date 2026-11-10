import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './lib/api'
import type { CalEntry, Funcion, ShiftType } from './lib/types'
import { dayNumber, key, longDate, monthDays, monthName, shiftName, weekdayIndex } from './lib/dates'
import { MAX_POR_GUARDIA } from './config'

// Filas fijas de cada semana, igual que la planilla de Excel.
// Encargado y ayudante los asigna el administrador; Of. de Semana y Chofer por ahora se completan a mano.
type Kind = 'of' | 'enc' | 'ayte' | 'chofer' | 'pers'
const ROLES: { label: string; cls: string; kind: Kind }[] = [
  { label: 'Of. De Semana', cls: 'r-of', kind: 'of' },
  { label: 'Enc. Guardia', cls: 'r-enc', kind: 'enc' },
  { label: 'Ayte. Guardia', cls: 'r-ayte', kind: 'ayte' },
  { label: 'Chofer', cls: 'r-chofer', kind: 'chofer' },
]
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const TYPES: ShiftType[] = ['dia', 'noche']
const FUNCION_NOMBRE: Record<Funcion, string> = { encargado: 'Encargado', ayudante: 'Ayudante' }

interface Guardia {
  all: CalEntry[]
  enc?: CalEntry
  ayte?: CalEntry
  personal: CalEntry[]
}

const shiftMonth = (m: string, delta: number) => {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export default function Calendar({ onBack }: { onBack: () => void }) {
  const [month, setMonth] = useState<string | null>(null)
  const [entries, setEntries] = useState<CalEntry[] | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<{ date: string; type: ShiftType } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  const load = useCallback(async (m: string) => {
    setEntries(null)
    setError('')
    try {
      setEntries(await api.loadCalendar(m))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    api.targetMonth().then((m) => setMonth(m)).catch((e) => setError((e as Error).message))
  }, [])
  useEffect(() => {
    if (month) load(month)
  }, [month, load])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4500)
    return () => clearTimeout(t)
  }, [toast])

  // guardia -> encargado, ayudante y resto del personal
  const byShift = useMemo(() => {
    const map = new Map<string, Guardia>()
    for (const e of entries ?? []) {
      const k = key(e.shift_date, e.shift_type)
      if (!map.has(k)) map.set(k, { all: [], personal: [] })
      const g = map.get(k)!
      g.all.push(e)
      if (e.funcion === 'encargado') g.enc = e
      else if (e.funcion === 'ayudante') g.ayte = e
      else g.personal.push(e)
    }
    return map
  }, [entries])

  // Semanas de domingo a sábado
  const weeks = useMemo(() => {
    if (!month) return []
    const days = monthDays(month)
    const cells: (string | null)[] = [...Array(weekdayIndex(days[0])).fill(null), ...days]
    while (cells.length % 7) cells.push(null)
    return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7))
  }, [month])

  // Guardias con gente pero sin encargado, en orden
  const pendientes = useMemo(() => {
    if (!month) return []
    return monthDays(month).flatMap((d) =>
      TYPES.filter((t) => {
        const g = byShift.get(key(d, t))
        return g && g.all.length > 0 && !g.enc
      }).map((t) => ({ date: d, type: t })),
    )
  }, [month, byShift])

  const stats = useMemo(() => {
    if (!month || !entries) return null
    const slots = monthDays(month).length * 2
    const ocupados = entries.length
    const personas = new Set(entries.map((e) => e.user_id)).size
    const sinCubrir = monthDays(month).flatMap((d) => TYPES.map((t) => byShift.get(key(d, t))?.all.length ?? 0)).filter((n) => n === 0).length
    return { ocupados, personas, libres: slots * MAX_POR_GUARDIA - ocupados, sinCubrir }
  }, [month, entries, byShift])

  const filasPersonal = (week: (string | null)[]) =>
    Math.max(5, ...week.flatMap((d) => (d ? TYPES.map((t) => byShift.get(key(d, t))?.personal.length ?? 0) : [0])))

  const totalFilas = 3 + weeks.reduce((n, w) => n + 1 + ROLES.length + filasPersonal(w), 0)
  // Alto de fila para que todo entre en una hoja A4 apaisada (≈196 mm útiles)
  const rowMm = Math.min(5, 196 / Math.max(totalFilas, 1))

  async function asignar(date: string, type: ShiftType, funcion: Funcion, persona: CalEntry | null) {
    setBusy(`${funcion}|${persona?.user_id ?? ''}`)
    try {
      await api.setFuncion(date, type, funcion, persona?.user_id ?? null)
      // Mismas reglas que la base: libera esa función y la que tuviera la persona elegida
      setEntries((prev) =>
        prev?.map((e) => {
          if (e.shift_date !== date || e.shift_type !== type) return e
          if (persona && e.user_id === persona.user_id) return { ...e, funcion }
          if (e.funcion === funcion) return { ...e, funcion: null }
          return e
        }) ?? null,
      )
    } catch (e) {
      setToast((e as Error).message)
      if (month) load(month)
    } finally {
      setBusy(null)
    }
  }

  function siguientePendiente() {
    const actual = open ? key(open.date, open.type) : ''
    const next = pendientes.find((p) => key(p.date, p.type) > actual) ?? pendientes[0]
    setOpen(next ?? null)
  }

  const mes = month ? monthName(month).toUpperCase() : ''
  const anio = month?.slice(0, 4) ?? ''
  const g = open ? byShift.get(key(open.date, open.type)) : undefined

  return (
    <div className="cal-shell" style={{ ['--rh' as string]: `${rowMm.toFixed(2)}mm` }}>
      <header className="cal-bar no-print">
        <button className="link" onClick={onBack}>Volver a mis guardias</button>
        <div className="cal-month">
          <button className="btn icon-btn" aria-label="Mes anterior" onClick={() => month && setMonth(shiftMonth(month, -1))}>‹</button>
          <h1>
            Calendario de <span>{month ? monthName(month) : ''} {anio}</span>
          </h1>
          <button className="btn icon-btn" aria-label="Mes siguiente" onClick={() => month && setMonth(shiftMonth(month, 1))}>›</button>
        </div>
        <div className="cal-actions">
          <button className="btn" onClick={() => month && load(month)}>Actualizar</button>
          <button className="btn primary" onClick={() => window.print()} disabled={!entries}>Imprimir</button>
        </div>
        {stats && (
          <p className="muted small cal-stats">
            {stats.ocupados} lugares ocupados por {stats.personas} personas. Quedan {stats.libres} libres
            {stats.sinCubrir > 0 && <>, y <strong className="warn">{stats.sinCubrir === 1 ? '1 guardia sin nadie' : `${stats.sinCubrir} guardias sin nadie`}</strong></>}.
            Solo aparecen las guardias confirmadas.
          </p>
        )}
        {entries && (
          <div className={`enc-status ${pendientes.length ? 'pending' : 'ok'}`}>
            {pendientes.length ? (
              <>
                <span>
                  <strong>{pendientes.length === 1 ? '1 guardia sin encargado' : `${pendientes.length} guardias sin encargado`}.</strong>{' '}
                  Tocá cualquier guardia de la planilla para elegir encargado y ayudante.
                </span>
                <button className="btn primary" onClick={siguientePendiente}>Asignar encargados</button>
              </>
            ) : (
              <span>Todas las guardias con personal tienen encargado. Para cambiar uno, tocá la guardia.</span>
            )}
          </div>
        )}
        {api.demo && <p className="muted small">En la demostración los nombres son inventados.</p>}
      </header>

      {error && <p className="msg error no-print">{error}</p>}
      {!entries && !error && <p className="muted no-print">Cargando el calendario…</p>}

      {entries && (
        <div className="sheet-scroll">
          <table className="planilla">
            <colgroup>
              <col className="c-label" />
              {DIAS.flatMap((d) => [
                <col key={d + 'a'} className="c-name" />, <col key={d + 'b'} className="c-side" />,
                <col key={d + 'c'} className="c-name" />, <col key={d + 'd'} className="c-side" />,
              ])}
            </colgroup>
            <thead>
              <tr className="p-title">
                <th className="blank" />
                <th colSpan={28}>PLANILLA DE GUARDIA CORRESPONDIENTE AL MES DE {mes} {anio}</th>
              </tr>
              <tr className="p-days">
                <th className="blank" />
                {DIAS.map((d) => <th key={d} colSpan={4}>{d.toUpperCase()}</th>)}
              </tr>
              <tr className="p-shifts">
                <th className="blank" />
                {DIAS.flatMap((d) => [<th key={d + 'd'} colSpan={2}>DIA</th>, <th key={d + 'n'} colSpan={2}>NOCHE</th>])}
              </tr>
            </thead>
            {weeks.map((week, wi) => {
              const n = filasPersonal(week)
              const rows = [...ROLES.map((r) => ({ ...r, idx: -1 })), ...Array.from({ length: n }, (_, idx) => ({ label: 'Personal de Guardia', cls: 'r-pers', kind: 'pers' as Kind, idx }))]
              return (
                <tbody key={wi}>
                  <tr className="p-num">
                    <td className="blank" />
                    {week.map((d, i) => d
                      ? <td key={i} colSpan={4}>{dayNumber(d)}</td>
                      : <td key={i} colSpan={4} className="out" />)}
                  </tr>
                  {rows.map((row, ri) => (
                    <tr key={ri} className={row.cls}>
                      <th scope="row" className="p-label">{row.label}</th>
                      {week.flatMap((d, i) =>
                        TYPES.flatMap((t) => {
                          if (!d)
                            return [<td key={`${i}${t}n`} className="p-name out" />, <td key={`${i}${t}s`} className="p-side out" />]
                          const k = key(d, t)
                          const gs = byShift.get(k)
                          const name =
                            row.kind === 'enc' ? gs?.enc?.nombre
                            : row.kind === 'ayte' ? gs?.ayte?.nombre
                            : row.kind === 'pers' ? gs?.personal[row.idx]?.nombre
                            : ''
                          const falta = row.kind === 'enc' && gs && gs.all.length > 0 && !gs.enc
                          const abierta = open && key(open.date, open.type) === k
                          return [
                            <td key={`${i}${t}n`} className={`p-name ${falta ? 'falta' : ''} ${abierta ? 'abierta' : ''}`}>
                              <button
                                className="cell-btn"
                                tabIndex={row.kind === 'enc' ? 0 : -1}
                                aria-label={`${shiftName(t)} del ${longDate(d)}: elegir encargado y ayudante`}
                                onClick={() => setOpen({ date: d, type: t })}
                              >
                                {name || (falta ? <span className="no-print">Falta</span> : '')}
                              </button>
                            </td>,
                            <td key={`${i}${t}s`} className="p-side" />,
                          ]
                        }),
                      )}
                    </tr>
                  ))}
                </tbody>
              )
            })}
          </table>
        </div>
      )}

      {open && (
        <div className="sheet-backdrop no-print" onClick={() => setOpen(null)}>
          <section
            className="sheet-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="panel-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(null)}
          >
            <header>
              <h2 id="panel-title">
                {longDate(open.date)}, {shiftName(open.type).toLowerCase()}
              </h2>
              <button className="link" onClick={() => setOpen(null)} autoFocus>Cerrar</button>
            </header>
            {!g || g.all.length === 0 ? (
              <p className="muted">Nadie confirmó esta guardia todavía.</p>
            ) : (
              <>
                <p className="muted small">
                  El encargado es obligatorio y el ayudante es opcional. Se eligen entre los {g.all.length} anotados.
                </p>
                <ul className="pick-list">
                  {g.all.map((p) => (
                    <li key={p.user_id}>
                      <span className={`pick-name ${p.funcion ?? ''}`}>{p.nombre}</span>
                      {(['encargado', 'ayudante'] as Funcion[]).map((f) => {
                        const on = p.funcion === f
                        return (
                          <button
                            key={f}
                            className={`pick ${f}`}
                            aria-pressed={on}
                            disabled={busy !== null}
                            onClick={() => asignar(open.date, open.type, f, on ? null : p)}
                          >
                            {busy === `${f}|${p.user_id}` ? '…' : FUNCION_NOMBRE[f]}
                          </button>
                        )
                      })}
                    </li>
                  ))}
                </ul>
                {!g.enc && <p className="msg error">Esta guardia todavía no tiene encargado.</p>}
              </>
            )}
            <footer>
              {pendientes.some((p) => key(p.date, p.type) !== key(open.date, open.type)) ? (
                <button className="btn primary wide" onClick={siguientePendiente}>
                  Siguiente guardia sin encargado
                </button>
              ) : (
                <button className="btn primary wide" onClick={() => setOpen(null)}>Listo</button>
              )}
            </footer>
          </section>
        </div>
      )}

      {toast && <div className="toast error no-print" role="alert" onClick={() => setToast('')}>{toast}</div>}
    </div>
  )
}
