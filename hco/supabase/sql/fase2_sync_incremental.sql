-- =========================================================================================
-- FASE 2: SINCRONIZACIÓN INCREMENTAL (bajar el Egress)
-- =========================================================================================
-- La app descarga cada tabla COMPLETA una sola vez por dispositivo y después solo pide las filas
-- que cambiaron (updated_at > última sincronización). Para eso cada tabla necesita:
--   1. Columna `updated_at` que se actualiza SOLA en cada INSERT/UPDATE (trigger).
--   2. Índice en `updated_at` (la consulta "qué cambió" es instantánea).
-- Y para las tablas donde SÍ se eliminan registros (toma_lotes):
--   3. Bitácora `registros_eliminados` para que los demás dispositivos sepan qué borrar.
--
-- Se puede correr ANTES o DESPUÉS de publicar el frontend: si la columna aún no existe, la app
-- sigue funcionando como antes (descarga completa). Se puede correr varias veces sin problema.
-- =========================================================================================


-- 1 y 2. updated_at + trigger + índice --------------------------------------------------------
create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['prestamos', 'inspecciones', 'toma_lotes'] loop
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
    execute format('drop trigger if exists trg_%s_updated_at on public.%I', t, t);
    execute format('create trigger trg_%s_updated_at before insert or update on public.%I
                    for each row execute function public.tocar_updated_at()', t, t);
    execute format('create index if not exists idx_%s_updated_at on public.%I (updated_at)', t, t);
  end loop;
end;
$$;


-- 3. Bitácora de eliminados -------------------------------------------------------------------
create table if not exists public.registros_eliminados (
  id            bigint generated always as identity primary key,
  tabla         text        not null,
  registro_id   text        not null,
  eliminado_en  timestamptz not null default now()
);

create index if not exists idx_registros_eliminados_tabla_fecha
  on public.registros_eliminados (tabla, eliminado_en);

alter table public.registros_eliminados enable row level security;

drop policy if exists "registros_eliminados_select" on public.registros_eliminados;
create policy "registros_eliminados_select" on public.registros_eliminados
  for select to authenticated using (true);
-- Sin política de INSERT: solo escribe el trigger (security definer).

create or replace function public.registrar_eliminacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.registros_eliminados (tabla, registro_id)
  values (tg_table_name, old.id::text);
  return old;
end;
$$;

drop trigger if exists trg_toma_lotes_eliminado on public.toma_lotes;
create trigger trg_toma_lotes_eliminado
  after delete on public.toma_lotes
  for each row execute function public.registrar_eliminacion();


-- OPCIONAL (mantenimiento, p. ej. una vez al mes): borrar la bitácora de más de 90 días.
-- delete from public.registros_eliminados where eliminado_en < now() - interval '90 days';
