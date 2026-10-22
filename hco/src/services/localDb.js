import Dexie from 'dexie';

export const localDb = new Dexie('HCO_OfflineDB');

localDb.version(4).stores({
  usuarios: 'id, dni, usuario, estado', 
  areas: 'id, nombre',
  cargos: 'id, nombre',
  jefes: 'id, nombre',
  roles: 'id, nombre', 
  sync_queue: '++id, tabla, operacion, payload',

  // Tablas locales para Cuadro Q
  cuadro_q: 'id, id_cuadro_q, estado, area_error, fecha_registro',

  // Tablas locales para MHE (PIV)
  inspecciones: 'id, equipo_id, usuario_id, fecha_hora, estado_proceso, _sincronizado',
  respuestas_inspeccion: '++local_id, inspeccion_id, item_id, _sincronizado',
  categorias_equipos: 'id, nombre',
  equipos: 'id, serie, categoria_id',
  items_checklist: 'id, categoria_id, seccion',

  // Tabla local para Tarjetas de Sugerencias
  tarjetas_sugerencias: 'id, id_sugerencia, estado, area_registro_id, area_responsable_id, usuario_registro_id, responsable_id, fecha_registro, _sincronizado'
});
