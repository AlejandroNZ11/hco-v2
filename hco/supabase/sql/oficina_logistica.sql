-- =====================================================================
-- OFICINA LOGÍSTICA: puestos de la oficina con estado en vivo
-- =====================================================================
-- Cómo usarlo: Supabase Dashboard → SQL Editor → pegar todo → Run.
-- Es seguro ejecutarlo varias veces (no duplica nada).
--
-- Cada fila = un escritorio del plano isométrico (A1..C8, OF1 y OF2).
--   empleado_id → quién se sienta ahí (null = puesto libre)
--   estado      → en_oficina | almuerzo | en_campo | reunion | ausente | salida
--   tipo        → puesto | impresora | botiquin | vacio (se cambia desde la app cada mes)
-- =====================================================================

create table if not exists public.oficina_puestos (
  id              text primary key,
  empleado_id     uuid references public.empleados(id) on delete set null,
  estado          text not null default 'en_oficina',
  nota            text,
  tipo            text not null default 'puesto',
  actualizado_por uuid,
  actualizado_en  timestamptz not null default now()
);

-- Si la tabla ya existía sin la columna tipo, se agrega
alter table public.oficina_puestos add column if not exists tipo text not null default 'puesto';
alter table public.oficina_puestos drop constraint if exists oficina_puestos_tipo_check;
alter table public.oficina_puestos add constraint oficina_puestos_tipo_check
  check (tipo in ('puesto', 'impresora', 'botiquin', 'vacio'));

-- Estados permitidos (incluye almuerzo y salida)
alter table public.oficina_puestos drop constraint if exists oficina_puestos_estado_check;
alter table public.oficina_puestos add constraint oficina_puestos_estado_check
  check (estado in ('en_oficina', 'almuerzo', 'en_campo', 'reunion', 'ausente', 'salida'));

-- Un empleado solo puede ocupar un puesto
create unique index if not exists oficina_puestos_empleado_unico
  on public.oficina_puestos (empleado_id)
  where empleado_id is not null;

-- Sitios del plano: 3 líneas x 4 sitios por lado (A1..C8) + oficinas cerradas (OF1, OF2).
-- El tipo inicial es 'puesto'; luego cada sitio se marca desde la app.
insert into public.oficina_puestos (id, tipo) values
  ('A1', 'puesto'), ('A2', 'puesto'), ('A3', 'puesto'), ('A4', 'puesto'),
  ('A5', 'puesto'), ('A6', 'puesto'), ('A7', 'impresora'), ('A8', 'puesto'),
  ('B1', 'puesto'), ('B2', 'puesto'), ('B3', 'puesto'), ('B4', 'puesto'),
  ('B5', 'puesto'), ('B6', 'puesto'), ('B7', 'puesto'), ('B8', 'vacio'),
  ('C1', 'puesto'), ('C2', 'puesto'), ('C3', 'puesto'), ('C4', 'puesto'),
  ('C5', 'puesto'), ('C6', 'puesto'), ('C7', 'puesto'), ('C8', 'botiquin'),
  ('OF1', 'puesto'), ('OF2', 'puesto')
on conflict (id) do nothing; -- no pisa lo que ya se cambió desde la app

-- Seguridad: cualquier usuario con sesión puede ver y actualizar los puestos
alter table public.oficina_puestos enable row level security;

drop policy if exists "oficina_puestos_select" on public.oficina_puestos;
create policy "oficina_puestos_select" on public.oficina_puestos
  for select to authenticated using (true);

drop policy if exists "oficina_puestos_insert" on public.oficina_puestos;
create policy "oficina_puestos_insert" on public.oficina_puestos
  for insert to authenticated with check (true);

drop policy if exists "oficina_puestos_update" on public.oficina_puestos;
create policy "oficina_puestos_update" on public.oficina_puestos
  for update to authenticated using (true) with check (true);

-- Tiempo real
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'oficina_puestos'
  ) then
    alter publication supabase_realtime add table public.oficina_puestos;
  end if;
  alter table public.oficina_puestos replica identity full;
end $$;
