import Dexie from 'dexie';

export const localDb = new Dexie('HCO_OfflineDB');

// ¡CAMBIAR AQUÍ A version(2)!
localDb.version(2).stores({
  usuarios: 'id, dni, usuario, estado', 
  areas: 'id, nombre',
  cargos: 'id, nombre',
  jefes: 'id, nombre',
  roles: 'id, nombre', 
  sync_queue: '++id, tabla, operacion, payload'
});