// Campo de texto con botón de escáner (barras + texto). Reutilizable en cualquier módulo:
//   <CampoEscaner value={v} onChange={setV} placeholder="Lote" />
// - Escribe en MAYÚSCULAS.
// - Al leer con la cámara llama a onChange(valor) y luego a onCapture(captura) si se pasa.
// - Si el OCR dudó entre varias lecturas, muestra chips para elegir la correcta.
import { forwardRef, lazy, Suspense, useState } from 'react';
import { useMotoresEscaner } from './motoresEscaner';
import './escaner.css';

// La cámara solo se descarga cuando se usa por primera vez (la pantalla abre más rápido)
const EscanerCamara = lazy(() => import('./EscanerCamara.jsx'));

const IconoEscaner = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <line x1="7" y1="12" x2="17" y2="12" />
  </svg>
);

const CampoEscaner = forwardRef(function CampoEscaner(
  { value, onChange, onCapture, placeholder = 'Escanea código o captura texto...', id, disabled, className = '', invalido, ...rest },
  ref,
) {
  // Precarga los motores al mostrar el campo: cuando el usuario toque el botón ya están listos
  useMotoresEscaner();
  const [abierto, setAbierto] = useState(false);
  const [candidatos, setCandidatos] = useState([]);

  const manejarCaptura = (captura) => {
    const valor = String(captura.valor || '').trim().toUpperCase();
    onChange?.(valor);
    setCandidatos((captura.candidatos || []).length > 1 ? captura.candidatos.map((c) => String(c).toUpperCase()) : []);
    onCapture?.({ ...captura, valor });
  };

  return (
    <div className={`tl-campo ${className}`}>
      <div className="tl-input-group">
        <input
          ref={ref}
          id={id}
          type="text"
          className={`tl-input ${invalido ? 'tl-input-invalido' : ''}`}
          value={value}
          onChange={(e) => {
            setCandidatos([]);
            onChange?.(e.target.value.toUpperCase());
          }}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={disabled}
          {...rest}
        />
        <button
          type="button"
          className="tl-scan-btn"
          onClick={() => setAbierto(true)}
          disabled={disabled}
          title="Escanear con la cámara"
          aria-label="Escanear con la cámara"
        >
          <IconoEscaner />
        </button>
      </div>

      {candidatos.length > 1 && (
        <div className="tl-chips">
          <span className="tl-chips-label">¿No es correcto? Elige:</span>
          {candidatos.map((c) => (
            <button
              type="button"
              key={c}
              className={`tl-chip ${c === value ? 'active' : ''}`}
              onClick={() => onChange?.(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {abierto && (
        <Suspense fallback={null}>
          <EscanerCamara onCapture={manejarCaptura} onClose={() => setAbierto(false)} />
        </Suspense>
      )}
    </div>
  );
});

export default CampoEscaner;
