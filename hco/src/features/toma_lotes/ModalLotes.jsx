import { useEffect, useMemo, useRef, useState } from 'react';
import { FaPlus, FaTimes, FaSave, FaTrashAlt } from 'react-icons/fa';
import CampoEscaner from '../../components/escaner/CampoEscaner';
import {
  detalleDeFila,
  requisitoCliente,
  loteIncompleto,
  REQUISITO,
  ETIQUETA_REQUISITO,
} from '../../services/tomaLotesService';

const CAMPOS_INICIALES = 5;
const ETIQUETA_ORIGEN = { BARRAS: 'Barras', OCR: 'Texto', FOTO: 'Foto', MANUAL: 'Manual', EXCEL: 'Excel' };

const vacio = () => ({ valor: '', fecha: null, origen: null, cantidad: '', f_manufactura: '', f_vencimiento: '' });

const desdePrevio = (d) => ({
  valor: d.lote,
  fecha: d.fecha,
  origen: d.origen,
  cantidad: d.cantidad != null ? String(d.cantidad) : '',
  f_manufactura: d.f_manufactura || '',
  f_vencimiento: d.f_vencimiento || '',
});

// Firma de un campo para saber si hubo cambios
const firma = (it) => [it.valor.trim().toUpperCase(), it.cantidad, it.f_manufactura, it.f_vencimiento].join('~');

// Cómo se leyó el lote, a partir del método que devuelve el escáner
const origenDeCaptura = (metodo = '') =>
  metodo.startsWith('BARRAS') ? 'BARRAS' : metodo.includes('FOTO') ? 'FOTO' : 'OCR';

const horaCorta = (iso) =>
  iso
    ? new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '')
    : '';

const indices = (items, cond) => new Set(items.map((it, i) => (cond(it) ? i : -1)).filter((i) => i >= 0));

/**
 * Modal para registrar los lotes de un SKU de un pedido.
 * Pedido y SKU se muestran bloqueados. Cada lote se puede escribir, leer con
 * pistola (Enter pasa al siguiente) o escanear con la cámara (barras / texto).
 * Se guarda la fecha y hora en que se escaneó / registró cada lote.
 *
 * Según el cliente, cada lote pide además:
 *   CANTIDAD → cantidad por lote (ALOCEN, COSALCO)
 *   FECHAS   → fecha de manufactura + fecha de vencimiento (NESTLE, QSI, DONOFRIO)
 */
