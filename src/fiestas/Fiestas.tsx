import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { AppRol, FiestaDetalle, FiestaGuardia, FiestasEstado } from '../lib/types'
import { descargar } from '../hidramap/util'

const MAX_FAMILIARES = 10

const fechaLarga = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const s = new Date(y, m - 1, d).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const franja = (f: string) => (f === 'noche' ? 'noche' : 'día')
const personas = (n: number) => (n === 1 ? '1 persona' : `${n} personas`)
const familiaresTxt = (n: number) => (n === 0 ? 'sin familiares' : n === 1 ? 'con 1 familiar' : `con ${n} familiares`)

export type VistaFiestas = 'anotarme' | 'resumen'

export default function Fiestas({
  vista, rol, adminPlataforma, go,
}: { vista: VistaFiestas; rol: AppRol; adminPlataforma: boolean; go: (page: string) => void }) {
  const admin = rol === 'admin'
  return (
    <div className="fi">
      <header className="hm-top">
        <div>
          <p className="small hm-kicker">Bomberos Voluntarios de Morón</p>
          <h1>Guardias de Fiestas</h1>
        </div>
        <nav className="top-links">
          <button className="link small" onClick={() => go('')}>Inicio</button>
          <button className="link small" onClick={() => api.signOut()}>Salir</button>
        </nav>
      </header>
      {admin && (
        <nav className="hm-tabs two" aria-label="Secciones de Guardias de Fiestas">
          <button aria-current={vista === 'anotarme' ? 'page' : undefined} onClick={() => go('fiestas')}>Anotarme</button>
          <button aria-current={vista === 'resumen' ? 'page' : undefined} onClick={() => go('fiestas-resumen')}>Resumen de la jefatura</button>
        </nav>
      )}
      {vista === 'resumen' && admin ? <Resumen adminPlataforma={adminPlataforma} /> : <Anotarme />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Anotarme
// ---------------------------------------------------------------------------
type Hoja = { g: FiestaGuardia; modo: 'familiares' | 'cancelar' } | null

function Anotarme() {
  const [estado, setEstado] = useState<FiestasEstado | null>(null)
  const [error, setError] = useState('')
  const [hoja, setHoja] = useState<Hoja>(null)
  const [cant, setCant] = useState(0)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    try {
      setEstado(await api.fiestasEstado())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4000)
    return () => clearTimeout(t)
  }, [toast])

  function abrir(g: FiestaGuardia, modo: 'familiares' | 'cancelar') {
    setCant(estado?.mias[g.id] ?? 0)
    setHoja({ g, modo })
  }

  async function confirmar() {
    if (!hoja) return
    setBusy(true)
    try {
      if (hoja.modo === 'cancelar') {
        await api.fiestasCancelar(hoja.g.id)
        setToast(`Cancelaste tu anotación en ${hoja.g.nombre}.`)
      } else {
        const ya = estado?.mias[hoja.g.id] !== undefined
        await api.fiestasReservar(hoja.g.id, cant)
        setToast(ya ? `Actualizado: vas a ${hoja.g.nombre} ${familiaresTxt(cant)}.` : `Te anotaste en ${hoja.g.nombre} ${familiaresTxt(cant)}.`)
      }
      setHoja(null)
      await load()
    } catch (e) {
      setToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const mias = useMemo(() => (estado ? estado.guardias.filter((g) => estado.mias[g.id] !== undefined) : []), [estado])
  const whatsapp = useMemo(() => {
    if (!mias.length || !estado) return ''
    const lineas = mias.map((g) => `- ${g.nombre} (${fechaLarga(g.fecha)}, ${franja(g.franja)}) ${familiaresTxt(estado.mias[g.id])}`)
    const txt = `Bomberos Voluntarios de Morón, Guardias de Fiestas.\nMe anoté en:\n${lineas.join('\n')}`
    return `https://wa.me/?text=${encodeURIComponent(txt)}`
  }, [mias, estado])

  if (error) return <p className="msg error">{error}</p>
  if (!estado) return <p className="muted">Cargando…</p>

  return (
    <section className="fi-body">
      {estado.abierta ? (
        <p className="muted">Anotate en las guardias que vas a cubrir e indicá con cuántos familiares vas (de 0 a {MAX_FAMILIARES}). Podés cambiarlo o cancelar mientras la anotación esté abierta.</p>
      ) : (
        <p className="msg error">La anotación está cerrada. Para cualquier cambio, hablá con la jefatura.</p>
      )}

      <ul className="fi-list">
        {estado.guardias.map((g) => {
          const mia = estado.mias[g.id]
          const anotado = mia !== undefined
          return (
            <li key={g.id} className={`fi-card ${anotado ? 'mine' : ''}`}>
              <div className="fi-head">
                <h2>{g.nombre}</h2>
                {anotado && <span className="role-badge fi-badge">Anotado</span>}
              </div>
              <p className="fi-when">{fechaLarga(g.fecha)}, {franja(g.franja)}</p>
              <p className="muted small">
                {g.bomberos === 1 ? '1 bombero anotado' : `${g.bomberos} bomberos anotados`}, {personas(g.bomberos + g.familiares)} en total
              </p>
              {anotado && <p className="fi-mine">Vas {familiaresTxt(mia)}.</p>}
              <div className="fi-actions">
                {anotado ? (
                  <>
                    <button className="btn" disabled={!estado.abierta} onClick={() => abrir(g, 'familiares')}>Cambiar familiares</button>
                    <button className="btn danger" disabled={!estado.abierta} onClick={() => abrir(g, 'cancelar')}>Cancelar</button>
                  </>
                ) : (
                  <button className="btn primary fi-go" disabled={!estado.abierta} onClick={() => abrir(g, 'familiares')}>Anotarme</button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {mias.length > 0 && (
        <div className="fi-share">
          <p className="muted small">Podés mandarte o mandarle a alguien el detalle de tus guardias por WhatsApp.</p>
          <a className="btn wide fi-wa" href={whatsapp} target="_blank" rel="noreferrer">Compartir por WhatsApp</a>
        </div>
      )}

      {hoja && (
        <div className="sheet-backdrop" onClick={() => setHoja(null)}>
          <section className="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="fi-sheet" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && setHoja(null)}>
            <header>
              <h2 id="fi-sheet">{hoja.g.nombre}</h2>
              <button className="link" onClick={() => setHoja(null)} autoFocus>Cerrar</button>
            </header>
            <p className="muted">{fechaLarga(hoja.g.fecha)}, {franja(hoja.g.franja)}</p>
            {hoja.modo === 'cancelar' ? (
              <>
                <p>¿Cancelás tu anotación en {hoja.g.nombre}?</p>
                <footer className="user-actions">
                  <button className="btn wide danger" disabled={busy} onClick={confirmar}>{busy ? 'Cancelando…' : 'Sí, cancelar mi anotación'}</button>
                  <button className="btn wide" onClick={() => setHoja(null)}>Volver</button>
                </footer>
              </>
            ) : (
              <>
                <p className="fi-q">¿Con cuántos familiares vas?</p>
                <div className="fi-stepper">
                  <button className="btn" aria-label="Uno menos" disabled={cant <= 0} onClick={() => setCant((c) => Math.max(0, c - 1))}>−</button>
                  <output aria-live="polite">{cant}</output>
                  <button className="btn" aria-label="Uno más" disabled={cant >= MAX_FAMILIARES} onClick={() => setCant((c) => Math.min(MAX_FAMILIARES, c + 1))}>+</button>
                </div>
                <p className="muted small fi-total">En total van {personas(cant + 1)}, contándote a vos.</p>
                <footer className="user-actions">
                  <button className="btn primary wide" disabled={busy} onClick={confirmar}>
                    {busy ? 'Guardando…' : estado.mias[hoja.g.id] !== undefined ? 'Guardar cambio' : 'Confirmar anotación'}
                  </button>
                </footer>
              </>
            )}
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status" onClick={() => setToast('')}>{toast}</div>}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Resumen de la jefatura
// ---------------------------------------------------------------------------
function Resumen({ adminPlataforma }: { adminPlataforma: boolean }) {
  const [estado, setEstado] = useState<FiestasEstado | null>(null)
  const [detalle, setDetalle] = useState<FiestaDetalle[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const [e, d] = await Promise.all([api.fiestasEstado(), api.fiestasDetalle()])
      setEstado(e)
      setDetalle(d)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  async function toggle() {
    if (!estado) return
    setBusy(true)
    try {
      await api.fiestasSetAbierta(!estado.abierta)
      setMsg(estado.abierta ? 'Anotación cerrada: ya nadie puede anotarse, cambiar ni cancelar.' : 'Anotación abierta.')
      await load()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function habilitar() {
    setBusy(true)
    try {
      const n = await api.habilitarATodos('fiestas')
      setMsg(n ? `Se habilitó Guardias de Fiestas a ${n === 1 ? '1 persona' : `${n} personas`}.` : 'Todas las cuentas activas ya tenían acceso.')
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  function exportar() {
    if (!detalle || !estado) return
    const nombre = (id: string) => estado.guardias.find((g) => g.id === id)?.nombre ?? id
    const cell = (v: unknown) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const rows = [['Guardia', 'Bombero', 'Legajo', 'Dependencia', 'Familiares', 'Total personas'], ...detalle.map((d) => [nombre(d.guardia_id), d.nombre, d.legajo, d.dependencia, d.familiares, d.familiares + 1])]
    descargar('guardias-de-fiestas.csv', '﻿' + rows.map((r) => r.map(cell).join(',')).join('\n'), 'text/csv;charset=utf-8')
  }

  if (error) return <p className="msg error">{error}</p>
  if (!estado || !detalle) return <p className="muted">Cargando…</p>
  const totB = estado.guardias.reduce((a, g) => a + g.bomberos, 0)
  const totF = estado.guardias.reduce((a, g) => a + g.familiares, 0)

  return (
    <section className="fi-body">
      <div className={`enc-status ${estado.abierta ? 'ok' : 'pending'}`}>
        <span>{estado.abierta ? 'La anotación está abierta.' : <strong>La anotación está cerrada.</strong>}</span>
        <button className="btn" disabled={busy} onClick={toggle}>{estado.abierta ? 'Cerrar la anotación' : 'Abrir la anotación'}</button>
      </div>
      {msg && <p className="msg ok" role="status">{msg}</p>}

      <div className="sheet-scroll fi-table-wrap">
        <table className="fi-table">
          <thead>
            <tr><th>Guardia</th><th>Fecha</th><th className="fi-num">Bomberos</th><th className="fi-num">Familiares</th><th className="fi-num">Total</th></tr>
          </thead>
          <tbody>
            {estado.guardias.map((g) => (
              <tr key={g.id}>
                <td>{g.nombre}</td><td className="fi-nowrap">{g.fecha.slice(8, 10)}/{g.fecha.slice(5, 7)}, {franja(g.franja)}</td>
                <td className="fi-num">{g.bomberos}</td><td className="fi-num">{g.familiares}</td><td className="fi-num"><strong>{g.bomberos + g.familiares}</strong></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={2}>Total</td><td className="fi-num">{totB}</td><td className="fi-num">{totF}</td><td className="fi-num"><strong>{totB + totF}</strong></td></tr>
          </tfoot>
        </table>
      </div>

      <div className="hm-admin-actions">
        <button className="btn" disabled={!detalle.length} onClick={exportar}>Descargar planilla (CSV)</button>
        {adminPlataforma && <button className="btn" disabled={busy} onClick={habilitar}>Habilitar a todas las cuentas activas</button>}
      </div>

      {estado.guardias.map((g) => {
        const lista = detalle.filter((d) => d.guardia_id === g.id)
        return (
          <details key={g.id} className="fi-det">
            <summary>
              <strong>{g.nombre}</strong> <span className="muted small">{lista.length === 1 ? '1 bombero' : `${lista.length} bomberos`}</span>
            </summary>
            {lista.length === 0 ? (
              <p className="muted small">Nadie se anotó todavía.</p>
            ) : (
              <ul>
                {lista.map((d) => (
                  <li key={d.nombre + d.legajo}>
                    <span>{d.nombre}</span>
                    <span className="muted small">{d.legajo}, {d.dependencia}</span>
                    <span className="fi-num">{familiaresTxt(d.familiares)}</span>
                  </li>
                ))}
              </ul>
            )}
          </details>
        )
      })}
    </section>
  )
}
