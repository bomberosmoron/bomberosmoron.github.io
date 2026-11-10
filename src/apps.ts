import type { AppId } from './lib/types'

export interface AppInfo {
  id: AppId
  nombre: string
  descripcion: string
  /** color de acento de la tarjeta */
  color: string
  /**
   * activa: funciona dentro de la plataforma
   * externa: se abre aparte (todavía con su propio ingreso)
   * proximamente: se ve pero no se puede abrir
   */
  modo: 'activa' | 'externa' | 'proximamente'
  url?: string
  aviso?: string
}

export const APPS: AppInfo[] = [
  {
    id: 'guardias',
    nombre: 'Guardias',
    descripcion: 'Elegí tus guardias diurnas y nocturnas del mes que viene.',
    color: 'var(--red)',
    modo: 'activa',
  },
  {
    id: 'fiestas',
    nombre: 'Guardias de Fiestas',
    descripcion: 'Anotate en Nochebuena, Navidad, Fin de Año y Año Nuevo, con tus familiares.',
    color: '#c2571a',
    modo: 'activa',
  },
  {
    id: 'hidramap',
    nombre: 'HidraMap',
    descripcion: 'Relevamiento de hidrantes: tipo, estado, foto y ubicación GPS.',
    color: '#0277bd',
    modo: 'activa',
  },
]

export const appNombre = (id: AppId) => APPS.find((a) => a.id === id)?.nombre ?? id
