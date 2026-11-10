import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './lib/api'
import type { AppId, AppRol, Dependencia, Estado, Rol, Usuario } from './lib/types'
import { DEPENDENCIAS } from './ProfileFields'
import { APPS } from './apps'

const ROL_NOMBRE: Record<Rol, string> = { usuario: 'Usuario', admin: 'Administrador', super: 'Superusuario' }
const ESTADO_NOMBRE: Record<Estado, string> = { pendiente: 'Pendiente', activo: 'Activo', baja: 'De baja' }
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')
const nombreDe = (u: Usuario) => (u.apellido ? `${cap(u.apellido)}, ${cap(u.nombre)}` : u.email)

type Filtro = 'pendiente' | 'activo' | 'baja' | 'todos'

export default function Users({ miRol, miEmail, onBack }: { miRol: Rol; miEmail: string; onBack: () => void }) {
  const [users, setUsers] = useState<Usuario[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<Filtro | null>(null)
  const [dep, setDep] = useState<Dependencia | 'todas'>('todas')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null)
  const esSuper = miRol === 'super'

  const load = useCallback(async () => {
    setError('')
    try {
      setUsers(await api.listUsers())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const cuenta = useMemo(() => {
    const all = users ?? []
    return {
      pendiente: all.filter((u) => u.estado === 'pendiente').length,
      activo: all.filter((u) => u.estado === 'activo').length,
      baja: all.filter((u) => u.estado === 'baja').length,
      todos: all.length,
    }
  }, [users])

  // Si hay cuentas pendientes, se abre directamente en ese filtro
  const f: Filtro = filtro ?? (cuenta.pendiente > 0 ? 'pendiente' : 'activo')

  const visibles = useMemo(() => {
    const term = sinTildes(q.trim())
    return (users ?? []).filter((u) => {
      if (f !== 'todos' && u.estado !== f) return false
      if (dep !== 'todas' && u.dependencia !== dep) return false
      if (!term) return true
      return sinTildes(`${u.apellido ?? ''} ${u.nombre ?? ''} ${u.legajo ?? ''} ${u.email}`).includes(term)
    })
  }, [users, q, f, dep])

  const sel = users?.find((u) => u.id === abierto) ?? null
  const patch = (id: string, p: Partial<Usuario>) => setUsers((prev) => prev?.map((u) => (u.id === id ? { ...u, ...p } : u)) ?? null)

  async function run(key: string, fn: () => Promise<void>, ok?: string) {
    setBusy(key)
    try {
      await fn()
      if (ok) setToast({ kind: 'ok', text: ok })
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message })
      load()
    } finally {
      setBusy(null)
    }
  }

  const setApp = (u: Usuario, app: AppId, rol: AppRol | null) =>
    run(`${u.id}|${app}`, async () => {
      await api.setAppAccess(u.id, app, rol)
      const apps = { ...u.apps }
      if (rol) apps[app] = rol
      else delete apps[app]
      patch(u.id, { apps })
    })

  const setEstado = (u: Usuario, estado: Estado) =>
    run(
      `${u.id}|estado`,
      async () => {
        await api.setEstado(u.id, estado)
        patch(u.id, { estado })
      },
      estado === 'activo' ? `Cuenta de ${nombreDe(u)} aprobada.` : estado === 'baja' ? `${nombreDe(u)} quedó dada de baja.` : undefined,
    )

  const setRol = (u: Usuario, rol: Rol) =>
    run(`${u.id}|rol`, async () => {
      await api.setRole(u.id, rol)
      patch(u.id, { rol })
    }, `${nombreDe(u)} ahora es ${ROL_NOMBRE[rol].toLowerCase()} de la plataforma.`)

  return (
    <div className="users">
      <header className="users-head">
        <button className="link" onClick={onBack}>Volver al inicio</button>
        <h1>Usuarios y permisos</h1>
        <p className="muted">Aprobá las cuentas nuevas y elegí a qué apps entra cada persona, y con qué rol.</p>
      </header>

      <div className="users-filters">
        <div className="chips" role="group" aria-label="Estado de la cuenta">
          {(['pendiente', 'activo', 'baja', 'todos'] as Filtro[]).map((x) => (
            <button key={x} className={`chip ${x === 'pendiente' && cuenta.pendiente ? 'alert' : ''}`} aria-pressed={f === x} onClick={() => setFiltro(x)}>
              {x === 'todos' ? 'Todos' : x === 'pendiente' ? 'Pendientes' : x === 'activo' ? 'Activos' : 'De baja'} ({cuenta[x]})
            </button>
          ))}
        </div>
        <input
          id="buscar"
          type="search"
          placeholder="Buscar por apellido, nombre, legajo o mail"
          aria-label="Buscar usuarios"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="chips" role="group" aria-label="Dependencia">
          {(['todas', ...DEPENDENCIAS] as const).map((d) => (
            <button key={d} className="chip" aria-pressed={dep === d} onClick={() => setDep(d)}>
              {d === 'todas' ? 'Todas las dependencias' : d}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="msg error">{error}</p>}
      {!users && !error && <p className="muted">Cargando usuarios…</p>}
      {users && visibles.length === 0 && (
        <p className="muted empty-line">{f === 'pendiente' && !q ? 'No hay cuentas esperando aprobación.' : 'Nadie coincide con la búsqueda.'}</p>
      )}

      {users && visibles.length > 0 && (
        <ul className="user-list">
          {visibles.map((u) => {
            const yo = u.email.toLowerCase() === miEmail.toLowerCase()
            return (
              <li key={u.id}>
                <button className={`user-row estado-${u.estado}`} onClick={() => setAbierto(u.id)}>
                  <span className="u-name">
                    <strong>{nombreDe(u)}</strong>
                    {yo && <span className="tag">Vos</span>}
                    {u.rol !== 'usuario' && <span className="tag strong">{ROL_NOMBRE[u.rol]}</span>}
                    <span className="u-meta">
                      {u.legajo ?? 'Sin legajo'}, {u.dependencia ?? 'sin dependencia'}. {u.email}
                    </span>
                  </span>
                  <span className="u-apps">
                    {u.estado === 'pendiente' ? (
                      <span className="estado-pill pendiente">Esperando aprobación</span>
                    ) : u.estado === 'baja' ? (
                      <span className="estado-pill baja">De baja</span>
                    ) : u.rol === 'super' ? (
                      <span className="app-pill">Todas las apps</span>
                    ) : APPS.filter((a) => u.apps[a.id]).length === 0 ? (
                      <span className="muted small">Sin apps</span>
                    ) : (
                      APPS.filter((a) => u.apps[a.id]).map((a) => (
                        <span key={a.id} className="app-pill" style={{ borderColor: a.color }}>
                          {a.nombre}
                          {u.apps[a.id] === 'admin' ? ' (admin)' : ''}
                        </span>
                      ))
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {sel && (
        <div className="sheet-backdrop" onClick={() => setAbierto(null)}>
          <section
            className="sheet-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && setAbierto(null)}
          >
            <header>
              <h2 id="user-title">{nombreDe(sel)}</h2>
              <button className="link" onClick={() => setAbierto(null)} autoFocus>Cerrar</button>
            </header>
            <dl className="user-facts">
              <dt>Legajo</dt><dd>{sel.legajo ?? '—'}</dd>
              <dt>Dependencia</dt><dd>{sel.dependencia ?? '—'}</dd>
              <dt>Mail</dt><dd className="sel-all">{sel.email}</dd>
              <dt>Cuenta</dt><dd><span className={`estado-pill ${sel.estado}`}>{ESTADO_NOMBRE[sel.estado]}</span></dd>
              {sel.apps.guardias && <><dt>Guardias</dt><dd>{sel.guardias ? `${sel.guardias} confirmadas este mes` : 'Sin guardias confirmadas este mes'}</dd></>}
            </dl>

            {sel.email.toLowerCase() === miEmail.toLowerCase() ? (
              <p className="muted small">Tu propia cuenta la administra otro administrador o un superusuario.</p>
            ) : sel.rol === 'super' ? (
              <p className="muted small">Es superusuario: tiene acceso de administrador a todas las apps.</p>
            ) : (
              <>
                <h3>Permisos por app</h3>
                <ul className="perm-list">
                  {APPS.map((a) => {
                    const actual = sel.apps[a.id] ?? null
                    return (
                      <li key={a.id}>
                        <span className="perm-app">
                          <span className="dot" style={{ background: a.color }} aria-hidden="true" />
                          {a.nombre}
                        </span>
                        <span className="seg" role="radiogroup" aria-label={`Permiso en ${a.nombre}`}>
                          {([null, 'usuario', 'admin'] as (AppRol | null)[]).map((r) => (
                            <button
                              key={r ?? 'no'}
                              role="radio"
                              aria-checked={actual === r}
                              disabled={busy !== null}
                              onClick={() => actual !== r && setApp(sel, a.id, r)}
                            >
                              {r === null ? 'Sin acceso' : r === 'usuario' ? 'Usuario' : 'Admin'}
                            </button>
                          ))}
                        </span>
                      </li>
                    )
                  })}
                </ul>
                {sel.estado === 'pendiente' && Object.keys(sel.apps).length === 0 && (
                  <p className="muted small">Elegí al menos una app antes de aprobar, así ya puede usarla al entrar.</p>
                )}

                {esSuper && (
                  <label className="plat-rol">
                    Rol en la plataforma
                    <select id="rol-plataforma" value={sel.rol} disabled={busy !== null} onChange={(e) => setRol(sel, e.target.value as Rol)}>
                      <option value="usuario">Usuario</option>
                      <option value="admin">Administrador (aprueba cuentas y da permisos)</option>
                      <option value="super">Superusuario</option>
                    </select>
                  </label>
                )}

                <footer className="user-actions">
                  {sel.estado === 'pendiente' && (
                    <>
                      <button className="btn primary wide" disabled={busy !== null} onClick={() => setEstado(sel, 'activo')}>
                        Aprobar cuenta
                      </button>
                      <button className="btn wide" disabled={busy !== null} onClick={() => setEstado(sel, 'baja')}>
                        Rechazar
                      </button>
                    </>
                  )}
                  {sel.estado === 'activo' && (
                    <button className="btn wide danger" disabled={busy !== null} onClick={() => setEstado(sel, 'baja')}>
                      Dar de baja
                    </button>
                  )}
                  {sel.estado === 'baja' && (
                    <button className="btn primary wide" disabled={busy !== null} onClick={() => setEstado(sel, 'activo')}>
                      Reactivar cuenta
                    </button>
                  )}
                </footer>
              </>
            )}
          </section>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.kind === 'error' ? 'error' : ''}`} role="status" onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  )
}
