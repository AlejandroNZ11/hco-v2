import { useMemo, useState } from 'react';
import { FaCloudUploadAlt, FaFileExcel } from 'react-icons/fa';

const MAX_FILAS = 300; // vista previa: suficiente para revisar sin trabar el celular

/**
 * Resumen del Excel antes de cargarlo: totales + vista previa de los datos con su estado.
 */
export default function ModalResumenExcel({ resumen, cargando, onCancelar, onConfirmar }) {
  const [pestana, setPestana] = useState('todos');

  const filas = useMemo(() => {
    const nuevas = resumen.nuevas.map((x) => ({ ...x, estado: 'nuevo', lotesMostrar: x.lotes }));
    const actualizar = resumen.aActualizar.map((x) => ({ ...x, estado: 'adicionar', lotesMostrar: x.lotesNuevos }));
    const omitidas = [...resumen.repetidasArchivo, ...resumen.yaExistentes, ...resumen.invalidas].map((x) => ({
      ...x,
      estado: 'omitido',
      lotesMostrar: x.lotes || [],
    }));
    return { todos: [...nuevas, ...actualizar, ...omitidas], nuevo: nuevas, adicionar: actualizar, omitido: omitidas };
  }, [resumen]);

  const visibles = useMemo(
    () => [...filas[pestana]].sort((a, b) => a.filaExcel - b.filaExcel).slice(0, MAX_FILAS),
    [filas, pestana],
  );

  const lotesNuevos =
    resumen.nuevas.reduce((s, x) => s + x.lotes.length, 0) + resumen.aActualizar.reduce((s, x) => s + x.lotesNuevos.length, 0);
  const hayAlgo = resumen.nuevas.length + resumen.aActualizar.length > 0;

  const pestanas = [
    ['todos', 'Todos', filas.todos.length],
    ['nuevo', 'Nuevos', filas.nuevo.length],
    ['adicionar', 'Adicionar lotes', filas.adicionar.length],
    ['omitido', 'Omitidos', filas.omitido.length],
  ];

  return (
    <div className="tlm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !cargando && onCancelar()}>
      <div className="tlm-modal tlm-resumen" role="dialog" aria-modal="true">
        <header className="tlm-header">
          <div>
            <span className="tlm-pill">CARGA DE EXCEL</span>
            <h2>
              <FaFileExcel /> {resumen.nombre}
            </h2>
          </div>
        </header>

        <div className="tlm-body">
          <div className="tl-res-grid">
            <div className="tl-res ok">
              <strong>{resumen.nuevas.length}</strong>
              <span>SKU nuevos</span>
            </div>
            <div className="tl-res info">
              <strong>{resumen.aActualizar.length}</strong>
              <span>SKU con lotes a adicionar</span>
            </div>
            <div className="tl-res warn">
              <strong>{resumen.repetidasArchivo.length + resumen.yaExistentes.length}</strong>
              <span>Repetidos / sin cambios</span>
            </div>
            <div className="tl-res err">
              <strong>{resumen.invalidas.length}</strong>
              <span>Sin pedido o SKU</span>
            </div>
          </div>

          <p className="tl-res-regla">
            Un pedido no puede tener 2 veces el mismo SKU.{' '}
            {resumen.conLote
              ? `Se registrarán ${lotesNuevos} lote(s); a los SKU ya cargados solo se les adicionan los lotes que faltan.`
              : 'El archivo no trae columna «Lote»: solo se cargan pedidos y SKU.'}
          </p>

          <div className="tl-res-tabs" role="tablist">
            {pestanas.map(([clave, etiqueta, n]) => (
              <button
                key={clave}
                type="button"
                role="tab"
                aria-selected={pestana === clave}
                className={pestana === clave ? 'active' : ''}
                onClick={() => setPestana(clave)}
              >
                {etiqueta} <span>{n}</span>
              </button>
            ))}
          </div>

          <div className="tl-res-tabla">
            <table>
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Ruta</th>
                  <th>Cliente</th>
                  <th>Pedido</th>
                  <th>SKU</th>
                  {resumen.conLote && <th>Lotes</th>}
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 ? (
                  <tr>
                    <td colSpan={resumen.conLote ? 7 : 6} className="tl-vacio">
                      Sin filas en esta pestaña.
                    </td>
                  </tr>
                ) : (
                  visibles.map((x) => (
                    <tr key={`${x.filaExcel}-${x.estado}`}>
                      <td className="tl-num">{x.filaExcel}</td>
                      <td>{x.ruta || '-'}</td>
                      <td className="tl-cliente" title={x.cliente}>{x.cliente || '-'}</td>
                      <td className="tl-fuerte">{x.pedido || '—'}</td>
                      <td className="tl-fuerte">{x.sku || '—'}</td>
                      {resumen.conLote && (
                        <td className="tl-res-lotes" title={x.lotesMostrar.join(', ')}>
                          {x.lotesMostrar.length ? x.lotesMostrar.join(', ') : '-'}
                        </td>
                      )}
                      <td>
                        {x.estado === 'nuevo' && <span className="tl-estado nuevo">Nuevo</span>}
                        {x.estado === 'adicionar' && (
                          <span className="tl-estado adicionar">
                            +{x.lotesNuevos.length} lote{x.lotesNuevos.length === 1 ? '' : 's'} (tenía {x.lotesPrevios})
                          </span>
                        )}
                        {x.estado === 'omitido' && <span className="tl-estado omitido">{x.motivo}</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {filas[pestana].length > MAX_FILAS && (
            <p className="tl-res-regla">Mostrando las primeras {MAX_FILAS} filas de {filas[pestana].length}.</p>
          )}
        </div>

        <footer className="tlm-footer">
          <button type="button" className="tlm-btn-sec" onClick={onCancelar} disabled={cargando}>
            Cancelar
          </button>
          <button type="button" className="tlm-btn-pri" onClick={onConfirmar} disabled={cargando || !hayAlgo}>
            <FaCloudUploadAlt />{' '}
            {cargando
              ? 'Cargando…'
              : resumen.aActualizar.length
              ? `Cargar ${resumen.nuevas.length} + adicionar ${resumen.aActualizar.length}`
              : `Cargar ${resumen.nuevas.length}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
