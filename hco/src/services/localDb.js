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

// v5: Préstamos de pallets offline (lectura en caché + cola de escrituras en sync_queue)
// Clave = uuid del préstamo. Los creados sin internet usan uuid 'local_...' hasta sincronizar.
localDb.version(5).stores({
  prestamos: 'uuid, id_prestamo, estado, fecha_entrega, _sincronizado'
});

// v6: Oficina Logística (puestos del plano isométrico con estado en vivo)
// Clave = código del puesto ('A1', 'B3'...). Cambios offline van a sync_queue como UPSERT.
localDb.version(6).stores({
  oficina_puestos: 'id, empleado_id, estado, _sincronizado'
});

// v7: Toma de Lotes (pedido + SKU cargados por Excel, lotes tomados en piso)
// Clave = 'PEDIDO|SKU' → un pedido no puede repetir SKU. Cambios offline van a sync_queue.
localDb.version(7).stores({
  toma_lotes: 'id, pedido, sku, ruta, fecha_registro, _sincronizado'
});
