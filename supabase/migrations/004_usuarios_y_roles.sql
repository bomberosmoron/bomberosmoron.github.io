-- =====================================================================
-- App Guardias · Datos de cada usuario y roles
-- Ejecutalo en Supabase > SQL Editor DESPUÉS de 001, 002 y 003.
-- =====================================================================
-- Roles:
--   usuario  carga sus guardias (todos arrancan así)
--   admin    además ve el calendario completo y el listado de usuarios
--   super    además nombra y quita administradores (el programador)
-- =====================================================================

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  nombre       text check (nombre is null or length(trim(nombre)) > 0),
  apellido     text check (apellido is null or length(trim(apellido)) > 0),
  legajo       text unique check (legajo is null or legajo ~ '^147/[0-9]{1,5}$'),
  dependencia  text check (dependencia is null or dependencia in ('CM', 'Dto 1', 'Dto 2')),
  rol          text not null default 'usuario' check (rol in ('usuario', 'admin', 'super')),
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- ---------- Alta automática del perfil al crear la cuenta ----------
-- Toma los datos que la app manda al registrarse. Si alguno falta o no es
-- válido, la cuenta se crea igual y la app le pide completarlos al ingresar.
create or replace function public.tg_new_profile() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}');
  v_leg text := nullif(trim(m ->> 'legajo'), '');
  v_dep text := nullif(trim(m ->> 'dependencia'), '');
begin
  if v_leg is not null and (v_leg !~ '^147/[0-9]{1,5}$' or exists (select 1 from profiles where legajo = v_leg)) then
    v_leg := null;
  end if;
  if v_dep is not null and v_dep not in ('CM', 'Dto 1', 'Dto 2') then v_dep := null; end if;

  insert into profiles (id, email, nombre, apellido, legajo, dependencia)
  values (new.id, new.email,
          nullif(trim(m ->> 'nombre'), ''), nullif(trim(m ->> 'apellido'), ''),
          v_leg, v_dep)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tg_new_profile();

-- Perfiles para las cuentas que ya existían
insert into public.profiles (id, email, nombre, apellido)
select u.id, u.email,
       nullif(trim(u.raw_user_meta_data ->> 'nombre'), ''),
       nullif(trim(u.raw_user_meta_data ->> 'apellido'), '')
  from auth.users u
on conflict (id) do nothing;

-- Si se usó la lista de jefatura del paso 003, esas personas pasan a ser admin
do $$
begin
  if to_regclass('public.admins') is not null then
    update public.profiles p set rol = 'admin'
      from public.admins a where lower(a.email) = lower(p.email) and p.rol = 'usuario';
  end if;
end $$;

-- ---------- Funciones de rol ----------
create or replace function public.my_role() returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select rol from profiles where id = auth.uid()), 'usuario')
$$;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select my_role() in ('admin', 'super')
$$;

drop table if exists public.admins;

-- ---------- Políticas ----------
drop policy if exists "ver mi perfil o todos si soy admin" on public.profiles;
create policy "ver mi perfil o todos si soy admin" on public.profiles
  for select to authenticated using (id = auth.uid() or is_admin());

-- ---------- Nombre en la planilla: "Apellido I." ----------
create or replace function public.display_name(p_user uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(trim(
      coalesce(initcap(trim(p.apellido)), '') ||
      case when coalesce(trim(p.nombre), '') <> '' then ' ' || upper(left(trim(p.nombre), 1)) || '.' else '' end
    ), ''),
    split_part(p.email, '@', 1)
  )
  from profiles p where p.id = p_user
$$;

-- ---------- Funciones que usa la app ----------

-- Antes de registrarse: ¿ese legajo ya tiene cuenta?
create or replace function public.legajo_disponible(p_legajo text) returns boolean
  language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles where legajo = trim(p_legajo))
$$;

-- Mis datos (incluye el rol, para que la app sepa qué mostrar)
create or replace function public.my_profile()
  returns table (email text, nombre text, apellido text, legajo text, dependencia text, rol text)
  language sql stable security definer set search_path = public as $$
  select p.email, p.nombre, p.apellido, p.legajo, p.dependencia, p.rol from profiles p where p.id = auth.uid()
