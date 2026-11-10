import type { ShiftType } from './types'

const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d || 1)
}
const pad = (n: number) => String(n).padStart(2, '0')

export function nextMonthISO(): string {
  // Mes siguiente según la hora de Argentina
  const ar = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
  const d = new Date(ar.getFullYear(), ar.getMonth() + 1, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
}

export function monthEndISO(month: string): string {
  const d = parse(month)
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-01`
}

export function monthDays(month: string): string[] {
  const d = parse(month)
  const total = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return Array.from({ length: total }, (_, i) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(i + 1)}`)
}

export const monthName = (month: string) =>
  parse(month).toLocaleDateString('es-AR', { month: 'long' })

export const dayNumber = (iso: string) => parse(iso).getDate()
export const weekday = (iso: string) =>
  parse(iso).toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '')
export const weekdayIndex = (iso: string) => parse(iso).getDay() // 0 domingo
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
export const longDate = (iso: string) =>
  cap(parse(iso).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }))

export const shiftName = (t: ShiftType) => (t === 'dia' ? 'Diurna' : 'Nocturna')
export const key = (date: string, type: ShiftType) => `${date}|${type}`

export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${pad(s % 60)}`
}
