import { useEffect, useState } from 'react'
import { api } from './lib/api'
import type { MiPerfil } from './lib/types'
import { APPS } from './apps'

const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')

/** Pantalla de inicio: una tarjeta por cada app habilitada */
export default function Home({ perfil, go }: { perfil: MiPerfil; go: (page: string) => void }) {
  const esAdmin = perfil.rol === 'admin' || perfil.rol === 'super'
  const [pendientes, setPendientes] = useState<number | null>(null)

  useEffect(() => {
    if (!esAdmin) return
    api
      .listUsers()
      .then((us) => setPendientes(us.filter((u) => u.estado === 'pendiente').length))
      .catch(() => setPendientes(null))
  }, [esAdmin])

  const mias = APPS.filter((a) => perfil.apps[a.id])

  return (
    <div className="home">
      <header className="home-head">
        <img className="home-escudo" src={`${import.meta.env.BASE_URL}escudo-256.png`} alt="Escudo de Bomberos Voluntarios de Morón" />
        <div>
          <p className="muted small">Bomberos Voluntarios de Morón</p>
          <h1>Hola, {cap(perfil.nombre?.split(' ')[0])}</h1>
          <p className="muted small home-legajo">
            Legajo {perfil.legajo}, {perfil.dependencia}
          </p>
        </div>
        <nav className="home-links">
          <button className="link small" onClick={() => go('cuenta')}>Mi cuenta</button>
          <button className="link small" onClick={() => api.signOut()}>Salir</button>
        </nav>
      </header>

      {mias.length === 0 ? (
        <section className="empty">
          <h2>Todavía no tenés apps habilitadas</h2>
          <p className="muted">Pedile a un administrador que te dé acceso a las apps que usás.</p>
        </section>
      ) : (
        <ul className="app-grid">
          {mias.map((a) => {
            const admin = perfil.apps[a.id] === 'admin'
            const inner = (
              <>
                <span className="app-band" style={{ background: a.color }} aria-hidden="true" />
                <span className="app-title">
                  {a.nombre}
                  {admin && <span className="tag">Administrador</span>}
                </span>
                <span className="app-desc">{a.descripcion}</span>
                {a.aviso && <span className="app-note">{a.aviso}</span>}
              </>
            )
            return (
              <li key={a.id}>
                {a.modo === 'activa' && (
                  <button className="app-card" onClick={() => go(a.id)}>{inner}</button>
                )}
                {a.modo === 'externa' && (
                  <a className="app-card" href={a.url} target="_blank" rel="noreferrer">{inner}</a>
                )}
                {a.modo === 'proximamente' && (
                  <div className="app-card off" aria-disabled="true">{inner}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {esAdmin && (
        <section className="admin-strip">
          <h2>Administración</h2>
          <button className="admin-card" onClick={() => go('usuarios')}>
            <span>
              <strong>Usuarios y permisos</strong>
              <span className="muted small">Aprobá cuentas nuevas y elegí a qué apps entra cada uno.</span>
            </span>
            {pendientes !== null && pendientes > 0 && (
              <span className="count-badge">{pendientes === 1 ? '1 pendiente' : `${pendientes} pendientes`}</span>
            )}
          </button>
        </section>
      )}
    </div>
  )
}

/** Cuenta recién creada o dada de baja: todavía no puede usar nada */
export function Espera({ perfil }: { perfil: MiPerfil }) {
  const baja = perfil.estado === 'baja'
  return (
    <main className="login">
      <header className="login-head">
        <img className="home-escudo" src={`${import.meta.env.BASE_URL}escudo-256.png`} alt="Escudo de Bomberos Voluntarios de Morón" />
        <h1>{baja ? 'Tu cuenta está dada de baja' : 'Tu cuenta está esperando aprobación'}</h1>
      </header>
      <div className="login-card">
        {baja ? (
          <p>Si creés que es un error, consultá con la jefatura.</p>
        ) : (
          <>
            <p>
              Un administrador tiene que aprobarla y elegir a qué apps vas a entrar. Cuando lo haga, volvé a ingresar con tu legajo{' '}
              <strong>{perfil.legajo}</strong> y tu clave.
            </p>
            <p className="muted small">Si pasa mucho tiempo, avisale a la jefatura o escribí a bomberosvoluntariosmoron@gmail.com.</p>
          </>
        )}
        <button className="btn" onClick={() => location.reload()}>Volver a revisar</button>
        <button className="link" onClick={() => api.signOut()}>Salir</button>
      </div>
    </main>
  )
}