$$;

-- Completar o corregir mis datos
create or replace function public.update_my_profile(p_nombre text, p_apellido text, p_legajo text, p_dependencia text)
  returns void
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Tenés que iniciar sesión'; end if;
  if coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_apellido), '') = '' then
    raise exception 'Completá nombre y apellido';
  end if;
  if trim(p_legajo) !~ '^147/[0-9]{1,5}$' then raise exception 'El legajo tiene que tener el formato 147/123'; end if;
  if p_dependencia not in ('CM', 'Dto 1', 'Dto 2') then raise exception 'Elegí una dependencia'; end if;
  if exists (select 1 from profiles where legajo = trim(p_legajo) and id <> auth.uid()) then
    raise exception 'El legajo % ya está registrado con otra cuenta', trim(p_legajo);
  end if;
  update profiles
     set nombre = trim(p_nombre), apellido = trim(p_apellido),
         legajo = trim(p_legajo), dependencia = p_dependencia
   where id = auth.uid();
end $$;

-- Listado de usuarios para administradores, con sus guardias confirmadas del mes que se carga
create or replace function public.list_users()
  returns table (id uuid, email text, nombre text, apellido text, legajo text, dependencia text,
                 rol text, guardias int, created_at timestamptz)
  language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Solo los administradores pueden ver el listado'; end if;
  return query
    select p.id, p.email, p.nombre, p.apellido, p.legajo, p.dependencia, p.rol,
           (select count(*)::int from reservations r
             where r.user_id = p.id and r.status = 'confirmed'
               and r.shift_date >= target_month() and r.shift_date < target_month() + interval '1 month'),
           p.created_at
      from profiles p
     order by p.apellido nulls last, p.nombre;
end $$;

-- Cambiar el rol de alguien. Solo el superusuario.
create or replace function public.set_role(p_user uuid, p_rol text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if my_role() <> 'super' then raise exception 'Solo el superusuario puede cambiar roles'; end if;
  if p_rol not in ('usuario', 'admin', 'super') then raise exception 'Rol inválido'; end if;
  perform pg_advisory_xact_lock(hashtext('roles'));
  if p_rol <> 'super'
     and (select rol from profiles where id = p_user) = 'super'
     and (select count(*) from profiles where rol = 'super') <= 1 then
    raise exception 'Tiene que quedar al menos un superusuario';
  end if;
  update profiles set rol = p_rol where id = p_user;
  if not found then raise exception 'No existe ese usuario'; end if;
end $$;

-- ---------- Permisos ----------
revoke all on function public.tg_new_profile()                          from public, anon, authenticated;
revoke all on function public.display_name(uuid)                        from public, anon, authenticated;
revoke all on function public.my_role()                                 from public, anon;
revoke all on function public.is_admin()                                from public, anon;
revoke all on function public.my_profile()                              from public, anon;
revoke all on function public.update_my_profile(text, text, text, text) from public, anon;
revoke all on function public.list_users()                              from public, anon;
revoke all on function public.set_role(uuid, text)                      from public, anon;
grant execute on function public.legajo_disponible(text)                  to anon, authenticated;
grant execute on function public.my_role()                                to authenticated;
grant execute on function public.is_admin()                               to authenticated;
grant execute on function public.my_profile()                             to authenticated;
grant execute on function public.update_my_profile(text, text, text, text) to authenticated;
grant execute on function public.list_users()                             to authenticated;
grant execute on function public.set_role(uuid, text)                     to authenticated;
grant select on public.profiles to authenticated;

-- =====================================================================
-- PRIMER SUPERUSUARIO
-- Registrate en la app con tu mail y después ejecutá (con tu mail):
--
--   update public.profiles set rol = 'super' where email = 'tu-mail@ejemplo.com';
--
-- Desde ahí, los administradores se nombran desde la app (pantalla Usuarios).
-- =====================================================================
