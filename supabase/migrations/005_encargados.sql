-- =====================================================================
-- App Guardias · Encargado y ayudante de cada guardia
-- Ejecutalo en Supabase > SQL Editor DESPUÉS de 001 a 004.
-- =====================================================================
-- Reglas:
--   * El administrador elige al encargado (obligatorio) y al ayudante (opcional)
--     entre las personas con la guardia CONFIRMADA.
--   * Uno de cada uno por guardia. La misma persona no puede ser las dos cosas.
--   * Siguen contando dentro de los 7 lugares de la guardia.
--   * Si alguien se baja de la guardia, su función se va con la reserva.
-- =====================================================================

alter table public.reservations
  add column if not exists funcion text check (funcion in ('encargado', 'ayudante'));

-- Un encargado y un ayudante como máximo por guardia
create unique index if not exists reservations_una_funcion_por_guardia
  on public.reservations (shift_date, shift_type, funcion) where funcion is not null;

-- ---------- Calendario: ahora devuelve quién es quién ----------
drop function if exists public.calendar_month(date);
create function public.calendar_month(p_month date default null)
  returns table (shift_date date, shift_type text, user_id uuid, nombre text, funcion text)
  language plpgsql stable security definer set search_path = public as $$
declare v_month date := date_trunc('month', coalesce(p_month, target_month()))::date;
begin
  if not is_admin() then raise exception 'Solo los administradores pueden ver el calendario completo'; end if;
  return query
    select r.shift_date, r.shift_type, r.user_id, display_name(r.user_id), r.funcion
      from reservations r
     where r.status = 'confirmed'
       and r.shift_date >= v_month and r.shift_date < v_month + interval '1 month'
     order by r.shift_date, r.shift_type, 4;
end $$;

-- ---------- Asignar o quitar una función ----------
-- p_user = null quita esa función de la guardia.
create or replace function public.set_funcion(p_date date, p_type text, p_funcion text, p_user uuid)
  returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo los administradores pueden asignar encargados'; end if;
  if p_funcion not in ('encargado', 'ayudante') then raise exception 'Función inválida'; end if;
  perform pg_advisory_xact_lock(hashtext('slot:' || p_date::text || ':' || p_type));

  if p_user is not null and not exists (
       select 1 from reservations
        where user_id = p_user and shift_date = p_date and shift_type = p_type and status = 'confirmed') then
    raise exception 'Esa persona no tiene esta guardia confirmada';
  end if;

  -- Libera la función en esta guardia (y la que tuviera la persona elegida)
  update reservations set funcion = null
   where shift_date = p_date and shift_type = p_type
     and (funcion = p_funcion or (p_user is not null and user_id = p_user));

  if p_user is not null then
    update reservations set funcion = p_funcion
     where user_id = p_user and shift_date = p_date and shift_type = p_type;
  end if;
end $$;

revoke all on function public.calendar_month(date)                 from public, anon;
revoke all on function public.set_funcion(date, text, text, uuid)  from public, anon;
grant execute on function public.calendar_month(date)                to authenticated;
grant execute on function public.set_funcion(date, text, text, uuid) to authenticated;
