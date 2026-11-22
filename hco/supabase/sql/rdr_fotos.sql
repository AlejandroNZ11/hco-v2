-- =====================================================================
-- RDR FOTOS: URLs de las fotos (Google Drive) de cada costo del RDR
-- =====================================================================
-- Cómo usarlo: Supabase Dashboard → SQL Editor → pegar todo → Run.
-- Ejecutar DESPUÉS de generar_rdr.sql. Es seguro ejecutarlo varias veces.
--
-- Cada fila = una foto de un costo.
--   rdr_id → id (uuid) del costo en generar_rdr (su primer registro).
--            Si se elimina ese registro, sus fotos se eliminan también.
--   costo  → número de costo (para buscar rápido)
--   url    → enlace de la foto (ej. https://drive.google.com/file/d/.../view)
--   origen → hoja del Excel de fotos: Transferencia | Aéreos | Abollados
--   sku    → solo Abollados: primeros 10 caracteres de la columna S
-- =====================================================================

create table if not exists public.rdr_fotos (
  id                 uuid primary key default gen_random_uuid(),
  rdr_id             uuid not null references public.generar_rdr(id) on delete cascade,
  costo              text not null,
  url                text not null,
  origen             text,
  hoja               text,
  sku                text,
  fila               integer,       -- n° de fila en el Excel de fotos
  registrado_por     uuid,
  nombre_registrador text,
  fecha_registro     timestamptz not null default now(),
  constraint rdr_fotos_rdr_url_unico unique (rdr_id, url)
);

create index if not exists rdr_fotos_rdr_idx on public.rdr_fotos (rdr_id);
create index if not exists rdr_fotos_costo_idx on public.rdr_fotos (costo);

-- Seguridad: cualquier usuario con sesión puede ver, registrar y eliminar
alter table public.rdr_fotos enable row level security;

drop policy if exists "rdr_fotos_select" on public.rdr_fotos;
create policy "rdr_fotos_select" on public.rdr_fotos
  for select to authenticated using (true);

drop policy if exists "rdr_fotos_insert" on public.rdr_fotos;
create policy "rdr_fotos_insert" on public.rdr_fotos
  for insert to authenticated with check (true);

drop policy if exists "rdr_fotos_update" on public.rdr_fotos;
create policy "rdr_fotos_update" on public.rdr_fotos
  for update to authenticated using (true) with check (true);

drop policy if exists "rdr_fotos_delete" on public.rdr_fotos;
create policy "rdr_fotos_delete" on public.rdr_fotos
  for delete to authenticated using (true);
