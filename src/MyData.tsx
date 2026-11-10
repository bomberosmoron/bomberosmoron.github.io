import { useState, type FormEvent } from 'react'
import { api } from './lib/api'
import type { MiPerfil } from './lib/types'
import ProfileFields, { LEGAJO_PREFIJO, legajoDe, validar, type PerfilDraft } from './ProfileFields'
import { APPS } from './apps'

const ROL_PLATAFORMA = { usuario: 'Usuario', admin: 'Administrador de la plataforma', super: 'Superusuario' } as const

/**
 * Completar o corregir los datos propios.
 * "completar": aparece sola si a la cuenta le faltan datos (por ejemplo, cuentas creadas antes de este cambio).
 */
export default function MyData({
  perfil, modo, onSaved, onBack,
}: { perfil: MiPerfil; modo: 'completar' | 'editar'; onSaved: (p: MiPerfil) => void; onBack?: () => void }) {
  const [draft, setDraft] = useState<PerfilDraft>({
    nombre: perfil.nombre ?? '',
    apellido: perfil.apellido ?? '',
    legajoNum: perfil.legajo?.startsWith(LEGAJO_PREFIJO) ? perfil.legajo.slice(LEGAJO_PREFIJO.length) : '',
    dependencia: perfil.dependencia ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problema = validar(draft)
    if (problema) return setError(problema)
    setBusy(true)
    setError('')
    try {
      const datos = {
        nombre: draft.nombre.trim(),
        apellido: draft.apellido.trim(),
        legajo: legajoDe(draft),
        dependencia: draft.dependencia as NonNullable<MiPerfil['dependencia']>,
      }
      await api.updateMyProfile(datos)
      setSaved(true)
      onSaved({ ...perfil, ...datos })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <header className="login-head">
        {onBack && <button className="link" onClick={onBack}>Volver al inicio</button>}
        <h1>{modo === 'completar' ? 'Completá tus datos' : 'Mi cuenta'}</h1>
        <p className="muted">
          {modo === 'completar'
            ? 'Antes de cargar guardias necesitamos tu legajo y tu dependencia. Tu nombre aparece así en la planilla del cuartel.'
            : `Ingresás con ${perfil.email}. Tu nombre aparece así en la planilla del cuartel.`}
        </p>
      </header>
      <form className="login-card" onSubmit={submit} onChange={() => setSaved(false)}>
        <ProfileFields value={draft} onChange={setDraft} />
        {error && <p className="msg error" role="alert">{error}</p>}
        {saved && modo === 'editar' && <p className="msg ok" role="status">Datos guardados.</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar datos'}</button>
        {modo === 'completar' && (
          <button type="button" className="link" onClick={() => api.signOut()}>Salir</button>
        )}
      </form>

      {modo === 'editar' && (
        <>
          <section className="login-card account-perms">
            <h2>Tus permisos</h2>
            <p className="muted small">{ROL_PLATAFORMA[perfil.rol]}</p>
            <ul>
              {APPS.map((a) => (
                <li key={a.id}>
                  <span>{a.nombre}</span>
                  <span className={perfil.apps[a.id] ? '' : 'muted'}>
                    {perfil.apps[a.id] === 'admin' ? 'Administrador' : perfil.apps[a.id] ? 'Usuario' : 'Sin acceso'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="muted small">Los permisos los asigna un administrador.</p>
          </section>
          <CambiarClave />
        </>
      )}
    </main>
  )
}

function CambiarClave() {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 6) return setMsg({ ok: false, text: 'La clave tiene que tener al menos 6 caracteres.' })
    if (pw !== pw2) return setMsg({ ok: false, text: 'Las dos claves no coinciden.' })
    setBusy(true)
    setMsg(null)
    try {
      await api.updatePassword(pw)
      setPw('')
      setPw2('')
      setMsg({ ok: true, text: 'Clave cambiada. La próxima vez ingresá con la nueva.' })
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <h2>Cambiar la clave</h2>
      <label>
        Clave nueva (mínimo 6 caracteres)
        <input id="clave-nueva" type="password" autoComplete="new-password" minLength={6} required value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      <label>
        Repetí la clave nueva
        <input id="clave-nueva-2" type="password" autoComplete="new-password" minLength={6} required value={pw2} onChange={(e) => setPw2(e.target.value)} />
      </label>
      {msg && <p className={`msg ${msg.ok ? 'ok' : 'error'}`} role="status">{msg.text}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Guardando…' : 'Cambiar clave'}</button>
    </form>
  )
}
