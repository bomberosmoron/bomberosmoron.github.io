-- =====================================================================
-- Plataforma · HidraMap: relevamiento de hidrantes
-- Ejecutalo en Supabase > SQL Editor DESPUÉS de 006.
-- =====================================================================
-- Reglas (las mismas de la app de Apps Script):
--   * Tipo 63 o 114. Estado: Operativo, No operativo o No se encuentra.
--   * Foto obligatoria (se guarda en Supabase Storage, bucket "hidrantes").
--   * Ubicación SOLO por GPS, con precisión de ±30 m o mejor y lectura de hace menos de 3 minutos.
--   * Cada carga queda firmada con quién la hizo y la fecha y hora del servidor.
--   * Desde la app no se editan ni se borran cargas.
-- Permisos: app 'hidramap' en app_access (usuario = carga y ve el mapa; admin = además importa y exporta).
-- =====================================================================

create table if not exists public.hidrantes (
  id                  text primary key default substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  lat                 double precision not null check (lat between -90 and 90),
  lng                 double precision not null check (lng between -180 and 180),
  precision_m         int check (precision_m is null or precision_m >= 0),
  tipo                text not null check (tipo in ('63', '114')),
  estado              text not null check (estado in ('Operativo', 'No operativo', 'No se encuentra')),
  foto_path           text,          -- foto en Storage (cargas nuevas)
  foto_url            text,          -- foto externa (historial importado: link de Drive)
  cargado_por         uuid references auth.users(id) on delete set null,
  cargado_por_nombre  text,          -- "Apellido I." o el usuario viejo de HidraMap
  created_at          timestamptz not null default now(),
  origen              text not null default 'app' check (origen in ('app', 'importado'))
);
create index if not exists hidrantes_fecha_idx on public.hidrantes (created_at desc);
create index if not exists hidrantes_autor_idx on public.hidrantes (cargado_por);

alter table public.hidrantes enable row level security;
drop policy if exists "ver hidrantes con acceso a hidramap" on public.hidrantes;
create policy "ver hidrantes con acceso a hidramap" on public.hidrantes
  for select to authenticated using (app_role('hidramap') is not null);
grant select on public.hidrantes to authenticated;

-- ---------- Fotos: bucket público de solo lectura ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hidrantes', 'hidrantes', true, 8388608, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 8388608, allowed_mime_types = array['image/jpeg'];

-- Cada persona sube solo a su propia carpeta (<su id>/...) y solo si tiene acceso a HidraMap
drop policy if exists "subir fotos de hidrantes" on storage.objects;
create policy "subir fotos de hidrantes" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'hidrantes'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.app_role('hidramap') is not null
  );

-- ---------- Guardar una carga ----------
create or replace function public.guardar_hidrante(
  p_lat double precision, p_lng double precision, p_precision int, p_lectura timestamptz,
  p_tipo text, p_estado text, p_foto_path text
) returns text
  language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  perform require_app('hidramap');
  if p_tipo not in ('63', '114') then raise exception 'Elegí el tipo: 63 o 114'; end if;
  if p_estado not in ('Operativo', 'No operativo', 'No se encuentra') then raise exception 'Elegí el estado'; end if;
  if p_lat is null or p_lng is null then raise exception 'Falta la ubicación GPS'; end if;
  if p_precision is null or p_precision > 30 then
    raise exception 'El GPS todavía no es preciso (hace falta ±30 m o mejor). Esperá unos segundos al aire libre.';
  end if;
  if p_lectura is null or p_lectura < now() - interval '3 minutes' or p_lectura > now() + interval '1 minute' then
    raise exception 'La ubicación es vieja. Volvé a tomar el GPS.';
  end if;
  if coalesce(p_foto_path, '') = '' then raise exception 'Falta la foto'; end if;
  if split_part(p_foto_path, '/', 1) <> auth.uid()::text then raise exception 'Foto inválida'; end if;

  loop
    v_id := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    exit when not exists (select 1 from hidrantes where id = v_id);
  end loop;

  insert into hidrantes (id, lat, lng, precision_m, tipo, estado, foto_path, cargado_por, cargado_por_nombre)
  values (v_id, round(p_lat::numeric, 6), round(p_lng::numeric, 6), p_precision, p_tipo, p_estado,
          p_foto_path, auth.uid(), display_name(auth.uid()));
  return v_id;
end $$;

-- ---------- Importar el historial (planilla "BDD HidraMap BVM") ----------
-- Recibe un arreglo JSON de filas: {id, lat, lng, precision_m, tipo, estado, foto_url, cargado_por_nombre, created_at}
-- Las filas con un id que ya existe se saltean. Devuelve cuántas se agregaron.
create or replace function public.importar_hidrantes(p_filas jsonb) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if app_role('hidramap') is distinct from 'admin' then
    raise exception 'Solo los administradores de HidraMap pueden importar';
  end if;
  insert into hidrantes (id, lat, lng, precision_m, tipo, estado, foto_url, cargado_por_nombre, created_at, origen)
  select coalesce(nullif(f->>'id', ''), substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
         (f->>'lat')::double precision, (f->>'lng')::double precision,
         nullif(f->>'precision_m', '')::int,
         f->>'tipo', f->>'estado', nullif(f->>'foto_url', ''), nullif(f->>'cargado_por_nombre', ''),
         coalesce(nullif(f->>'created_at', '')::timestamptz, now()), 'importado'
    from jsonb_array_elements(p_filas) f
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.guardar_hidrante(double precision, double precision, int, timestamptz, text, text, text) from public, anon;
revoke all on function public.importar_hidrantes(jsonb) from public, anon;
grant execute on function public.guardar_hidrante(double precision, double precision, int, timestamptz, text, text, text) to authenticated;
grant execute on function public.importar_hidrantes(jsonb) to authenticated;
