-- =====================================================================
-- Plataforma virtual de Bomberos de Morón · Login único y permisos por app
-- Ejecutalo en Supabase > SQL Editor DESPUÉS de 001 a 005.
-- =====================================================================
-- Cambios:
--   * Cada cuenta tiene un ESTADO: pendiente (recién creada), activo o baja.
--     Las cuentas que ya existían quedan activas.
--   * Permisos POR APP (tabla app_access): guardias, fiestas, hidramap.
--     Cada persona puede ser 'usuario' o 'admin' en cada app, o no tener acceso.
--   * profiles.rol pasa a ser el rol en la PLATAFORMA:
--       usuario  · sin tareas de administración
--       admin    · aprueba cuentas y asigna permisos por app
--       super    · además nombra administradores; tiene acceso total a todas las apps
--   * Ingreso con legajo y clave (login_legajo), con bloqueo tras 5 intentos.
--   * Guardias exige tener permiso en la app 'guardias'.
-- =====================================================================

-- ---------- Estado de cada cuenta ----------
alter table public.profiles
  add column if not exists estado text not null default 'activo'
    check (estado in ('pendiente', 'activo', 'baja'));
alter table public.profiles alter column estado set default 'pendiente';   -- las nuevas arrancan pendientes
alter table public.profiles add column if not exists aprobado_por uuid references auth.users(id) on delete set null;
alter table public.profiles add column if not exists aprobado_at timestamptz;

-- ---------- Permisos por app ----------
create table if not exists public.app_access (
  user_id     uuid not null references auth.users(id) on delete cascade,
  app         text not null check (app in ('guardias', 'fiestas', 'hidramap')),
  rol         text not null check (rol in ('usuario', 'admin')),
  updated_at  timestamptz not null default now(),
  primary key (user_id, app)
);
alter table public.app_access enable row level security;

-- Quien ya usaba Guardias conserva el acceso. Los admin de Guardias siguen siendo admin de Guardias
-- y pasan a "usuario" en la plataforma (el superusuario decide quién administra la plataforma).
insert into public.app_access (user_id, app, rol)
select id, 'guardias', case when rol = 'admin' then 'admin' else 'usuario' end
  from public.profiles where rol <> 'super'
on conflict (user_id, app) do nothing;
update public.profiles set rol = 'usuario' where rol = 'admin';

-- ---------- Funciones de permisos ----------
create or replace function public.my_estado() returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select estado from profiles where id = auth.uid()), 'pendiente')
$$;

-- Administrador de la plataforma (aprueba cuentas y asigna permisos)
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select my_role() in ('admin', 'super') and my_estado() = 'activo'
$$;

-- Rol en una app: 'admin', 'usuario' o null (sin acceso). El superusuario es admin en todas.
create or replace function public.app_role(p_app text) returns text
  language sql stable security definer set search_path = public as $$
  select case
    when my_estado() <> 'activo' then null
    when my_role() = 'super' then 'admin'
    else (select rol from app_access where user_id = auth.uid() and app = p_app)
  end
$$;

create or replace function public.require_app(p_app text) returns void
  language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Tenés que iniciar sesión'; end if;
  if my_estado() = 'pendiente' then raise exception 'Tu cuenta todavía no fue aprobada'; end if;
  if my_estado() = 'baja' then raise exception 'Tu cuenta está dada de baja'; end if;
  if app_role(p_app) is null then raise exception 'No tenés acceso a esta app. Pedíselo a un administrador.'; end if;
end $$;

-- ---------- Ingreso con legajo y clave ----------
create table if not exists public.login_intentos (
  legajo          text primary key,
  fallas          int not null default 0,
  bloqueado_hasta timestamptz
);
alter table public.login_intentos enable row level security;   -- solo la usan las funciones

-- Verifica legajo + clave. Si es correcta devuelve el mail para iniciar sesión;
-- si no, un mensaje de error. Nunca revela el mail de alguien con clave incorrecta.
create or replace function public.login_legajo(p_legajo text, p_clave text)
  returns table (email text, error text)
  language plpgsql volatile security definer set search_path = public, extensions, auth as $$
declare
  v_leg  text := trim(p_legajo);
  v_user record;
  v_int  record;
