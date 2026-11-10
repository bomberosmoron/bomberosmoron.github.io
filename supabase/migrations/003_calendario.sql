-- =====================================================================
-- App Guardias · Calendario imprimible para la jefatura
-- Ejecutalo en Supabase > SQL Editor DESPUÉS de 001 y 002.
-- =====================================================================

-- Quiénes pueden ver y generar el calendario completo.
create table if not exists public.admins (
  email text primary key
);
alter table public.admins enable row level security;
-- Nadie la lee ni la escribe desde la app: se carga desde el panel de Supabase.

-- Para dar acceso a alguien de la jefatura (cambiá el mail):
-- insert into public.admins (email) values ('jefatura@ejemplo.com');

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where lower(email) = lower(auth.jwt() ->> 'email'))
$$;

-- Nombre como aparece en la planilla: "Apellido I." (ej. "Lopez E.").
-- Sale de los datos que la persona carga al crear la cuenta.
-- Si no los cargó, se usa la parte del mail antes de la @.
create or replace function public.display_name(p_user uuid) returns text
  language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    nullif(trim(
      initcap(trim(u.raw_user_meta_data ->> 'apellido')) ||
      case when coalesce(trim(u.raw_user_meta_data ->> 'nombre'), '') <> ''
           then ' ' || upper(left(trim(u.raw_user_meta_data ->> 'nombre'), 1)) || '.'
           else '' end
    ), ''),
    split_part(u.email, '@', 1)
  )
  from auth.users u where u.id = p_user
$$;

-- Todas las guardias CONFIRMADAS de un mes, con el nombre de cada persona.
-- Solo la puede usar la jefatura.
create or replace function public.calendar_month(p_month date default null)
  returns table (shift_date date, shift_type text, nombre text)
  language plpgsql stable security definer set search_path = public as $$
declare v_month date := date_trunc('month', coalesce(p_month, target_month()))::date;
begin
  if not is_admin() then raise exception 'Solo la jefatura puede ver el calendario completo'; end if;
  return query
    select r.shift_date, r.shift_type, display_name(r.user_id)
      from reservations r
     where r.status = 'confirmed'
       and r.shift_date >= v_month and r.shift_date < v_month + interval '1 month'
     order by r.shift_date, r.shift_type, 3;
end $$;

revoke all on function public.is_admin()            from public, anon;
revoke all on function public.display_name(uuid)    from public, anon, authenticated;
revoke all on function public.calendar_month(date)  from public, anon;
grant execute on function public.is_admin()           to authenticated;
grant execute on function public.calendar_month(date) to authenticated;
