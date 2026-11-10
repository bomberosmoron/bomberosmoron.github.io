import { useCallback, useEffect, useState } from 'react'
import { api } from './lib/api'
import type { MiPerfil } from './lib/types'
import Login from './Login'
import Home, { Espera } from './Home'
import Roster from './Roster'
import Calendar from './Calendar'
import Users from './Users'
import MyData from './MyData'
import HidraMap from './hidramap/HidraMap'
import Fiestas from './fiestas/Fiestas'

/**
 * Pantallas de la plataforma. Se guardan en el #hash de la dirección,
 * así funcionan el botón Atrás del celular y los accesos directos.
 *   (vacío)     inicio con las apps
 *   guardias    Guardias: mis guardias
 *   calendario  Guardias: calendario (administradores de Guardias)
 *   usuarios    usuarios y permisos (administradores de la plataforma)
 *   cuenta      mi cuenta
 *   hidramap, hidramap-mapa, hidramap-mias   HidraMap: cargar, mapa, mis cargas
 *   fiestas, fiestas-resumen                 Guardias de Fiestas: anotarme, resumen de la jefatura
 */
type Page = '' | 'guardias' | 'calendario' | 'usuarios' | 'cuenta' | 'hidramap' | 'hidramap-mapa' | 'hidramap-mias' | 'fiestas' | 'fiestas-resumen'
const PAGES: Page[] = ['', 'guardias', 'calendario', 'usuarios', 'cuenta', 'hidramap', 'hidramap-mapa', 'hidramap-mias', 'fiestas', 'fiestas-resumen']

const leerHash = (): Page => {
  const h = location.hash.replace('#', '') as Page
  return PAGES.includes(h) ? h : ''
}
const completo = (p: MiPerfil) => Boolean(p.nombre && p.apellido && p.legajo && p.dependencia)

export default function App() {
  const [email, setEmail] = useState<string | null | undefined>(undefined)
  const [recovery, setRecovery] = useState(false)
  const [perfil, setPerfil] = useState<MiPerfil | null>(null)
  const [perfilError, setPerfilError] = useState('')
  const [page, setPage] = useState<Page>(leerHash())

  useEffect(() => {
    api.getEmail().then(setEmail)
    const off = api.onAuth((s) => {
      setEmail(s.email)
      if (s.recovery) setRecovery(true)
    })
    const onHash = () => setPage(leerHash())
    window.addEventListener('hashchange', onHash)
    return () => {
      off()
      window.removeEventListener('hashchange', onHash)
    }
  }, [])

  const go = useCallback((p: string) => {
    const next = (PAGES.includes(p as Page) ? p : '') as Page
    if (next) location.hash = next
    else history.pushState(null, '', location.pathname + location.search)
    setPage(next)
    window.scrollTo(0, 0)
  }, [])

  const cargarPerfil = useCallback(() => {
    setPerfilError('')
    api.myProfile().then(setPerfil).catch((e) => setPerfilError((e as Error).message))
  }, [])

  useEffect(() => {
    setPerfil(null)
    if (email) cargarPerfil()
  }, [email, cargarPerfil])

  const esAdmin = perfil?.rol === 'admin' || perfil?.rol === 'super'
  const guardias = perfil?.apps.guardias
  const hidramap = perfil?.apps.hidramap
  const fiestas = perfil?.apps.fiestas
  const inicio = () => go('')

  let body
  if (email === undefined) body = <div className="boot" aria-busy="true" />
  else if (!email || recovery) body = <Login recovery={recovery} onRecovered={() => setRecovery(false)} />
  else if (perfilError)
    body = (
      <main className="center">
        <p className="msg error">{perfilError}</p>
        <button className="btn" onClick={cargarPerfil}>Volver a intentar</button>
        <button className="link" onClick={() => api.signOut()}>Salir</button>
      </main>
    )
  else if (!perfil) body = <div className="boot" aria-busy="true" />
  else if (!completo(perfil)) body = <MyData perfil={perfil} modo="completar" onSaved={setPerfil} />
  else if (perfil.estado !== 'activo') body = <Espera perfil={perfil} />
  else if (page === 'cuenta') body = <MyData perfil={perfil} modo="editar" onSaved={setPerfil} onBack={inicio} />
  else if (page === 'usuarios' && esAdmin) body = <Users miRol={perfil.rol} miEmail={perfil.email} onBack={inicio} />
  else if (page.startsWith('fiestas') && fiestas)
    body = <Fiestas vista={page === 'fiestas-resumen' ? 'resumen' : 'anotarme'} rol={fiestas} adminPlataforma={esAdmin} go={go} />
  else if (page.startsWith('hidramap') && hidramap)
    body = <HidraMap vista={page === 'hidramap-mapa' ? 'mapa' : page === 'hidramap-mias' ? 'mias' : 'cargar'} rol={hidramap} go={go} />
  else if (page === 'calendario' && guardias === 'admin') body = <Calendar onBack={() => go('guardias')} />
  else if (page === 'guardias' && guardias)
    body = (
      <Roster
        email={perfil.email}
        links={[
          { label: 'Inicio', onClick: inicio },
          ...(guardias === 'admin' ? [{ label: 'Calendario', onClick: () => go('calendario') }] : []),
        ]}
      />
    )
  else body = <Home perfil={perfil} go={go} />

  return (
    <>
      {api.demo && (
        <p className="demo-banner no-print">
          Modo demostración: nada se guarda y no se envían mails. Entrás como superusuario para ver todas las pantallas.
        </p>
      )}
      {body}
    </>
  )
}