begin
  select * into v_int from login_intentos where legajo = v_leg;
  if v_int.bloqueado_hasta is not null and v_int.bloqueado_hasta > now() then
    return query select null::text, format('Demasiados intentos. Probá de nuevo en %s minutos.',
      ceil(extract(epoch from v_int.bloqueado_hasta - now()) / 60)::int);
    return;
  end if;

  select u.email as mail, u.encrypted_password as hash, p.estado
    into v_user
    from profiles p join auth.users u on u.id = p.id
   where p.legajo = v_leg;

  if v_user.hash is null or extensions.crypt(p_clave, v_user.hash) <> v_user.hash then
    insert into login_intentos (legajo, fallas) values (v_leg, 1)
    on conflict (legajo) do update
      set fallas = case when login_intentos.bloqueado_hasta < now() then 1 else login_intentos.fallas + 1 end,
          bloqueado_hasta = null;
    update login_intentos set bloqueado_hasta = now() + interval '15 minutes', fallas = 0
     where legajo = v_leg and fallas >= 5;
    return query select null::text, 'Legajo o clave incorrectos'::text;
    return;
  end if;

  delete from login_intentos where legajo = v_leg;
  if v_user.estado = 'baja' then
    return query select null::text, 'Tu cuenta está dada de baja. Consultá con la jefatura.'::text;
    return;
  end if;
  return query select v_user.mail::text, null::text;
end $$;

-- ---------- Mis datos (con estado y permisos) ----------
drop function if exists public.my_profile();
create function public.my_profile()
  returns table (email text, nombre text, apellido text, legajo text, dependencia text,
                 rol text, estado text, apps jsonb)
  language sql stable security definer set search_path = public as $$
  select p.email, p.nombre, p.apellido, p.legajo, p.dependencia, p.rol, p.estado,
         case when p.estado <> 'activo' then '{}'::jsonb
              when p.rol = 'super' then '{"guardias":"admin","fiestas":"admin","hidramap":"admin"}'::jsonb
              else coalesce((select jsonb_object_agg(a.app, a.rol) from app_access a where a.user_id = p.id), '{}'::jsonb)
         end
    from profiles p where p.id = auth.uid()
$$;

-- ---------- Administración de usuarios ----------
drop function if exists public.list_users();
create function public.list_users()
  returns table (id uuid, email text, nombre text, apellido text, legajo text, dependencia text,
                 rol text, estado text, apps jsonb, guardias int, created_at timestamptz)
  language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo los administradores pueden ver el listado'; end if;
  return query
    select p.id, p.email, p.nombre, p.apellido, p.legajo, p.dependencia, p.rol, p.estado,
           coalesce((select jsonb_object_agg(a.app, a.rol) from app_access a where a.user_id = p.id), '{}'::jsonb),
           (select count(*)::int from reservations r
             where r.user_id = p.id and r.status = 'confirmed'
               and r.shift_date >= target_month() and r.shift_date < target_month() + interval '1 month'),
           p.created_at
      from profiles p
     order by (p.estado = 'pendiente') desc, p.apellido nulls last, p.nombre;
end $$;

