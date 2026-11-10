import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Hidrante } from '../lib/types'
import { COLOR_ESTADO } from './util'

const CUARTEL: [number, number] = [-34.6505, -58.6195] // Morón

function base(el: HTMLElement, interactivo: boolean) {
  const map = L.map(el, {
    zoomControl: interactivo,
    dragging: interactivo,
    scrollWheelZoom: interactivo,
    doubleClickZoom: interactivo,
    touchZoom: interactivo,
    boxZoom: interactivo,
    keyboard: interactivo,
    attributionControl: true,
  }).setView(CUARTEL, 14)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(map)
  return map
}

/** Minimapa de solo lectura con la posición GPS actual */
export function MiniMapa({ lat, lng, precision }: { lat: number | null; lng: number | null; precision: number | null }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const capa = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!el.current) return
    map.current = base(el.current, false)
    capa.current = L.layerGroup().addTo(map.current)
    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    if (!map.current || !capa.current || lat == null || lng == null) return
    capa.current.clearLayers()
    if (precision) L.circle([lat, lng], { radius: precision, color: '#0277bd', weight: 1, fillOpacity: 0.12 }).addTo(capa.current)
    L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#0277bd', fillOpacity: 1 }).addTo(capa.current)
    map.current.setView([lat, lng], 18, { animate: false })
  }, [lat, lng, precision])

  return <div ref={el} className="hm-minimap" role="img" aria-label="Tu ubicación en el mapa" />
}

/** Mapa de todos los hidrantes */
export function MapaHidrantes({ items, onSelect, foco }: { items: Hidrante[]; onSelect: (h: Hidrante) => void; foco?: Hidrante | null }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const capa = useRef<L.LayerGroup | null>(null)
  const primera = useRef(true)

  useEffect(() => {
    if (!el.current) return
    map.current = base(el.current, true)
    capa.current = L.layerGroup().addTo(map.current)
    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    if (!map.current || !capa.current) return
    capa.current.clearLayers()
    for (const h of items) {
      L.circleMarker([h.lat, h.lng], { radius: 7, color: '#fff', weight: 2, fillColor: COLOR_ESTADO[h.estado], fillOpacity: 0.95 })
        .on('click', () => onSelect(h))
        .addTo(capa.current)
    }
    if (primera.current && items.length) {
      map.current.fitBounds(L.latLngBounds(items.map((h) => [h.lat, h.lng] as [number, number])), { padding: [24, 24], maxZoom: 16 })
      primera.current = false
    }
  }, [items, onSelect])

  useEffect(() => {
    if (foco && map.current) map.current.setView([foco.lat, foco.lng], Math.max(map.current.getZoom(), 17))
  }, [foco])

  return <div ref={el} className="hm-map" />
}
