const ESTILOS = {
  en_vivo: { color: '#15803d', fondo: '#dcfce7', texto: 'En vivo' },
  conectando: { color: '#a16207', fondo: '#fef9c3', texto: 'Conectando…' },
  desconectado: { color: '#b91c1c', fondo: '#fee2e2', texto: 'Sin tiempo real' },
};

/**
 * Pequeña etiqueta que muestra si la pantalla está recibiendo cambios en tiempo real.
 * Recibe el estado que devuelve useSupabaseRealtime.
 */
export default function IndicadorEnVivo({ estado = 'conectando', style }) {
  const e = ESTILOS[estado] || ESTILOS.conectando;
  return (
    <span
      title={estado === 'en_vivo' ? 'Los cambios de otros usuarios aparecen automáticamente' : 'Los datos se actualizan al recargar'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: e.color,
        background: e.fondo,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: e.color,
          animation: estado === 'en_vivo' ? 'hcoPulso 1.6s ease-in-out infinite' : 'none',
        }}
      />
      {e.texto}
      <style>{'@keyframes hcoPulso{0%,100%{opacity:1}50%{opacity:.35}}'}</style>
    </span>
  );
}
