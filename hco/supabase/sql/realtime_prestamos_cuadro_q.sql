-- =====================================================================
-- ACTIVAR TIEMPO REAL (Supabase Realtime) PARA PRÉSTAMOS Y CUADRO Q
-- =====================================================================
-- Cómo usarlo: Supabase Dashboard → SQL Editor → pegar todo → Run.
-- Es seguro ejecutarlo varias veces (no duplica nada).
--
-- Qué hace:
--  1. Agrega las tablas a la publicación `supabase_realtime`, que es la que
--     escucha la app (hook useSupabaseRealtime).
--  2. REPLICA IDENTITY FULL: en UPDATE/DELETE el evento trae la fila completa
--     anterior (incluido `uuid` de préstamos), necesario para quitar/actualizar
--     la fila correcta en pantalla.
--
-- Importante (seguridad): Realtime respeta las políticas RLS de cada tabla.
-- Cada usuario solo recibe eventos de filas que puede leer con SELECT.
-- =====================================================================

do $$
declare
  t text;
begin
  foreach t in array array['prestamos', 'cuadro_q'] loop
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

-- Verificación: deben aparecer 'prestamos' y 'cuadro_q'
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;

-- ---------------------------------------------------------------------
-- Fase 2 (MHE y Sugerencias): ver realtime_fase2_mhe_sugerencias.sql
-- ---------------------------------------------------------------------
