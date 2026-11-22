-- =====================================================================
-- GENERAR RDR: registros de discrepancias cargados desde Excel
-- =====================================================================
-- Cómo usarlo: Supabase Dashboard → SQL Editor → pegar todo → Run.
-- Es seguro ejecutarlo varias veces (no duplica nada).
--
-- Cada fila = una línea del Excel de carga:
--   FECHA | COSTO | SN | OBSERVACION | HORA | QTY | OBSERVACION (código) | OBD
--   fecha          → la FECHA que viene en el Excel
--   fecha_registro → cuándo se subió a HCO (distinta a fecha)
--   lote_carga     → identifica qué registros se subieron juntos en un mismo Excel
-- =====================================================================

create table if not exists public.generar_rdr (
  id                 uuid primary key default gen_random_uuid(),
  fecha              date,
  costo              text not null,
  sn                 text,
  observacion        text,
  hora               text,
  qty                text,
  codigo             text,          -- 2da columna OBSERVACION del Excel (ej. 200)
  obd                text,
  orden              integer,       -- n° de fila en el Excel (mantiene el orden en el RDR)
  lote_carga         uuid,
  registrado_por     uuid,
  nombre_registrador text,
  fecha_registro     timestamptz not null default now()
);

-- Si la tabla ya existía sin alguna columna, se agrega
alter table public.generar_rdr add column if not exists orden integer;

create index if not exists generar_rdr_costo_idx on public.generar_rdr (costo);
create index if not exists generar_rdr_fecha_registro_idx on public.generar_rdr (fecha_registro desc);
create index if not exists generar_rdr_lote_idx on public.generar_rdr (lote_carga);

-- Seguridad: cualquier usuario con sesión puede ver, registrar y eliminar
alter table public.generar_rdr enable row level security;

drop policy if exists "generar_rdr_select" on public.generar_rdr;
create policy "generar_rdr_select" on public.generar_rdr
  for select to authenticated using (true);

drop policy if exists "generar_rdr_insert" on public.generar_rdr;
create policy "generar_rdr_insert" on public.generar_rdr
  for insert to authenticated with check (true);

drop policy if exists "generar_rdr_delete" on public.generar_rdr;
create policy "generar_rdr_delete" on public.generar_rdr
  for delete to authenticated using (true);
