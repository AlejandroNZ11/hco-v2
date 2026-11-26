-- =========================================================================================
-- SEGURIDAD DE empleados.cl (clave que el SUPERADMIN usa para recordársela al personal)
-- =========================================================================================
-- Correr en el SQL Editor de Supabase, en DOS PASOS y en este orden:
--
--   PASO 1: se puede correr ya mismo (no rompe nada de la versión actual de la app).
--   PASO 2: correrlo SOLO cuando la nueva versión del frontend ya esté publicada y los celulares
--           se hayan actualizado. La versión vieja hacía select('*') a empleados y, con el
--           PASO 2 aplicado, su login fallaría con "permission denied for column".
--
-- Si más adelante agregas una columna nueva a `empleados`, vuelve a correr el PASO 2
-- (si no, el navegador no podrá leer esa columna nueva).
-- =========================================================================================


-- =========================================================================================
-- PASO 1: función para leer la clave de UN empleado, solo si quien la pide es SUPERADMIN
-- =========================================================================================
create or replace function public.obtener_clave_empleado(p_empleado_id uuid)
returns text
language plpgsql
security definer          -- corre con permisos del dueño: puede leer `cl` aunque el usuario no
set search_path = public
as $$
declare
  v_rol text;
  v_cl  text;
begin
  select upper(trim(rol)) into v_rol
  from public.empleados
  where id = auth.uid();

  if coalesce(v_rol, '') <> 'SUPERADMIN' then
    raise exception 'No autorizado para ver claves' using errcode = '42501';
  end if;

  select cl into v_cl
  from public.empleados
  where id = p_empleado_id;

  return v_cl;
end;
$$;

revoke all on function public.obtener_clave_empleado(uuid) from public, anon;
grant execute on function public.obtener_clave_empleado(uuid) to authenticated;


-- =========================================================================================
-- PASO 2: nadie puede LEER `cl` directamente por la API (solo con la función de arriba)
-- =========================================================================================
-- Se quita el permiso de lectura de toda la tabla y se vuelve a dar columna por columna,
-- a todas menos `cl`. Escribir `cl` (crear usuario, cambiar o restablecer clave) sigue
-- funcionando porque el permiso de UPDATE/INSERT no se toca.
--
-- anon (sin sesión) solo necesita lo que muestra la pantalla de Login (foto, nombre, rol).
do $$
declare
  v_columnas text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_columnas
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'empleados'
    and column_name <> 'cl';

  execute 'revoke select on public.empleados from anon, authenticated';
  execute format('grant select (%s) on public.empleados to authenticated', v_columnas);
  execute 'grant select (id, dni, usuario, nombre, rol, foto_url, estado) on public.empleados to anon';
end;
$$;


-- =========================================================================================
-- COMPROBACIÓN (opcional): debe listar todas las columnas menos `cl` para authenticated,
-- y solo las 7 del Login para anon.
-- =========================================================================================
-- select grantee, column_name
-- from information_schema.column_privileges
-- where table_schema = 'public' and table_name = 'empleados' and privilege_type = 'SELECT'
--   and grantee in ('anon', 'authenticated')
-- order by grantee, column_name;
