import Dexie from 'dexie';

// 1. Inicializamos la base de datos local
export const localDb = new Dexie('HCO_OfflineDB');

// 2. Definimos las tablas y sus índices (el primer valor es la clave primaria)
localDb.version(1).stores({
  usuarios: 'id, dni, usuario, estado', 
  areas: 'id, nombre',
  cargos: 'id, nombre',
  jefes: 'id, nombre',
  sync_queue: '++id, tabla, operacion, payload'
});