-- Aprobar, volver a pendiente o dar de baja una cuenta
create or replace function public.set_estado(p_user uuid, p_estado text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo los administradores pueden aprobar cuentas'; end if;
  if p_estado not in ('pendiente', 'activo', 'baja') then raise exception 'Estado inválido'; end if;
  if p_user = auth.uid() then raise exception 'No podés cambiar el estado de tu propia cuenta'; end if;
  if (select rol from profiles where id = p_user) = 'super' and my_role() <> 'super' then
    raise exception 'Solo un superusuario puede cambiar a otro superusuario';
  end if;
  update profiles
     set estado = p_estado,
         aprobado_por = case when p_estado = 'activo' then auth.uid() else aprobado_por end,
         aprobado_at  = case when p_estado = 'activo' then now() else aprobado_at end
   where id = p_user;
  if not found then raise exception 'No existe ese usuario'; end if;
end $$;

-- Dar, cambiar o quitar el permiso de una app (p_rol null = sin acceso)
create or replace function public.set_app_access(p_user uuid, p_app text, p_rol text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo los administradores pueden asignar permisos'; end if;
  if p_app not in ('guardias', 'fiestas', 'hidramap') then raise exception 'App inválida'; end if;
  if p_rol is not null and p_rol not in ('usuario', 'admin') then raise exception 'Rol inválido'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'No existe ese usuario'; end if;
  if p_rol is null then
    delete from app_access where user_id = p_user and app = p_app;
  else
    insert into app_access (user_id, app, rol) values (p_user, p_app, p_rol)
    on conflict (user_id, app) do update set rol = excluded.rol, updated_at = now();
  end if;
end $$;

-- ---------- Guardias: ahora exige permiso en la app ----------
create or replace function public.hold_shift(p_date date, p_type text) returns timestamptz
  language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_month  date := target_month();
  v_until  timestamptz;
  v_n      int;
begin
  perform require_app('guardias');
  if p_type not in ('dia', 'noche') then raise exception 'Franja inválida'; end if;
  if p_date < v_month or p_date >= (v_month + interval '1 month') then
    raise exception 'Solo se pueden cargar guardias del mes siguiente';
  end if;

  perform cleanup_expired();
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

  select min(held_until) into v_until from reservations where user_id = v_uid and status = 'held';
  if v_until is null then
    v_until := now() + make_interval(mins => cfg_minutos_retencion());
  end if;

  insert into reservations (user_id, user_email, shift_date, shift_type, status, held_until)
  values (v_uid, auth.jwt() ->> 'email', p_date, p_type, 'held', v_until);
  return v_until;
end $$;

create or replace function public.confirm_shifts()
  returns table (shift_date date, shift_type text)
  language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  perform require_app('guardias');
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

-- Calendario y encargados: administradores de Guardias (y superusuario)
create or replace function public.calendar_month(p_month date default null)
  returns table (shift_date date, shift_type text, user_id uuid, nombre text, funcion text)
  language plpgsql stable security definer set search_path = public as $$
declare v_month date := date_trunc('month', coalesce(p_month, target_month()))::date;
begin
  if app_role('guardias') is distinct from 'admin' then
    raise exception 'Solo los administradores de Guardias pueden ver el calendario completo';
  end if;
  return query
    select r.shift_date, r.shift_type, r.user_id, display_name(r.user_id), r.funcion
      from reservations r
     where r.status = 'confirmed'
       and r.shift_date >= v_month and r.shift_date < v_month + interval '1 month'
     order by r.shift_date, r.shift_type, 4;
end $$;

create or replace function public.set_funcion(p_date date, p_type text, p_funcion text, p_user uuid)
  returns void
  language plpgsql security definer set search_path = public as $$
begin
  if app_role('guardias') is distinct from 'admin' then
    raise exception 'Solo los administradores de Guardias pueden asignar encargados';
  end if;
  if p_funcion not in ('encargado', 'ayudante') then raise exception 'Función inválida'; end if;
  perform pg_advisory_xact_lock(hashtext('slot:' || p_date::text || ':' || p_type));

  if p_user is not null and not exists (
       select 1 from reservations
        where user_id = p_user and shift_date = p_date and shift_type = p_type and status = 'confirmed') then
    raise exception 'Esa persona no tiene esta guardia confirmada';
  end if;

  update reservations set funcion = null
   where shift_date = p_date and shift_type = p_type
     and (funcion = p_funcion or (p_user is not null and user_id = p_user));
  if p_user is not null then
    update reservations set funcion = p_funcion
     where user_id = p_user and shift_date = p_date and shift_type = p_type;
  end if;
end $$;

-- ---------- Permisos ----------
revoke all on function public.my_estado()                         from public, anon;
revoke all on function public.app_role(text)                      from public, anon;
revoke all on function public.require_app(text)                   from public, anon;
revoke all on function public.login_legajo(text, text)            from public;
revoke all on function public.my_profile()                        from public, anon;
revoke all on function public.list_users()                        from public, anon;
revoke all on function public.set_estado(uuid, text)              from public, anon;
revoke all on function public.set_app_access(uuid, text, text)    from public, anon;
grant execute on function public.my_estado()                      to authenticated;
grant execute on function public.app_role(text)                   to authenticated;
grant execute on function public.require_app(text)                to authenticated;
grant execute on function public.login_legajo(text, text)         to anon, authenticated;
grant execute on function public.my_profile()                     to authenticated;
grant execute on function public.list_users()                     to authenticated;
grant execute on function public.set_estado(uuid, text)           to authenticated;
grant execute on function public.set_app_access(uuid, text, text) to authenticated;
