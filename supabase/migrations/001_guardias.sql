-- =====================================================================
-- App Guardias · Esquema de base de datos para Supabase
-- Pegá este archivo completo en Supabase > SQL Editor y ejecutalo.
-- =====================================================================
-- Reglas:
--   * Se cargan solo guardias del MES SIGUIENTE (hora de Argentina).
--   * Cada día tiene dos franjas: 'dia' (diurna) y 'noche' (nocturna).
--   * Máximo 7 personas por guardia.
--   * Máximo 6 guardias por persona en el mes.
--   * Al elegir una guardia, el lugar queda RETENIDO 10 minutos
--     (contados desde la primera guardia elegida). Si no confirma, se libera.
--   * Al confirmar, todas sus guardias pasan a 'confirmed' y ya no puede cambiarlas.
-- =====================================================================

-- ---------- Parámetros (cambiá los números acá si cambian las reglas) ----------
create or replace function public.cfg_max_por_guardia() returns int
  language sql immutable as $$ select 7 $$;
create or replace function public.cfg_max_por_persona() returns int
  language sql immutable as $$ select 6 $$;
create or replace function public.cfg_minutos_retencion() returns int
  language sql immutable as $$ select 10 $$;

-- Primer día del mes que se está cargando (el mes siguiente al actual).
create or replace function public.target_month() returns date
  language sql stable as $$
  select (date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')
          + interval '1 month')::date
$$;

-- ---------- Tablas ----------
create table if not exists public.reservations (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_email    text,
  shift_date    date not null,
  shift_type    text not null check (shift_type in ('dia', 'noche')),
  status        text not null default 'held' check (status in ('held', 'confirmed')),
  held_until    timestamptz,
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz,
  unique (user_id, shift_date, shift_type)
);
create index if not exists reservations_slot_idx on public.reservations (shift_date, shift_type);
create index if not exists reservations_held_idx on public.reservations (held_until) where status = 'held';

-- Ocupación de cada guardia. La mantiene un trigger y es la tabla que
-- escucha la app en tiempo real (así nadie ve quién reservó, solo cuántos).
create table if not exists public.slot_counts (
  shift_date  date not null,
  shift_type  text not null,
  taken       int  not null default 0,
  primary key (shift_date, shift_type)
);

create or replace function public.tg_slot_counts() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into slot_counts (shift_date, shift_type, taken)
    values (new.shift_date, new.shift_type, 1)
    on conflict (shift_date, shift_type) do update set taken = slot_counts.taken + 1;
  elsif tg_op = 'DELETE' then
    update slot_counts set taken = greatest(taken - 1, 0)
     where shift_date = old.shift_date and shift_type = old.shift_type;
  end if;
  return null;
end $$;

drop trigger if exists reservations_slot_counts on public.reservations;
create trigger reservations_slot_counts
  after insert or delete on public.reservations
  for each row execute function public.tg_slot_counts();

-- ---------- Seguridad (RLS) ----------
-- Nadie escribe directo en las tablas: todo pasa por las funciones de abajo,
-- que son las que aplican las reglas.
alter table public.reservations enable row level security;
alter table public.slot_counts  enable row level security;

drop policy if exists "ver mis reservas" on public.reservations;
create policy "ver mis reservas" on public.reservations
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "ver ocupacion" on public.slot_counts;
create policy "ver ocupacion" on public.slot_counts
  for select to authenticated using (true);

-- ---------- Funciones que usa la app ----------

-- Libera las retenciones vencidas. La llama la app, cada reserva y (opcional) pg_cron.
create or replace function public.cleanup_expired() returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from reservations where status = 'held' and held_until < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Retiene una guardia. Devuelve hasta cuándo dura la retención.
create or replace function public.hold_shift(p_date date, p_type text) returns timestamptz
  language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_month  date := target_month();
  v_until  timestamptz;
  v_n      int;
