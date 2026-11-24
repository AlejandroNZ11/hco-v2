-- =====================================================================
-- ALMACÉN 3D y 2D: configuración editable del almacén
-- =====================================================================
-- Cómo usarlo: Supabase Dashboard → SQL Editor → pegar todo → Run.
-- Es seguro ejecutarlo varias veces (no duplica nada).
--
-- Una sola fila por almacén (id = 'principal'). La columna `config` (JSON)
-- guarda racks, profundidades, niveles, puentes, medidas y los cambios por
-- rack o por profundidad. Las ubicaciones (RR-PPP-N) se GENERAN desde aquí,
-- no se guardan una por una.
--
-- almacen_config_historial guarda una copia en cada cambio (para saber
-- quién cambió los niveles y poder volver atrás).
-- =====================================================================

create table if not exists public.almacen_config (
  id              text primary key,
  config          jsonb not null,
  actualizado_por uuid,
  actualizado_en  timestamptz not null default now()
);

create table if not exists public.almacen_config_historial (
  id              bigint generated always as identity primary key,
  almacen_id      text not null,
  config          jsonb not null,
  nota            text,
  actualizado_por uuid,
  actualizado_en  timestamptz not null default now()
);

create index if not exists almacen_config_historial_almacen
  on public.almacen_config_historial (almacen_id, actualizado_en desc);

-- Seguridad: cualquier usuario con sesión puede ver y editar
alter table public.almacen_config enable row level security;
alter table public.almacen_config_historial enable row level security;

drop policy if exists "almacen_config_select" on public.almacen_config;
create policy "almacen_config_select" on public.almacen_config
  for select to authenticated using (true);

drop policy if exists "almacen_config_insert" on public.almacen_config;
create policy "almacen_config_insert" on public.almacen_config
  for insert to authenticated with check (true);

drop policy if exists "almacen_config_update" on public.almacen_config;
create policy "almacen_config_update" on public.almacen_config
  for update to authenticated using (true) with check (true);

drop policy if exists "almacen_config_historial_select" on public.almacen_config_historial;
create policy "almacen_config_historial_select" on public.almacen_config_historial
  for select to authenticated using (true);

drop policy if exists "almacen_config_historial_insert" on public.almacen_config_historial;
create policy "almacen_config_historial_insert" on public.almacen_config_historial
  for insert to authenticated with check (true);
