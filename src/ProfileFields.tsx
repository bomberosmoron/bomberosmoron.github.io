import type { Dependencia } from './lib/types'

export const DEPENDENCIAS: Dependencia[] = ['CM', 'Dto 1', 'Dto 2']
export const LEGAJO_PREFIJO = '147/'

export interface PerfilDraft {
  nombre: string
  apellido: string
  legajoNum: string // solo los números después de 147/
  dependencia: Dependencia | ''
}

export const emptyDraft: PerfilDraft = { nombre: '', apellido: '', legajoNum: '', dependencia: '' }

/** Revisa los datos y devuelve el error a mostrar, o null si están bien */
export function validar(d: PerfilDraft): string | null {
  if (!d.nombre.trim() || !d.apellido.trim()) return 'Completá nombre y apellido.'
  if (!/^\d{1,5}$/.test(d.legajoNum.trim())) return 'Escribí el número de legajo que va después de 147/ (solo números).'
  if (!d.dependencia) return 'Elegí tu dependencia.'
  return null
}

export const legajoDe = (d: PerfilDraft) => LEGAJO_PREFIJO + d.legajoNum.trim()

/** Campos de nombre, apellido, legajo y dependencia. Se usan al crear la cuenta y en "Mis datos". */
export default function ProfileFields({ value, onChange }: { value: PerfilDraft; onChange: (v: PerfilDraft) => void }) {
  const set = (patch: Partial<PerfilDraft>) => onChange({ ...value, ...patch })
  return (
    <>
      <div className="pair">
        <label>
          Nombre
          <input id="nombre" required autoComplete="given-name" value={value.nombre} onChange={(e) => set({ nombre: e.target.value })} />
        </label>
        <label>
          Apellido
          <input id="apellido" required autoComplete="family-name" value={value.apellido} onChange={(e) => set({ apellido: e.target.value })} />
        </label>
      </div>

      <label>
        Legajo
        <span className="legajo">
          <span className="legajo-pre" aria-hidden="true">{LEGAJO_PREFIJO}</span>
          <input
            id="legajo"
            required
            inputMode="numeric"
            pattern="\d{1,5}"
            maxLength={5}
            aria-label="Número de legajo, después de 147/"
            placeholder="123"
            value={value.legajoNum}
            onChange={(e) => set({ legajoNum: e.target.value.replace(/\D/g, '') })}
          />
        </span>
      </label>

      <fieldset className="dep">
        <legend>Dependencia</legend>
        <div className="dep-options">
          {DEPENDENCIAS.map((d) => (
            <label key={d} className={value.dependencia === d ? 'on' : ''}>
              <input type="radio" name="dependencia" id={`dep-${d}`} value={d} checked={value.dependencia === d} onChange={() => set({ dependencia: d })} />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  )
}