export default function ModalLotes({ registro, usuario, onCerrar, onGuardar }) {
  const req = useMemo(() => requisitoCliente(registro.cliente), [registro.cliente]);
  const previos = useMemo(() => detalleDeFila(registro), [registro]);
  const previosPorLote = useMemo(() => new Map(previos.map((d) => [d.lote, d])), [previos]);

  const inicial = useMemo(() => {
    const total = Math.max(CAMPOS_INICIALES, previos.length);
    return Array.from({ length: total }, (_, i) => (previos[i] ? desdePrevio(previos[i]) : vacio()));
  }, [previos]);

  const [items, setItems] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const refs = useRef([]);
  const extraRefs = useRef([]); // primer dato extra de cada fila (cantidad o F. manufactura)
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
  const hayCambios = items.map(firma).join('|') !== inicial.map(firma).join('|');

  // Datos que pide el cliente: faltantes y fechas al revés
  const incompletos = useMemo(() => indices(items, (it) => it.valor.trim() && loteIncompleto(it, req)), [items, req]);
  const fechasMal = useMemo(
    () =>
      indices(
        items,
        (it) =>
          req === REQUISITO.FECHAS &&
          it.valor.trim() &&
          it.f_manufactura &&
          it.f_vencimiento &&
          it.f_vencimiento < it.f_manufactura,
      ),
    [items, req],
  );
  const bloqueado = repetidos.size > 0 || incompletos.size > 0 || fechasMal.size > 0;

  const actualizar = (i, cambios) => setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...cambios } : it)));

  // Escrito a mano (o con pistola): la hora es la del último cambio
  const escribir = (i, valor) => {
    const previo = previosPorLote.get(valor.trim().toUpperCase());
    actualizar(i, previo ? { valor, fecha: previo.fecha, origen: previo.origen } : { valor, fecha: new Date().toISOString(), origen: 'MANUAL' });
  };

  // Leído con la cámara: hora exacta de la lectura y cómo se leyó
  const capturar = (i, captura) => {
    actualizar(i, { valor: captura.valor, fecha: new Date().toISOString(), origen: origenDeCaptura(captura.metodo) });
    setTimeout(() => (req ? extraRefs.current[i]?.focus() : siguiente(i)), 0);
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

  // Enter en el lote: si el cliente pide datos extra, va a ellos; si no, al siguiente lote
  const enterEnLote = (i) => {
    if (req && items[i].valor.trim() && extraRefs.current[i]) extraRefs.current[i].focus();
    else siguiente(i);
  };

  const enterPasaAlSiguiente = (i) => (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      siguiente(i);
    }
  };

  const cerrar = () => {
    if (guardando) return;
    if (hayCambios && !window.confirm('Tienes lotes sin guardar. ¿Deseas salir sin guardar?')) return;
    onCerrar();
  };

  const guardar = async (e) => {
    e?.preventDefault();
    if (repetidos.size) return alert(`Hay lotes repetidos: ${[...repetidos].join(', ')}`);
    if (incompletos.size) return alert(`Este cliente requiere ${ETIQUETA_REQUISITO[req].toLowerCase()} en cada lote.`);
    if (fechasMal.size) return alert('La fecha de vencimiento no puede ser anterior a la de manufactura.');
    const ahora = new Date().toISOString();
    // Los lotes que ya estaban conservan su fecha/hora y autor original
    const detalle = items
      .map((it) => ({ ...it, lote: it.valor.trim().toUpperCase() }))
      .filter((it) => it.lote)
      .map((it) => {
        const base = previosPorLote.get(it.lote) || {
          lote: it.lote,
          fecha: it.fecha || ahora,
          por_id: usuario?.id || null,
          por_nombre: usuario?.nombre || null,
          origen: it.origen || 'MANUAL',
        };
        if (req === REQUISITO.CANTIDAD) return { ...base, cantidad: Number(it.cantidad) };
        if (req === REQUISITO.FECHAS) return { ...base, f_manufactura: it.f_manufactura, f_vencimiento: it.f_vencimiento };
        return base;
      });
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
          {req && (
            <p className="tlm-requisito">
              Este cliente requiere: <strong>{ETIQUETA_REQUISITO[req]}</strong>
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
                        enterEnLote(i);
                      }
                    }}
                  />
                  {req && it.valor.trim() && (
                    <div className={`tlm-extra${incompletos.has(i) || fechasMal.has(i) ? ' invalido' : ''}`}>
                      {req === REQUISITO.CANTIDAD ? (
                        <label>
                          <span>Cantidad</span>
                          <input
                            ref={(el) => (extraRefs.current[i] = el)}
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            placeholder="0"
                            value={it.cantidad}
                            onChange={(e) => actualizar(i, { cantidad: e.target.value })}
                            onKeyDown={enterPasaAlSiguiente(i)}
                          />
                        </label>
                      ) : (
                        <>
                          <label>
                            <span>F. manufactura</span>
                            <input
                              ref={(el) => (extraRefs.current[i] = el)}
                              type="date"
                              value={it.f_manufactura}
                              onChange={(e) => actualizar(i, { f_manufactura: e.target.value })}
                            />
                          </label>
                          <label>
                            <span>F. vencimiento</span>
                            <input
                              type="date"
                              min={it.f_manufactura || undefined}
                              value={it.f_vencimiento}
                              onChange={(e) => actualizar(i, { f_vencimiento: e.target.value })}
                              onKeyDown={enterPasaAlSiguiente(i)}
                            />
                          </label>
                        </>
                      )}
                    </div>
                  )}
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
          {incompletos.size > 0 && (
            <p className="tlm-error">
              Falta {req === REQUISITO.CANTIDAD ? 'la cantidad' : 'alguna fecha'} en {incompletos.size} lote
              {incompletos.size === 1 ? '' : 's'}.
            </p>
          )}
          {fechasMal.size > 0 && <p className="tlm-error">La fecha de vencimiento no puede ser anterior a la de manufactura.</p>}

          <button type="button" className="tlm-agregar" onClick={agregar}>
            <FaPlus /> Agregar lote
          </button>
        </div>

        <footer className="tlm-footer">
          <button type="button" className="tlm-btn-sec" onClick={cerrar} disabled={guardando}>
            Cancelar
          </button>
          <button type="submit" className="tlm-btn-pri" disabled={guardando || bloqueado}>
            <FaSave /> {guardando ? 'Guardando…' : `Guardar (${llenos.length})`}
          </button>
        </footer>
      </form>
    </div>
  );
}
