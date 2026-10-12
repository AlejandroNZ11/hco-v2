// Formatea una fecha de ISO (2026-10-12T10:00:00Z) a formato local (12/10/2026)
export const formatearFecha = (fechaIso) => {
  if (!fechaIso) return '';
  const fecha = new Date(fechaIso);
  return fecha.toLocaleDateString('es-PE'); // Formato de Perú
};

// Pone en mayúscula la primera letra de un texto
export const capitalizarTexto = (texto) => {
  if (!texto) return '';
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};
