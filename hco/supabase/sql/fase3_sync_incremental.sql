-- =========================================================================================
-- FASE 3: SINCRONIZACIÓN INCREMENTAL para tarjetas_sugerencias, cuadro_q y lup
-- =========================================================================================
-- Requiere haber corrido antes supabase/sql/fase2_sync_incremental.sql (crea las funciones
-- tocar_updated_at() y registrar_eliminacion() y la tabla registros_eliminados).
--
-- Igual que en la Fase 2: se puede correr antes o después de publicar el frontend y varias
-- veces sin problema. Sin estas columnas la app sigue descargando todo como antes.
-- =========================================================================================

do $$
declare
  t text;
begin
  foreach t in array array['tarjetas_sugerencias', 'cuadro_q', 'lup'] loop
    -- updated_at automático + índice (la consulta "qué cambió" es instantánea)
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
    execute format('drop trigger if exists trg_%s_updated_at on public.%I', t, t);
    execute format('create trigger trg_%s_updated_at before insert or update on public.%I
                    for each row execute function public.tocar_updated_at()', t, t);
    execute format('create index if not exists idx_%s_updated_at on public.%I (updated_at)', t, t);

    -- La app no elimina en estas tablas, pero si alguien borra desde el panel de Supabase,
    -- la bitácora avisa a los celulares para que también lo quiten de su caché.
    execute format('drop trigger if exists trg_%s_eliminado on public.%I', t, t);
    execute format('create trigger trg_%s_eliminado after delete on public.%I
                    for each row execute function public.registrar_eliminacion()', t, t);
  end loop;
end;
$$;
