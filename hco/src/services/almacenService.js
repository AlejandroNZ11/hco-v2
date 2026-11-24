import { supabase } from '../config/supabaseClient';
import { completarConfig, CONFIG_INICIAL } from '../features/almacen_3d/almacenModelo';

// Configuración del almacén: Supabase (tabla almacen_config) con copia local.
// Si la tabla aún no existe (falta ejecutar supabase/sql/almacen_3d.sql),
// todo sigue funcionando con la copia guardada en este navegador.

const TABLA = 'almacen_config';
const TABLA_HISTORIAL = 'almacen_config_historial';
const ALMACEN_ID = 'principal';
const CLAVE_LOCAL = 'almacen3d.config';

const leerLocal = () => {
  try {
    const t = localStorage.getItem(CLAVE_LOCAL);
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
};

const guardarLocal = (config) => {
  try {
    localStorage.setItem(CLAVE_LOCAL, JSON.stringify(config));
  } catch {
    /* sin espacio o modo privado: se ignora */
  }
};

/** Devuelve { config, origen: 'nube' | 'local' | 'inicial', aviso } */
export const cargarConfigAlmacen = async () => {
  const local = leerLocal();
  try {
    const { data, error } = await supabase
      .from(TABLA)
      .select('config, actualizado_en')
      .eq('id', ALMACEN_ID)
      .maybeSingle();
    if (error) throw error;
    if (data?.config) {
      guardarLocal(data.config);
      return { config: completarConfig(data.config), origen: 'nube', actualizadoEn: data.actualizado_en };
    }
    return { config: completarConfig(local || CONFIG_INICIAL), origen: local ? 'local' : 'inicial' };
  } catch (e) {
    return {
      config: completarConfig(local || CONFIG_INICIAL),
      origen: local ? 'local' : 'inicial',
      aviso: `No se pudo leer de Supabase (${e.message || e}). Se usa la copia de este navegador.`,
    };
  }
};

/** Guarda en Supabase (y siempre en local). Devuelve { ok, aviso }. */
export const guardarConfigAlmacen = async (config, nota = null) => {
  guardarLocal(config);
  try {
    const { data: u } = await supabase.auth.getUser();
    const fila = {
      id: ALMACEN_ID,
      config,
      actualizado_por: u?.user?.id ?? null,
      actualizado_en: new Date().toISOString(),
    };
    const { error } = await supabase.from(TABLA).upsert(fila);
    if (error) throw error;
    await supabase.from(TABLA_HISTORIAL).insert({
      almacen_id: ALMACEN_ID,
      config,
      nota,
      actualizado_por: fila.actualizado_por,
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      aviso: `Guardado solo en este navegador. Supabase: ${e.message || e}`,
    };
  }
};
