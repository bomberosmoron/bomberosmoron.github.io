// Reglas que muestra la app. Las que realmente se aplican están en la base de datos
// (supabase/migrations/001_guardias.sql). Si cambiás una, cambiá las dos.
export const MAX_POR_GUARDIA = 7
export const MAX_POR_PERSONA = 6
export const MINUTOS_RETENCION = 10

export const NOMBRE_CUARTEL = 'Cuartel Central'

// Opcional: horario de cada franja, se muestra debajo del nombre. Ej: '8 a 20 h'
export const HORARIO: Record<'dia' | 'noche', string> = {
  dia: '',
  noche: '',
}
