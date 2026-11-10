import { useEffect, useState, type FormEvent } from 'react'
import { api } from './lib/api'
import ProfileFields, { emptyDraft, LEGAJO_PREFIJO, legajoDe, validar, type PerfilDraft } from './ProfileFields'

type Mode = 'ingresar' | 'crear' | 'olvide'

export default function Login({ recovery, onRecovered }: { recovery: boolean; onRecovered: () => void }) {
  const [mode, setMode] = useState<Mode>('ingresar')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [legajoNum, setLegajoNum] = useState('')
  const [perfil, setPerfil] = useState<PerfilDraft>(emptyDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    setError('')
    setNotice('')
  }, [mode])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (recovery) {
        await api.updatePassword(pw)
        onRecovered()
      } else if (mode === 'ingresar') {
        if (!/^\d{1,5}$/.test(legajoNum.trim())) throw new Error('Escribí tu número de legajo (lo que va después de 147/).')
        await api.signIn(LEGAJO_PREFIJO + legajoNum.trim(), pw)
      } else if (mode === 'crear') {
        const problema = validar(perfil)
        if (problema) throw new Error(problema)
        const legajo = legajoDe(perfil)
        if (!(await api.legajoDisponible(legajo)))
          throw new Error(`El legajo ${legajo} ya tiene una cuenta. Si es tuyo, ingresá o recuperá la clave.`)
        const { needsConfirm } = await api.signUp(email.trim(), pw, {
          nombre: perfil.nombre.trim(),
          apellido: perfil.apellido.trim(),
          legajo,
          dependencia: perfil.dependencia as Exclude<PerfilDraft['dependencia'], ''>,
        })
        if (needsConfirm) setNotice(`Te mandamos un mail a ${email.trim()}. Abrí el enlace para activar tu cuenta y después ingresá con tu legajo.`)
      } else {
        await api.resetPassword(email.trim())
        setNotice('Si el mail está registrado, te llega un enlace para crear una clave nueva.')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <header className="login-head brand">
        <img className="login-escudo" src={`${import.meta.env.BASE_URL}escudo.png`} alt="Escudo de Bomberos Voluntarios de Morón, 147" />
        <div>
          <h1>Bomberos Voluntarios de Morón</h1>
          <p className="muted">Plataforma del cuartel</p>
        </div>
      </header>

      <form className="login-card" onSubmit={submit}>
        {recovery ? (
          <h2>Elegí una clave nueva</h2>
        ) : (
          mode !== 'olvide' && (
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={mode === 'ingresar'} onClick={() => setMode('ingresar')}>
                Ingresar
              </button>
              <button type="button" role="tab" aria-selected={mode === 'crear'} onClick={() => setMode('crear')}>
                Crear cuenta
              </button>
            </div>
          )
        )}
        {mode === 'olvide' && !recovery && <h2>Recuperar la clave</h2>}

        {mode === 'ingresar' && !recovery && (
          <label>
            Legajo
            <span className="legajo">
              <span className="legajo-pre" aria-hidden="true">{LEGAJO_PREFIJO}</span>
              <input
                id="legajo-ingreso"
                required
                inputMode="numeric"
                autoComplete="username"
                maxLength={5}
                aria-label="Número de legajo, después de 147/"
                placeholder="123"
                value={legajoNum}
                onChange={(e) => setLegajoNum(e.target.value.replace(/\D/g, ''))}
              />
            </span>
          </label>
        )}
        {mode === 'crear' && !recovery && <ProfileFields value={perfil} onChange={setPerfil} />}
        {mode === 'olvide' && !recovery && (
          <p className="muted small">Escribí el mail que cargaste al crear tu cuenta y te mandamos un enlace para elegir una clave nueva.</p>
        )}
        {!recovery && mode !== 'ingresar' && (
          <label>
            {mode === 'crear' ? 'Mail de contacto' : 'Mail'}
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}
        {(mode !== 'olvide' || recovery) && (
          <label>
            {mode === 'crear' || recovery ? 'Clave (mínimo 6 caracteres)' : 'Clave'}
            <input
              id="clave"
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'crear' || recovery ? 'new-password' : 'current-password'}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </label>
        )}

        {mode === 'crear' && !recovery && (
          <p className="muted small">Tu cuenta queda pendiente hasta que un administrador la apruebe y te habilite las apps.</p>
        )}
        {error && <p className="msg error" role="alert">{error}</p>}
        {notice && <p className="msg ok" role="status">{notice}</p>}

        <button className="btn primary" disabled={busy}>
          {busy
            ? 'Un momento…'
            : recovery
              ? 'Guardar clave'
              : mode === 'ingresar'
                ? 'Ingresar'
                : mode === 'crear'
                  ? 'Crear cuenta'
                  : 'Enviar enlace'}
        </button>

        {!recovery && (
          <button type="button" className="link" onClick={() => setMode(mode === 'olvide' ? 'ingresar' : 'olvide')}>
            {mode === 'olvide' ? 'Volver a ingresar' : 'Me olvidé la clave'}
          </button>
        )}
      </form>
    </main>
  )
}
