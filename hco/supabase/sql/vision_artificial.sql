-- =====================================================================
-- VISIÓN ARTIFICIAL 24/7: EPP, Conteo de objetos y Conteo de personal (aforo)
-- =====================================================================
-- Cómo usarlo: Supabase Dashboard → SQL Editor → pegar todo → Run.
-- Es seguro ejecutarlo varias veces (no duplica nada).
--
-- Quién escribe:
--   * La app: la IA corre en el celular y el usuario con sesión inserta los
--     eventos a su nombre (registrado_por = auth.uid()). Las fotos de EPP van a
--     Drive por la Edge Function `subir-drive` (destino "vision").
--   * A futuro, el backend opcional (vision-backend/) puede insertar con la
--     SERVICE_ROLE key, que omite RLS.
--   * La app también puede marcar una infracción como revisada y ajustar el aforo.
--
-- Cero imágenes en Supabase: las fotos van a Google Drive y aquí solo se
-- guarda el enlace (https://lh3.googleusercontent.com/d/{file_id}).
--
-- Tablas:
--   vision_epp_infracciones → 1 fila por infracción de EPP (con foto)
--   vision_conteos          → conteo AGREGADO por cámara, clase y hora
--   vision_aforo_eventos    → 1 fila por cruce (INGRESO / SALIDA) o ajuste
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) EPP: infracciones "No Conforme"
-- ---------------------------------------------------------------------
create table if not exists public.vision_epp_infracciones (
  id             uuid primary key default gen_random_uuid(),
  hora           timestamptz not null default now(),   -- momento de la infracción
  camara_id      text not null,                        -- nombre/ID de la cámara
  area           text,                                 -- área de la planta
  track_id       integer,                              -- ID del tracker (ByteTrack)
  estado         text not null default 'No Conforme',
  epp_faltantes  text[] not null default '{}',         -- ej. {casco,chaleco}
  foto_url       text,                                 -- enlace lh3 de Drive
  drive_file_id  text,
  segundos_sin_epp numeric(6,1),                       -- cuánto llevaba sin EPP al alertar
  registrado_por uuid,                                 -- usuario cuyo celular detectó la infracción
  revisado       boolean not null default false,       -- lo marca un supervisor
  revisado_por   uuid,
  revisado_en    timestamptz,
  constraint vision_epp_estado_chk check (estado in ('No Conforme', 'Conforme'))
);

-- Si la tabla ya existía de una versión anterior de este script
alter table public.vision_epp_infracciones add column if not exists registrado_por uuid;

create index if not exists vision_epp_hora_idx   on public.vision_epp_infracciones (hora desc);
create index if not exists vision_epp_camara_idx on public.vision_epp_infracciones (camara_id, hora desc);


-- ---------------------------------------------------------------------
-- 2) Conteo de objetos (agregado por hora)
--    NO se inserta una fila por unidad: la app suma cada ~15 s con
--    vision_sumar_conteo(). Así se cuida la cuota de Realtime del plan Free.
-- ---------------------------------------------------------------------
create table if not exists public.vision_conteos (
  id             uuid primary key default gen_random_uuid(),
  camara_id      text not null,
  area           text,
  clase          text not null,              -- caja, botella, pallet, producto…
  hora           timestamptz not null,       -- inicio de la hora (date_trunc('hour'))
  cantidad       integer not null default 0,
  actualizado_en timestamptz not null default now(),
  constraint vision_conteos_unico unique (camara_id, clase, hora)
);

create index if not exists vision_conteos_hora_idx on public.vision_conteos (hora desc);

-- Suma atómica: si dos backends/cámaras escriben a la vez, no se pierden unidades.
create or replace function public.vision_sumar_conteo(
  p_camara_id text,
  p_area      text,
  p_clase     text,
  p_hora      timestamptz,
  p_cantidad  integer
) returns void
language sql
-- security definer: la tabla no acepta inserts directos desde la app; solo se puede
-- sumar a través de esta función (con search_path fijo para que sea segura)
security definer
set search_path = public
as $$
  insert into public.vision_conteos (camara_id, area, clase, hora, cantidad, actualizado_en)
  -- cantidad acotada (1–10.000 por envío) para que nadie infle los conteos por error
  select p_camara_id, p_area, p_clase, date_trunc('hour', p_hora), p_cantidad, now()
  where (auth.role() = 'service_role' or auth.uid() is not null)
    and p_cantidad between 1 and 10000
  on conflict (camara_id, clase, hora)
  do update set cantidad       = public.vision_conteos.cantidad + excluded.cantidad,
                area           = coalesce(excluded.area, public.vision_conteos.area),
                actualizado_en = now();
