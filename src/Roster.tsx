import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './lib/api'
import type { Funcion, Mine, Shift, ShiftType } from './lib/types'
import {
  dayNumber, key, longDate, mmss, monthDays, monthName, shiftName, weekday, weekdayIndex,
} from './lib/dates'
import { HORARIO, MAX_POR_GUARDIA, MAX_POR_PERSONA, MINUTOS_RETENCION, NOMBRE_CUARTEL } from './config'

type View = 'elegir' | 'revisar' | 'listo'
type Mail = 'previo' | 'enviando' | 'enviado' | 'error'

const TYPES: ShiftType[] = ['dia', 'noche']
const byDate = (a: Shift, b: Shift) => (a.shift_date + a.shift_type).localeCompare(b.shift_date + b.shift_type)

export default function Roster({ email, links }: { email: string; links: { label: string; onClick: () => void }[] }) {
  const [month, setMonth] = useState<string | null>(null)
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [mine, setMine] = useState<Mine[]>([])
  const [view, setView] = useState<View>('elegir')
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; kind: 'error' | 'info' } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [mail, setMail] = useState<Mail>('enviando')
  const [loadError, setLoadError] = useState('')
  const [ready, setReady] = useState(false)

  const say = (text: string, kind: 'error' | 'info' = 'error') => setToast({ text, kind })

  const reload = useCallback(async (m: string) => {
    await api.cleanup()
    const [c, me] = await Promise.all([api.loadCounts(m), api.loadMine(m)])
    setCounts(new Map(c.map((x) => [key(x.shift_date, x.shift_type), x.taken])))
    setMine(me)
    if (me.some((x) => x.status === 'confirmed')) {
      setView('listo')
      setMail('previo')
    }
  }, [])

  // Carga inicial, tiempo real y refresco al volver a la pestaña
  useEffect(() => {
    let alive = true
    let m = ''
    api
      .targetMonth()
      .then(async (tm) => {
        m = tm
        if (!alive) return
        setMonth(tm)
        await reload(tm)
        if (alive) setReady(true)
      })
      .catch((e) => setLoadError((e as Error).message))

    const off = api.subscribeCounts((c) =>
      setCounts((prev) => new Map(prev).set(key(c.shift_date, c.shift_type), c.taken)),
    )
    const onFocus = () => m && document.visibilityState === 'visible' && reload(m).catch(() => {})
    document.addEventListener('visibilitychange', onFocus)
    const poll = setInterval(onFocus, 30_000)
    return () => {
      alive = false
      off()
      document.removeEventListener('visibilitychange', onFocus)
      clearInterval(poll)
    }
  }, [reload])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(t)
  }, [toast])

  const held = useMemo(() => mine.filter((m) => m.status === 'held').sort(byDate), [mine])
  const confirmed = useMemo(() => mine.filter((m) => m.status === 'confirmed').sort(byDate), [mine])
  const heldUntil = held.length ? Math.min(...held.map((h) => Date.parse(h.held_until!))) : null
  const remaining = heldUntil ? heldUntil - now : null

  // Se venció la retención: se liberan los lugares
  useEffect(() => {
    if (remaining !== null && remaining <= 0 && month) {
      setMine((p) => p.filter((m) => m.status !== 'held'))
      setView('elegir')
      say(`Pasaron los ${MINUTOS_RETENCION} minutos y tus guardias se liberaron. Elegilas de nuevo.`, 'info')
      reload(month).catch(() => {})
    }
  }, [remaining, month, reload])

  async function toggle(date: string, type: ShiftType) {
    const k = key(date, type)
    if (busy) return
    const isMine = held.some((h) => key(h.shift_date, h.shift_type) === k)
    setBusy(k)
    try {
      if (isMine) {
        await api.release(date, type)
        setMine((p) => p.filter((m) => key(m.shift_date, m.shift_type) !== k))
        setCounts((p) => new Map(p).set(k, Math.max(0, (p.get(k) ?? 1) - 1)))
      } else {
        const until = await api.hold(date, type)
        setMine((p) => [
          ...p.map((m) => (m.status === 'held' ? { ...m, held_until: until } : m)),
          { shift_date: date, shift_type: type, status: 'held', held_until: until },
        ])
        setCounts((p) => new Map(p).set(k, (p.get(k) ?? 0) + 1))
      }
    } catch (e) {
      say((e as Error).message)
      if (month) reload(month).catch(() => {})
    } finally {
      setBusy(null)
    }
  }

  async function confirm() {
    setBusy('confirmar')
    try {
      const list = await api.confirm()
      setMine(list.map((s) => ({ ...s, status: 'confirmed', held_until: null })))
      setView('listo')
      sendMail()
    } catch (e) {
      say((e as Error).message)
      if (month) reload(month).catch(() => {})
      setView('elegir')
    } finally {
      setBusy(null)
    }
  }

  async function sendMail() {
    setMail('enviando')
    try {
      await api.sendReport()
      setMail('enviado')
    } catch {
      setMail('error')
    }
  }

  if (loadError)
    return (
      <main className="center">
        <p className="msg error">No se pudieron cargar las guardias: {loadError}</p>
        <button className="btn" onClick={() => location.reload()}>Volver a intentar</button>
      </main>
    )
  if (!month || !ready) return <div className="boot" aria-busy="true" />

  const mes = monthName(month)
  const days = monthDays(month)
  const full = held.length >= MAX_POR_PERSONA

  return (
    <div className="shell">
      <header className="top">
        <div className="top-title">
          <h1>
            Guardias de <span className="month">{mes}</span>
          </h1>
          <p className="muted small">{NOMBRE_CUARTEL}</p>
        </div>
        <nav className="top-links">
          {links.map((l) => (
            <button key={l.label} className="link small" onClick={l.onClick}>{l.label}</button>
          ))}
          <button className="link small" onClick={() => api.signOut()}>Salir</button>
        </nav>
      </header>

      {view === 'elegir' && (
        <>
          <section className="status" aria-live="polite">
            <div className="tally">
              <span className="big">{held.length}</span>
              <span className="muted">de {MAX_POR_PERSONA} guardias elegidas</span>
            </div>
            {remaining !== null ? (
              <div className={`clock ${remaining < 120_000 ? 'hurry' : ''}`}>
                <span className="big">{mmss(remaining)}</span>
                <span className="muted">para confirmar</span>
              </div>
            ) : (
              <p className="muted small hint">
                Al elegir la primera guardia tenés {MINUTOS_RETENCION} minutos para confirmar. Mientras tanto, tus lugares quedan
                reservados.
              </p>
            )}
          </section>

          <ol className="days">
            {days.map((d) => {
              const wd = weekdayIndex(d)
              return (
                <li key={d} className={`day ${wd === 0 || wd === 6 ? 'weekend' : ''} ${wd === 1 ? 'monday' : ''}`}>
                  <div className="date">
                    <span className="num">{dayNumber(d)}</span>
                    <span className="wd">{weekday(d)}</span>
                  </div>
                  {TYPES.map((t) => {
                    const k = key(d, t)
                    const taken = counts.get(k) ?? 0
                    const isMine = held.some((h) => key(h.shift_date, h.shift_type) === k)
                    const isFull = taken >= MAX_POR_GUARDIA && !isMine
                    const blocked = isFull || (full && !isMine)
                    const libres = MAX_POR_GUARDIA - taken
                    return (
                      <button
                        key={t}
                        className={`slot ${t} ${isMine ? 'mine' : ''} ${isFull ? 'full' : ''}`}
                        aria-pressed={isMine}
                        aria-label={`${shiftName(t)} del ${longDate(d)}: ${
                          isMine ? 'elegida por vos' : isFull ? 'completa' : `${libres} lugares libres`
                        }`}
                        disabled={blocked || busy === k}
                        onClick={() => toggle(d, t)}
                      >
                        <span className="slot-name">
                          <ShiftIcon type={t} />
                          {shiftName(t)}
                          {HORARIO[t] && <span className="hours">{HORARIO[t]}</span>}
                        </span>
                        <Seats taken={taken} mine={isMine} />
                        <span className="slot-state">
                          {busy === k ? '…' : isMine ? 'Elegida' : isFull ? 'Completa' : libres === 1 ? 'Queda 1' : `${libres} libres`}
                        </span>
                      </button>
                    )
                  })}
                </li>
              )
            })}
          </ol>

          <footer className="dock">
            <button className="btn primary wide" disabled={!held.length} onClick={() => setView('revisar')}>
              {held.length ? `Revisar ${held.length === 1 ? 'mi guardia' : `mis ${held.length} guardias`}` : 'Elegí al menos una guardia'}
            </button>
          </footer>
        </>
      )}

      {view === 'revisar' && (
        <section className="review">
          <h2>Revisá tus guardias</h2>
          <p className="muted">
            Al confirmar se guardan y te llega el reporte a <strong>{email}</strong>. Después no se pueden cambiar.
          </p>
          {remaining !== null && (
            <p className={`clock-inline ${remaining < 120_000 ? 'hurry' : ''}`}>Quedan {mmss(remaining)} para confirmar</p>
          )}
          <ShiftList items={held} />
          <div className="actions">
            <button className="btn primary wide" disabled={busy === 'confirmar'} onClick={confirm}>
              {busy === 'confirmar' ? 'Confirmando…' : 'Confirmar guardias'}
            </button>
            <button className="btn wide" onClick={() => setView('elegir')}>Seguir eligiendo</button>
          </div>
        </section>
      )}

      {view === 'listo' && <Resumen mes={mes} items={confirmed} email={email} mail={mail} onSendMail={sendMail} />}

      {toast && (
        <div className={`toast ${toast.kind}`} role="alert" onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  )
}

function Seats({ taken, mine }: { taken: number; mine: boolean }) {
  const others = taken - (mine ? 1 : 0)
  return (
    <span className="seats" aria-hidden="true">
      {Array.from({ length: MAX_POR_GUARDIA }, (_, i) => (
        <i key={i} className={i < others ? 'taken' : mine && i === others ? 'you' : ''} />
      ))}
    </span>
  )
}

const FUNCION_NOMBRE = { encargado: 'Encargado', ayudante: 'Ayudante' } as const

function ShiftList({ items }: { items: (Shift & { funcion?: Funcion | null })[] }) {
  return (
    <ul className="shift-list">
      {items.map((s) => (
        <li key={key(s.shift_date, s.shift_type)} className={s.shift_type}>
          <ShiftIcon type={s.shift_type} />
          <span className="when">{longDate(s.shift_date)}</span>
          <span className="what">
            {s.funcion && <span className={`role-badge ${s.funcion}`}>{FUNCION_NOMBRE[s.funcion]}</span>}
            {shiftName(s.shift_type)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Pantalla principal de quien ya confirmó sus guardias del mes */
function Resumen({
  mes, items, email, mail, onSendMail,
}: { mes: string; items: Mine[]; email: string; mail: Mail; onSendMail: () => void }) {
  const dias = items.filter((i) => i.shift_type === 'dia').length
  const noches = items.length - dias
  const enc = items.filter((i) => i.funcion === 'encargado').length
  const ayte = items.filter((i) => i.funcion === 'ayudante').length
  const partes = [
    dias ? `${dias} ${dias === 1 ? 'diurna' : 'diurnas'}` : '',
    noches ? `${noches} ${noches === 1 ? 'nocturna' : 'nocturnas'}` : '',
  ].filter(Boolean)
  const funciones = [
    enc ? `encargado en ${enc === 1 ? '1 guardia' : `${enc} guardias`}` : '',
    ayte ? `ayudante en ${ayte === 1 ? '1 guardia' : `${ayte} guardias`}` : '',
  ].filter(Boolean)

  return (
    <section className="review done">
      <div className="summary-head">
        <span className="big">{items.length}</span>
        <div>
          <h2>{items.length === 1 ? 'guardia' : 'guardias'} en {mes}</h2>
          <p className="muted">{partes.join(' y ')}. Están confirmadas y guardadas.</p>
        </div>
      </div>
      {funciones.length > 0 && (
        <p className="msg info">La jefatura te asignó como {funciones.join(' y ')}.</p>
      )}
      <ShiftList items={items} />
      <p className="muted small">Si necesitás cambiar alguna, hablá con la jefatura.</p>
      {mail === 'previo' && (
        <p className="small">
          <button className="link" onClick={onSendMail}>Reenviar el reporte a {email}</button>
        </p>
      )}
      {mail === 'enviando' && <p className="muted">Enviando el reporte a {email}…</p>}
      {mail === 'enviado' && <p className="msg ok">Te mandamos el reporte a {email}.</p>}
      {mail === 'error' && (
        <div className="msg error">
          Tus guardias quedaron guardadas, pero no se pudo enviar el mail.{' '}
          <button className="link" onClick={onSendMail}>Reintentar envío</button>
        </div>
      )}
    </section>
  )
}

function ShiftIcon({ type }: { type: ShiftType }) {
  return type === 'dia' ? (
    <svg className="icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="4" fill="currentColor" />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4
        return (
          <line key={i} x1={10 + Math.cos(a) * 6.5} y1={10 + Math.sin(a) * 6.5} x2={10 + Math.cos(a) * 8.5} y2={10 + Math.sin(a) * 8.5}
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        )
      })}
    </svg>
  ) : (
    <svg className="icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M13.5 2.5a7.5 7.5 0 1 0 4 13.6A6.5 6.5 0 0 1 13.5 2.5Z" fill="currentColor" />
    </svg>
  )
}
