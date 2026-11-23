-- =====================================================================
-- TOMA DE LOTES: pedidos/SKU cargados desde Excel + lotes tomados en piso
-- =====================================================================
-- Cómo usarlo: Supabase Dashboard → SQL Editor → pegar todo → Run.
-- Es seguro ejecutarlo varias veces (no duplica nada).
--
-- Cada fila = un SKU dentro de un pedido.
--   id    → 'PEDIDO|SKU' (lo arma la app). Así la regla "un pedido no puede
--           tener 2 veces el mismo SKU" la garantiza la llave primaria, también
--           cuando se carga sin internet y se sube después.
--   lotes → lista de lotes del SKU (0, 1 o más; sin límite)
-- =====================================================================

create table if not exists public.toma_lotes (
  id                    text primary key,
  ruta                  text,
  cliente               text,
  pedido                text not null,
  sku                   text not null,
  lotes                 text[] not null default '{}',
  registrado_por_id     uuid,
  registrado_por_nombre text,
  fecha_registro        timestamptz not null default now(),
  lotes_por_id          uuid,
  lotes_por_nombre      text,
  lotes_actualizado_en  timestamptz,
  constraint toma_lotes_pedido_sku_unico unique (pedido, sku)
);

-- Detalle de cada lote: [{ lote, fecha, por_id, por_nombre, origen }]
--   fecha  → cuándo se escaneó / registró ese lote
--   origen → BARRAS | OCR | FOTO | MANUAL | EXCEL
alter table public.toma_lotes add column if not exists lotes_detalle jsonb not null default '[]'::jsonb;

create index if not exists toma_lotes_fecha_idx on public.toma_lotes (fecha_registro desc);
create index if not exists toma_lotes_pedido_idx on public.toma_lotes (pedido);

-- Seguridad: cualquier usuario con sesión puede ver, cargar y registrar lotes
alter table public.toma_lotes enable row level security;

drop policy if exists "toma_lotes_select" on public.toma_lotes;
create policy "toma_lotes_select" on public.toma_lotes
  for select to authenticated using (true);

drop policy if exists "toma_lotes_insert" on public.toma_lotes;
create policy "toma_lotes_insert" on public.toma_lotes
  for insert to authenticated with check (true);

drop policy if exists "toma_lotes_update" on public.toma_lotes;
create policy "toma_lotes_update" on public.toma_lotes
  for update to authenticated using (true) with check (true);

-- Tiempo real
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'toma_lotes'
  ) then
    alter publication supabase_realtime add table public.toma_lotes;
  end if;
  alter table public.toma_lotes replica identity full;
end $$;
