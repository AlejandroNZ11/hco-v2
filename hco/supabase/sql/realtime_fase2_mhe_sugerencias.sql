-- =====================================================================
-- FASE 2: ACTIVAR TIEMPO REAL PARA MHE (PIV) Y TARJETAS DE SUGERENCIAS
-- =====================================================================
-- Cómo usarlo: Supabase Dashboard → SQL Editor → pegar todo → Run.
-- Es seguro ejecutarlo varias veces (no duplica nada).
-- (La fase 1 —prestamos y cuadro_q— está en realtime_prestamos_cuadro_q.sql)
--
-- Tablas:
--   inspecciones          → Tracking MHE (nuevas inspecciones, aprobaciones)
--   equipos               → Tracking MHE (equipo habilitado / bloqueado)
--   tarjetas_sugerencias  → Tracking, Pizarra y Dashboard de Sugerencias
--
-- REPLICA IDENTITY FULL: en UPDATE/DELETE el evento trae la fila anterior
-- completa, para poder quitar/actualizar la fila correcta en pantalla.
--
-- Seguridad: Realtime respeta RLS; cada usuario solo recibe eventos de las
-- filas que puede leer con SELECT.
-- =====================================================================

do $$
declare
  t text;
begin
  foreach t in array array['inspecciones', 'equipos', 'tarjetas_sugerencias'] loop
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

-- Verificación: deben aparecer las 5 tablas
-- (cuadro_q, equipos, inspecciones, prestamos, tarjetas_sugerencias)
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;
