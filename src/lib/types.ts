export type ShiftType = 'dia' | 'noche'

export type Funcion = 'encargado' | 'ayudante'

export interface Mine {
  shift_date: string // YYYY-MM-DD
  shift_type: ShiftType
  status: 'held' | 'confirmed'
  held_until: string | null
  funcion?: Funcion | null
}

export interface Count {
  shift_date: string
  shift_type: ShiftType
  taken: number
}

export interface Shift {
  shift_date: string
  shift_type: ShiftType
}

export interface CalEntry {
  shift_date: string
  shift_type: ShiftType
  user_id: string
  nombre: string // "Apellido I."
  funcion: Funcion | null
}

export type Dependencia = 'CM' | 'Dto 1' | 'Dto 2'
/** Rol en la plataforma: admin aprueba cuentas y da permisos; super además nombra administradores */
export type Rol = 'usuario' | 'admin' | 'super'
export type Estado = 'pendiente' | 'activo' | 'baja'
export type AppId = 'guardias' | 'fiestas' | 'hidramap'
/** Rol dentro de cada app */
export type AppRol = 'usuario' | 'admin'
export type Permisos = Partial<Record<AppId, AppRol>>

/** Datos que carga cada persona al registrarse */
export interface Perfil {
  nombre: string
  apellido: string
  legajo: string // "147/123"
  dependencia: Dependencia
}

export interface MiPerfil extends Partial<Perfil> {
  email: string
  rol: Rol
  estado: Estado
  apps: Permisos
}

export interface Usuario extends Partial<Perfil> {
  id: string
  email: string
  rol: Rol
  estado: Estado
  apps: Permisos
  guardias: number // confirmadas en el mes que se está cargando
  created_at: string
}

// ---------- HidraMap ----------
export type TipoHidrante = '63' | '114'
export type EstadoHidrante = 'Operativo' | 'No operativo' | 'No se encuentra'

export interface Hidrante {
  id: string
  lat: number
  lng: number
  precision_m: number | null
  tipo: TipoHidrante
  estado: EstadoHidrante
  foto: string | null // URL lista para mostrar
  cargado_por_nombre: string | null
  created_at: string
  origen: 'app' | 'importado'
  mio: boolean
}

export interface NuevaCarga {
  lat: number
  lng: number
  precision: number
  lectura: string // ISO, hora de la lectura GPS
  tipo: TipoHidrante
  estado: EstadoHidrante
  foto: Blob
}

/** Fila del historial a importar desde la planilla */
export interface FilaImportada {
  id?: string
  lat: number
  lng: number
  precision_m?: number | null
  tipo: TipoHidrante
  estado: EstadoHidrante
  foto_url?: string | null
  cargado_por_nombre?: string | null
  created_at?: string | null
}

// ---------- Guardias de Fiestas ----------
export interface FiestaGuardia {
  id: string
  nombre: string
  fecha: string // YYYY-MM-DD
  franja: ShiftType
  bomberos: number
  familiares: number
}

export interface FiestasEstado {
  guardias: FiestaGuardia[]
  mias: Record<string, number> // guardia -> familiares
  abierta: boolean
}

export interface FiestaDetalle {
  guardia_id: string
  nombre: string
  legajo: string | null
  dependencia: string | null
  familiares: number
  updated_at: string
}

export interface AuthState {
  email: string | null
  recovery: boolean
}

/** Todo lo que la app necesita del backend. Hay una versión real (Supabase) y una de demostración. */
export interface Api {
  demo: boolean
  getEmail(): Promise<string | null>
  onAuth(cb: (s: AuthState) => void): () => void
  /** Ingreso con legajo ("147/123") y clave */
  signIn(legajo: string, password: string): Promise<void>
  signUp(email: string, password: string, perfil: Perfil): Promise<{ needsConfirm: boolean }>
  resetPassword(email: string): Promise<void>
  updatePassword(password: string): Promise<void>
  signOut(): Promise<void>

  targetMonth(): Promise<string> // YYYY-MM-01
  cleanup(): Promise<void>
  loadCounts(month: string): Promise<Count[]>
  loadMine(month: string): Promise<Mine[]>
  subscribeCounts(cb: (c: Count) => void): () => void
  hold(date: string, type: ShiftType): Promise<string>
  release(date: string, type: ShiftType): Promise<void>
  confirm(): Promise<Shift[]>
  sendReport(): Promise<void>

  legajoDisponible(legajo: string): Promise<boolean>
  myProfile(): Promise<MiPerfil>
  updateMyProfile(p: Perfil): Promise<void>
  listUsers(): Promise<Usuario[]>
  setRole(userId: string, rol: Rol): Promise<void>
  setEstado(userId: string, estado: Estado): Promise<void>
  /** rol null quita el acceso a esa app */
  setAppAccess(userId: string, app: AppId, rol: AppRol | null): Promise<void>
  loadCalendar(month: string): Promise<CalEntry[]>

  listHidrantes(): Promise<Hidrante[]>
  /** Sube la foto y guarda la carga. Devuelve el ID del hidrante. */
  guardarHidrante(c: NuevaCarga): Promise<string>
  importarHidrantes(filas: FilaImportada[]): Promise<number>

  fiestasEstado(): Promise<FiestasEstado>
  fiestasReservar(guardia: string, familiares: number): Promise<void>
  fiestasCancelar(guardia: string): Promise<void>
  fiestasDetalle(): Promise<FiestaDetalle[]>
  fiestasSetAbierta(abierta: boolean): Promise<void>
  /** Da permiso de usuario en esa app a todas las cuentas activas que no lo tienen. Devuelve cuántas. */
  habilitarATodos(app: AppId): Promise<number>
  /** userId null quita esa función de la guardia */
  setFuncion(date: string, type: ShiftType, funcion: Funcion, userId: string | null): Promise<void>
}