$$;

-- Pueden sumar los usuarios con sesión (la IA del celular) y el backend opcional
revoke all on function public.vision_sumar_conteo(text, text, text, timestamptz, integer) from public, anon;
grant execute on function public.vision_sumar_conteo(text, text, text, timestamptz, integer) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 3) Aforo de personal
--    delta: +1 INGRESO, -1 SALIDA, ±n AJUSTE manual.
--    Aforo actual = suma(delta) del día por área (lo calcula React en vivo).
-- ---------------------------------------------------------------------
create table if not exists public.vision_aforo_eventos (
  id             uuid primary key default gen_random_uuid(),
  hora           timestamptz not null default now(),
  camara_id      text not null,
  area           text,
  tipo           text not null,
  delta          integer not null,
  track_id       integer,
  registrado_por uuid,           -- usuario cuyo celular registró el cruce (o que hizo el ajuste)
  nota           text,
  constraint vision_aforo_tipo_chk check (tipo in ('INGRESO', 'SALIDA', 'AJUSTE')),
  constraint vision_aforo_delta_chk check (
    (tipo = 'INGRESO' and delta = 1) or
    (tipo = 'SALIDA'  and delta = -1) or
    (tipo = 'AJUSTE'  and delta <> 0)
  )
);

create index if not exists vision_aforo_hora_idx on public.vision_aforo_eventos (hora desc);
create index if not exists vision_aforo_area_idx on public.vision_aforo_eventos (area, hora desc);


-- ---------------------------------------------------------------------
-- Seguridad (RLS): cualquier usuario con sesión puede LEER todo e insertar
-- eventos a su propio nombre.
-- ---------------------------------------------------------------------
alter table public.vision_epp_infracciones enable row level security;
alter table public.vision_conteos          enable row level security;
alter table public.vision_aforo_eventos    enable row level security;

drop policy if exists "vision_epp_select" on public.vision_epp_infracciones;
create policy "vision_epp_select" on public.vision_epp_infracciones
  for select to authenticated using (true);

-- Marcar como revisado (el resto de columnas no se toca desde la app)
drop policy if exists "vision_epp_insert" on public.vision_epp_infracciones;
create policy "vision_epp_insert" on public.vision_epp_infracciones
  for insert to authenticated
  with check (registrado_por = auth.uid() and estado = 'No Conforme');

drop policy if exists "vision_epp_update" on public.vision_epp_infracciones;
create policy "vision_epp_update" on public.vision_epp_infracciones
  for update to authenticated using (true) with check (true);

-- Privilegio por columna: desde la app solo se pueden cambiar estas 3 columnas
revoke update on public.vision_epp_infracciones from authenticated;
grant update (revisado, revisado_por, revisado_en) on public.vision_epp_infracciones to authenticated;

drop policy if exists "vision_conteos_select" on public.vision_conteos;
create policy "vision_conteos_select" on public.vision_conteos
  for select to authenticated using (true);

drop policy if exists "vision_aforo_select" on public.vision_aforo_eventos;
create policy "vision_aforo_select" on public.vision_aforo_eventos
  for select to authenticated using (true);

-- La app inserta INGRESO / SALIDA (IA del celular) y AJUSTES manuales, a su propio nombre
drop policy if exists "vision_aforo_insert_ajuste" on public.vision_aforo_eventos;
drop policy if exists "vision_aforo_insert" on public.vision_aforo_eventos;
create policy "vision_aforo_insert" on public.vision_aforo_eventos
  for insert to authenticated
  with check (registrado_por = auth.uid());


-- ---------------------------------------------------------------------
-- Tiempo real (Supabase Realtime)
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['vision_epp_infracciones', 'vision_conteos', 'vision_aforo_eventos'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;

    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- Limpieza opcional: borra eventos con más de N días (por defecto 90).
-- Ejecutar a mano:   select public.vision_purgar_antiguos(90);
-- Las fotos de Drive NO se borran (hay que limpiar la carpeta aparte).
-- ---------------------------------------------------------------------
create or replace function public.vision_purgar_antiguos(p_dias integer default 90)
returns void
language sql
as $$
  delete from public.vision_epp_infracciones where hora < now() - make_interval(days => p_dias);
  delete from public.vision_conteos          where hora < now() - make_interval(days => p_dias);
  delete from public.vision_aforo_eventos    where hora < now() - make_interval(days => p_dias);
$$;

revoke all on function public.vision_purgar_antiguos(integer) from public, anon, authenticated;
grant execute on function public.vision_purgar_antiguos(integer) to service_role;


-- Verificación: deben aparecer las 3 tablas vision_*
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename like 'vision_%'
order by tablename;
