import { useEffect, useMemo, useRef, useState } from 'react';
import { FaPlus, FaTimes, FaSave, FaTrashAlt } from 'react-icons/fa';
import CampoEscaner from '../../components/escaner/CampoEscaner';
import { detalleDeFila } from '../../services/tomaLotesService';

const CAMPOS_INICIALES = 5;
const ETIQUETA_ORIGEN = { BARRAS: 'Barras', OCR: 'Texto', FOTO: 'Foto', MANUAL: 'Manual', EXCEL: 'Excel' };

const vacio = () => ({ valor: '', fecha: null, origen: null });

// Cómo se leyó el lote, a partir del método que devuelve el escáner
const origenDeCaptura = (metodo = '') =>
  metodo.startsWith('BARRAS') ? 'BARRAS' : metodo.includes('FOTO') ? 'FOTO' : 'OCR';

const horaCorta = (iso) =>
  iso
    ? new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '')
    : '';

/**
 * Modal para registrar los lotes de un SKU de un pedido.
 * Pedido y SKU se muestran bloqueados. Cada lote se puede escribir, leer con
 * pistola (Enter pasa al siguiente) o escanear con la cámara (barras / texto).
 * Se guarda la fecha y hora en que se escaneó / registró cada lote.
 */
export default function ModalLotes({ registro, usuario, onCerrar, onGuardar }) {
  const previos = useMemo(() => detalleDeFila(registro), [registro]);
  const previosPorLote = useMemo(() => new Map(previos.map((d) => [d.lote, d])), [previos]);

  const inicial = useMemo(() => {
    const total = Math.max(CAMPOS_INICIALES, previos.length);
    return Array.from({ length: total }, (_, i) =>
      previos[i] ? { valor: previos[i].lote, fecha: previos[i].fecha, origen: previos[i].origen } : vacio(),
    );
  }, [previos]);

  const [items, setItems] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const refs = useRef([]);
  const enfocarRef = useRef(null);

  // Enfoca el primer campo vacío al abrir (listo para pistola o teclado)
  useEffect(() => {
    const i = inicial.findIndex((it) => !it.valor);
    const t = setTimeout(() => refs.current[i >= 0 ? i : 0]?.focus(), 60);
    return () => clearTimeout(t);
  }, [inicial]);

  // Enfoca el campo pedido luego de que React pinte (p. ej. tras agregar uno nuevo)
  useEffect(() => {
    if (enfocarRef.current == null) return;
    refs.current[enfocarRef.current]?.focus();
    enfocarRef.current = null;
  });

  const limpios = items.map((it) => it.valor.trim().toUpperCase());
  const repetidos = useMemo(() => {
    const cuenta = {};
    limpios.forEach((l) => l && (cuenta[l] = (cuenta[l] || 0) + 1));
    return new Set(Object.keys(cuenta).filter((k) => cuenta[k] > 1));
  }, [limpios]);
  const llenos = limpios.filter(Boolean);
  const hayCambios = limpios.join('|') !== inicial.map((it) => it.valor).join('|');

  const actualizar = (i, cambios) => setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...cambios } : it)));

  // Escrito a mano (o con pistola): la hora es la del último cambio
  const escribir = (i, valor) => {
    const previo = previosPorLote.get(valor.trim().toUpperCase());
    actualizar(i, previo ? { valor, fecha: previo.fecha, origen: previo.origen } : { valor, fecha: new Date().toISOString(), origen: 'MANUAL' });
  };

  // Leído con la cámara: hora exacta de la lectura y cómo se leyó
  const capturar = (i, captura) => {
    actualizar(i, { valor: captura.valor, fecha: new Date().toISOString(), origen: origenDeCaptura(captura.metodo) });
    setTimeout(() => siguiente(i), 0);
  };

  const agregar = () => {
    enfocarRef.current = items.length;
    setItems((prev) => [...prev, vacio()]);
  };

  const quitar = (i) => {
    setItems((prev) => (prev.length > CAMPOS_INICIALES ? prev.filter((_, j) => j !== i) : prev.map((it, j) => (j === i ? vacio() : it))));
  };

  // Pasa al siguiente campo vacío; si no hay, crea uno nuevo
  const siguiente = (i) => {
    const sig = items.findIndex((it, j) => j > i && !it.valor.trim());
    if (sig >= 0) refs.current[sig]?.focus();
    else agregar();
  };

  const cerrar = () => {
    if (guardando) return;
    if (hayCambios && !window.confirm('Tienes lotes sin guardar. ¿Deseas salir sin guardar?')) return;
    onCerrar();
  };

  const guardar = async (e) => {
    e?.preventDefault();
    if (repetidos.size) return alert(`Hay lotes repetidos: ${[...repetidos].join(', ')}`);
    const ahora = new Date().toISOString();
    // Los lotes que ya estaban conservan su fecha/hora y autor original
    const detalle = items
      .map((it) => ({ ...it, lote: it.valor.trim().toUpperCase() }))
      .filter((it) => it.lote)
      .map(
        (it) =>
          previosPorLote.get(it.lote) || {
            lote: it.lote,
            fecha: it.fecha || ahora,
            por_id: usuario?.id || null,
            por_nombre: usuario?.nombre || null,
            origen: it.origen || 'MANUAL',
          },
      );
    setGuardando(true);
    try {
      await onGuardar(detalle);
    } finally {
      setGuardando(false);
    }
  };

  // Esc cierra (si la cámara está abierta, Esc no hace nada aquí)
  useEffect(() => {
    const fn = (e) => e.key === 'Escape' && !document.querySelector('.tl-modal') && cerrar();
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  });

  return (
    <div className="tlm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cerrar()}>
      <form className="tlm-modal" onSubmit={guardar} role="dialog" aria-modal="true" aria-labelledby="tlm-titulo">
        <header className="tlm-header">
          <div>
            <span className="tlm-pill">TOMA DE LOTES</span>
            <h2 id="tlm-titulo">Registrar lotes</h2>
          </div>
          <button type="button" className="tlm-cerrar" onClick={cerrar} aria-label="Cerrar">
            <FaTimes />
          </button>
        </header>

        <div className="tlm-body">
          <div className="tlm-bloqueados">
            <label>
              <span>Pedido</span>
              <input value={registro.pedido} readOnly disabled />
            </label>
            <label>
              <span>SKU</span>
              <input value={registro.sku} readOnly disabled />
            </label>
          </div>
          {(registro.cliente || registro.ruta) && (
            <p className="tlm-cliente">
              {registro.ruta && <strong>{registro.ruta}</strong>} {registro.cliente}
            </p>
          )}

          <div className="tlm-lotes-head">
            <span>Lotes</span>
            <span className="tlm-contador">
              {llenos.length} ingresado{llenos.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="tlm-lotes">
            {items.map((it, i) => (
              <div className="tlm-lote-row" key={i}>
                <span className={`tlm-num ${it.valor.trim() ? 'ok' : ''}`}>{i + 1}</span>
                <div className="tlm-lote-campo">
                  <CampoEscaner
                    ref={(el) => (refs.current[i] = el)}
                    value={it.valor}
                    onChange={(v) => escribir(i, v)}
                    onCapture={(c) => capturar(i, c)}
                    placeholder={`Lote ${i + 1}`}
                    invalido={repetidos.has(it.valor.trim().toUpperCase())}
                    enterKeyHint="next"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        siguiente(i);
                      }
                    }}
                  />
                  {it.valor.trim() && it.fecha && (
                    <span className="tlm-lote-meta">
                      {horaCorta(it.fecha)}
                      {it.origen ? ` · ${ETIQUETA_ORIGEN[it.origen] || it.origen}` : ''}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="tlm-quitar"
                  onClick={() => quitar(i)}
                  title={items.length > CAMPOS_INICIALES ? 'Quitar campo' : 'Borrar lote'}
                  aria-label="Quitar lote"
                  disabled={!it.valor && items.length <= CAMPOS_INICIALES}
                >
                  <FaTrashAlt />
                </button>
              </div>
            ))}
          </div>

          {repetidos.size > 0 && <p className="tlm-error">Lote repetido en este SKU: {[...repetidos].join(', ')}</p>}

          <button type="button" className="tlm-agregar" onClick={agregar}>
            <FaPlus /> Agregar lote
          </button>
        </div>

        <footer className="tlm-footer">
          <button type="button" className="tlm-btn-sec" onClick={cerrar} disabled={guardando}>
            Cancelar
          </button>
          <button type="submit" className="tlm-btn-pri" disabled={guardando || repetidos.size > 0}>
            <FaSave /> {guardando ? 'Guardando…' : `Guardar (${llenos.length})`}
          </button>
        </footer>
      </form>
    </div>
  );
}