begin
  if v_uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  if p_type not in ('dia', 'noche') then raise exception 'Franja inválida'; end if;
  if p_date < v_month or p_date >= (v_month + interval '1 month') then
    raise exception 'Solo se pueden cargar guardias del mes siguiente';
  end if;

  perform cleanup_expired();

  -- Candados: primero el de la persona, después el de la guardia.
  -- Así, si dos personas van por el último lugar al mismo tiempo, una espera
  -- a la otra y solo una lo consigue.
  perform pg_advisory_xact_lock(hashtext('user:' || v_uid::text));
  perform pg_advisory_xact_lock(hashtext('slot:' || p_date::text || ':' || p_type));

  if exists (select 1 from reservations
              where user_id = v_uid and status = 'confirmed'
                and shift_date >= v_month and shift_date < v_month + interval '1 month') then
    raise exception 'Ya confirmaste tus guardias de este mes';
  end if;

  if exists (select 1 from reservations
              where user_id = v_uid and shift_date = p_date and shift_type = p_type) then
    raise exception 'Ya tenés esa guardia seleccionada';
  end if;

  select count(*) into v_n from reservations
   where user_id = v_uid and shift_date >= v_month and shift_date < v_month + interval '1 month';
  if v_n >= cfg_max_por_persona() then
    raise exception 'Llegaste al máximo de % guardias', cfg_max_por_persona();
  end if;

  select count(*) into v_n from reservations where shift_date = p_date and shift_type = p_type;
  if v_n >= cfg_max_por_guardia() then
    raise exception 'Esa guardia ya está completa';
  end if;

  -- Los 10 minutos corren desde la primera guardia elegida.
  select min(held_until) into v_until from reservations where user_id = v_uid and status = 'held';
  if v_until is null then
    v_until := now() + make_interval(mins => cfg_minutos_retencion());
  end if;

  insert into reservations (user_id, user_email, shift_date, shift_type, status, held_until)
  values (v_uid, auth.jwt() ->> 'email', p_date, p_type, 'held', v_until);

  return v_until;
end $$;

-- Suelta una guardia retenida (todavía no confirmada).
create or replace function public.release_shift(p_date date, p_type text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Tenés que iniciar sesión'; end if;
  delete from reservations
   where user_id = auth.uid() and shift_date = p_date and shift_type = p_type and status = 'held';
end $$;

-- Confirma todas las guardias retenidas. Devuelve la lista confirmada.
create or replace function public.confirm_shifts()
  returns table (shift_date date, shift_type text)
  language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  perform pg_advisory_xact_lock(hashtext('user:' || v_uid::text));
  perform cleanup_expired();

  if not exists (select 1 from reservations r where r.user_id = v_uid and r.status = 'held') then
    raise exception 'No tenés guardias para confirmar (puede que se haya vencido el tiempo)';
  end if;

  update reservations r
     set status = 'confirmed', confirmed_at = now(), held_until = null
   where r.user_id = v_uid and r.status = 'held';

  return query
    select r.shift_date, r.shift_type from reservations r
     where r.user_id = v_uid and r.status = 'confirmed'
       and r.shift_date >= target_month() and r.shift_date < target_month() + interval '1 month'
     order by r.shift_date, r.shift_type;
end $$;

-- ---------- Permisos ----------
revoke all on function public.hold_shift(date, text)     from public, anon;
revoke all on function public.release_shift(date, text)  from public, anon;
revoke all on function public.confirm_shifts()           from public, anon;
revoke all on function public.cleanup_expired()          from public, anon;
revoke all on function public.tg_slot_counts()           from public, anon, authenticated;
grant execute on function public.hold_shift(date, text)    to authenticated;
grant execute on function public.release_shift(date, text) to authenticated;
grant execute on function public.confirm_shifts()          to authenticated;
grant execute on function public.cleanup_expired()         to authenticated;
grant execute on function public.target_month()            to authenticated;
grant select on public.reservations, public.slot_counts    to authenticated;

-- ---------- Tiempo real ----------
-- La app escucha los cambios de ocupación para bloquear lugares al instante.
alter publication supabase_realtime add table public.slot_counts;
