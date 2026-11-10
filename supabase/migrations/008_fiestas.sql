-- =====================================================================
-- Plataforma · Guardias de Fiestas
-- Ejecutalo en Supabase > SQL Editor DESPUÉS de 007.
-- =====================================================================
-- Cada bombero se anota en las guardias especiales de las fiestas e indica
-- con cuántos familiares va (de 0 a 10). Puede cambiar la cantidad o cancelar
-- mientras la anotación esté abierta. Sin tope de personas por guardia.
-- Permisos: app 'fiestas' en app_access (admin = ve el detalle, exporta y abre/cierra la anotación).
-- =====================================================================

create table if not exists public.fiestas_guardias (
  id      text primary key,
  nombre  text not null,
  fecha   date not null,
  franja  text not null check (franja in ('dia', 'noche')),
  orden   int not null
);

-- Temporada 2026/2027. Para el año que viene, cambiá las fechas acá y vaciá las reservas.
insert into public.fiestas_guardias (id, nombre, fecha, franja, orden) values
  ('NB24',  'Nochebuena',  '2026-12-24', 'noche', 1),
  ('NAV25', 'Navidad',     '2026-12-25', 'dia',   2),
  ('FA31',  'Fin de Año',  '2026-12-31', 'noche', 3),
  ('AN01',  'Año Nuevo',   '2027-01-01', 'dia',   4)
on conflict (id) do update set nombre = excluded.nombre, fecha = excluded.fecha, franja = excluded.franja, orden = excluded.orden;

create table if not exists public.fiestas_config (
  id       int primary key default 1 check (id = 1),
  abierta  boolean not null default true
);
insert into public.fiestas_config (id, abierta) values (1, true) on conflict (id) do nothing;

create table if not exists public.fiestas_reservas (
  user_id     uuid not null references auth.users(id) on delete cascade,
  guardia_id  text not null references public.fiestas_guardias(id) on delete cascade,
  familiares  int  not null default 0 check (familiares between 0 and 10),
  updated_at  timestamptz not null default now(),
  primary key (user_id, guardia_id)
);

alter table public.fiestas_guardias enable row level security;
alter table public.fiestas_config   enable row level security;
alter table public.fiestas_reservas enable row level security;
drop policy if exists "ver guardias de fiestas" on public.fiestas_guardias;
create policy "ver guardias de fiestas" on public.fiestas_guardias for select to authenticated using (app_role('fiestas') is not null);
drop policy if exists "ver config de fiestas" on public.fiestas_config;
create policy "ver config de fiestas" on public.fiestas_config for select to authenticated using (app_role('fiestas') is not null);
drop policy if exists "ver mis reservas de fiestas" on public.fiestas_reservas;
create policy "ver mis reservas de fiestas" on public.fiestas_reservas for select to authenticated
  using (user_id = auth.uid() and app_role('fiestas') is not null);
grant select on public.fiestas_guardias, public.fiestas_config, public.fiestas_reservas to authenticated;

-- ---------- Totales por guardia (todos los que tienen acceso) ----------
create or replace function public.fiestas_resumen()
  returns table (id text, nombre text, fecha date, franja text, bomberos int, familiares int)
  language plpgsql stable security definer set search_path = public as $$
begin
  perform require_app('fiestas');
  return query
    select g.id, g.nombre, g.fecha, g.franja,
           count(r.user_id)::int, coalesce(sum(r.familiares), 0)::int
      from fiestas_guardias g left join fiestas_reservas r on r.guardia_id = g.id
     group by g.id order by g.orden;
end $$;

-- ---------- Anotarse (o cambiar la cantidad de familiares) ----------
create or replace function public.fiestas_reservar(p_guardia text, p_familiares int) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform require_app('fiestas');
  if not (select abierta from fiestas_config where id = 1) then
    raise exception 'La anotación para las fiestas está cerrada. Consultá con la jefatura.';
  end if;
  if not exists (select 1 from fiestas_guardias where id = p_guardia) then raise exception 'Esa guardia no existe'; end if;
  if p_familiares is null or p_familiares < 0 or p_familiares > 10 then
    raise exception 'La cantidad de familiares tiene que ser entre 0 y 10';
  end if;
  insert into fiestas_reservas (user_id, guardia_id, familiares) values (auth.uid(), p_guardia, p_familiares)
  on conflict (user_id, guardia_id) do update set familiares = excluded.familiares, updated_at = now();
end $$;

create or replace function public.fiestas_cancelar(p_guardia text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform require_app('fiestas');
  if not (select abierta from fiestas_config where id = 1) then
    raise exception 'La anotación para las fiestas está cerrada. Consultá con la jefatura.';
  end if;
  delete from fiestas_reservas where user_id = auth.uid() and guardia_id = p_guardia;
end $$;

-- ---------- Jefatura (administradores de Fiestas) ----------
create or replace function public.fiestas_detalle()
  returns table (guardia_id text, nombre text, legajo text, dependencia text, familiares int, updated_at timestamptz)
  language plpgsql stable security definer set search_path = public as $$
begin
  if app_role('fiestas') is distinct from 'admin' then raise exception 'Solo la jefatura puede ver el detalle'; end if;
  return query
    select r.guardia_id, display_name(r.user_id), p.legajo, p.dependencia, r.familiares, r.updated_at
      from fiestas_reservas r join profiles p on p.id = r.user_id
      join fiestas_guardias g on g.id = r.guardia_id
     order by g.orden, 2;
end $$;

create or replace function public.fiestas_set_abierta(p_abierta boolean) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if app_role('fiestas') is distinct from 'admin' then raise exception 'Solo la jefatura puede abrir o cerrar la anotación'; end if;
  update fiestas_config set abierta = p_abierta where id = 1;
end $$;

-- Da el permiso de una app (como usuario) a todas las cuentas activas que todavía no lo tienen.
-- Lo puede usar un administrador de la plataforma. Devuelve a cuántas personas se lo dio.
create or replace function public.habilitar_app_a_todos(p_app text) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'Solo los administradores de la plataforma pueden dar permisos'; end if;
  if p_app not in ('guardias', 'fiestas', 'hidramap') then raise exception 'App inválida'; end if;
  insert into app_access (user_id, app, rol)
  select p.id, p_app, 'usuario' from profiles p
   where p.estado = 'activo' and p.rol <> 'super'
  on conflict (user_id, app) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.fiestas_resumen()              from public, anon;
revoke all on function public.fiestas_reservar(text, int)     from public, anon;
revoke all on function public.fiestas_cancelar(text)          from public, anon;
revoke all on function public.fiestas_detalle()               from public, anon;
revoke all on function public.fiestas_set_abierta(boolean)    from public, anon;
revoke all on function public.habilitar_app_a_todos(text)     from public, anon;
grant execute on function public.fiestas_resumen()            to authenticated;
grant execute on function public.fiestas_reservar(text, int)  to authenticated;
grant execute on function public.fiestas_cancelar(text)       to authenticated;
grant execute on function public.fiestas_detalle()            to authenticated;
grant execute on function public.fiestas_set_abierta(boolean) to authenticated;
grant execute on function public.habilitar_app_a_todos(text)  to authenticated;
