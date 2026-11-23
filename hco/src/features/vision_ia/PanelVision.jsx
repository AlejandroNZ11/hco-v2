import { useCallback, useEffect, useMemo, useState } from 'react';
import { FaCheck, FaExternalLinkAlt, FaMinus, FaPlus, FaSyncAlt } from 'react-icons/fa';
import { aplicarCambioEnLista, useSupabaseRealtime } from '../../hooks/useSupabaseRealtime';
import {
  aforoEnCache,
  guardarCacheAforo,
  inicioDeHoyISO,
  LIMITE_VISION,
  listarAforoIncremental,
  listarHoy,
  marcarEppRevisado,
  registrarAjusteAforo,
  TABLAS_VISION,
} from '../../services/visionService';

const hora = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

const ESTADO_RT = { conectando: 'Conectando…', en_vivo: 'Tiempo real', desconectado: 'Sin tiempo real' };

/** Foto de Drive (enlace lh3). Sin referrer, como en Generar RDR, para que Google la sirva. */
function FotoDrive({ url, alt }) {
  if (!url) return <div className="via-foto via-foto-vacia">Sin foto</div>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="via-foto" title="Abrir foto">
      <img src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" />
      <FaExternalLinkAlt className="via-foto-ico" />
    </a>
  );
}

/**
 * Panel en vivo de un módulo: carga lo de hoy y se mantiene al día con Supabase Realtime.
 * Se monta con key={modulo}, así que al cambiar de módulo arranca limpio.
 */
export default function PanelVision({ modulo, area, camaraId }) {
  const esAforo = modulo === 'aforo';
  // Aforo: se pinta al instante lo guardado en caché y luego se piden solo los eventos nuevos
  const [filas, setFilas] = useState(() => (esAforo ? aforoEnCache() || [] : []));
  const [cargando, setCargando] = useState(() => !(esAforo && aforoEnCache()));
  const [error, setError] = useState('');

  // completo=true → botón "Recargar" (trae todo el día). En reconexión basta el incremental.
  const cargar = useCallback(
    (completo) => (esAforo ? listarAforoIncremental({ completo }) : listarHoy(modulo, LIMITE_VISION[modulo])),
    [esAforo, modulo],
  );

  const recargar = useCallback(async (completo = true) => {
    try {
      setFilas(await cargar(completo));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [cargar]);

  // Carga inicial (el setState ocurre al resolver la promesa, no dentro del efecto)
  useEffect(() => {
    let activo = true;
    cargar(false)
      .then((datos) => activo && setFilas(datos))
      .catch((err) => activo && setError(err.message))
      .finally(() => activo && setCargando(false));
    return () => {
      activo = false;
    };
  }, [cargar]);

  // Mantiene la caché de aforo al día con lo que llega en tiempo real (sin pedir nada extra)
  useEffect(() => {
    if (!esAforo || cargando) return undefined;
    const t = setTimeout(() => guardarCacheAforo(filas), 1500); // agrupa ráfagas de eventos
    return () => clearTimeout(t);
  }, [esAforo, cargando, filas]);

  const estadoRt = useSupabaseRealtime(
    TABLAS_VISION[modulo],
    (cambio) => setFilas((prev) => aplicarCambioEnLista(prev, cambio)),
    { onReconectar: () => recargar(false) },
  );

  // Solo lo de hoy (si la pantalla queda abierta pasada la medianoche)
  const hoy = useMemo(() => {
    const inicio = inicioDeHoyISO();
    return filas
      .filter((f) => f.hora >= inicio)
      .sort((a, b) => (a.hora < b.hora ? 1 : -1));
  }, [filas]);

  return (
    <div className="via-panel">
      <div className="via-panel-head">
        <span className={`via-chip via-rt-${estadoRt}`}>{ESTADO_RT[estadoRt] || estadoRt}</span>
        <button type="button" className="via-btn via-btn-ghost" onClick={() => recargar(true)} title="Recargar">
          <FaSyncAlt /> Recargar
        </button>
      </div>
      {error && <div className="via-alerta">{error}</div>}
      {cargando ? (
        <div className="via-vacio">Cargando…</div>
      ) : (
        <>
          {modulo === 'epp' && <PanelEpp filas={hoy} setFilas={setFilas} />}
          {modulo === 'conteo' && <PanelConteo filas={hoy} />}
          {modulo === 'aforo' && <PanelAforo filas={hoy} area={area} camaraId={camaraId} />}
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------------- EPP
function PanelEpp({ filas, setFilas }) {
  const [error, setError] = useState('');
  const pendientes = filas.filter((f) => !f.revisado).length;
  const masComun = useMemo(() => {
    const c = {};
    filas.forEach((f) => (f.epp_faltantes || []).forEach((e) => (c[e] = (c[e] || 0) + 1)));
    return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
  }, [filas]);

  const alternar = async (fila) => {
    try {
      await marcarEppRevisado(fila.id, !fila.revisado);
      setFilas((prev) => prev.map((f) => (f.id === fila.id ? { ...f, revisado: !fila.revisado } : f)));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <div className="via-kpis">
        <div className="via-kpi via-kpi-rojo"><b>{filas.length}</b><span>No conformes hoy</span></div>
        <div className="via-kpi"><b>{pendientes}</b><span>Por revisar</span></div>
        <div className="via-kpi"><b className="via-kpi-txt">{masComun}</b><span>EPP más omitido</span></div>
      </div>
      {error && <div className="via-alerta">{error}</div>}
      {!filas.length && <div className="via-vacio">Sin infracciones hoy 👍</div>}
      <div className="via-grid">
        {filas.map((f) => (
          <article key={f.id} className={`via-card ${f.revisado ? 'via-card-ok' : 'via-card-alerta'}`}>
            <FotoDrive url={f.foto_url} alt={`Infracción ${f.camara_id}`} />
            <div className="via-card-body">
              <div className="via-card-top">
                <strong>{hora(f.hora)}</strong>
                <span className="via-badge via-badge-rojo">{f.estado}</span>
              </div>
              <div className="via-muted">{f.camara_id}{f.area ? ` · ${f.area}` : ''} · #{f.track_id}</div>
              <div className="via-tags">
                {(f.epp_faltantes || []).map((e) => <span key={e} className="via-tag">sin {e}</span>)}
              </div>
              <button type="button" className={`via-btn ${f.revisado ? 'via-btn-ghost' : 'via-btn-ok'}`} onClick={() => alternar(f)}>
                <FaCheck /> {f.revisado ? 'Revisado' : 'Marcar revisado'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------ Conteo
function PanelConteo({ filas }) {
  const totales = useMemo(() => {
    const t = {};
    filas.forEach((f) => (t[f.clase] = (t[f.clase] || 0) + (f.cantidad || 0)));
    return Object.entries(t).sort((a, b) => b[1] - a[1]);
  }, [filas]);

  return (
    <>
      <div className="via-kpis">
        {totales.length ? (
          totales.map(([clase, n]) => (
            <div key={clase} className="via-kpi"><b>{n}</b><span>{clase}</span></div>
          ))
        ) : (
          <div className="via-vacio">Aún no hay conteos hoy</div>
        )}
      </div>
      {!!filas.length && (
        <div className="via-tabla-wrap">
          <table className="via-tabla">
            <thead>
              <tr><th>Hora</th><th>Cámara</th><th>Clase</th><th className="via-num">Cantidad</th></tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td>{new Date(f.hora).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{f.camara_id}{f.area ? ` · ${f.area}` : ''}</td>
                  <td>{f.clase}</td>
                  <td className="via-num">{f.cantidad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------- Aforo
function PanelAforo({ filas, area, camaraId }) {
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const porArea = useMemo(() => {
    const m = {};
    filas.forEach((f) => {
      const k = f.area || 'Sin área';
      m[k] ??= { aforo: 0, ingresos: 0, salidas: 0 };
      m[k].aforo += f.delta || 0;
      if (f.tipo === 'INGRESO') m[k].ingresos += 1;
      if (f.tipo === 'SALIDA') m[k].salidas += 1;
    });
    return Object.entries(m);
  }, [filas]);

  const ajustar = async (delta) => {
    setEnviando(true);
    try {
      await registrarAjusteAforo({ camaraId, area, delta, nota: 'Ajuste manual desde Visión IA' });
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      {!porArea.length && <div className="via-vacio">Sin movimientos hoy</div>}
      <div className="via-kpis">
        {porArea.map(([nombre, d]) => (
          <div key={nombre} className="via-kpi via-kpi-grande">
            <b>{Math.max(0, d.aforo)}</b>
            <span>Aforo actual · {nombre}</span>
            <small>↑ {d.ingresos} ingresos · ↓ {d.salidas} salidas{d.aforo < 0 ? ' · revisar (negativo)' : ''}</small>
          </div>
        ))}
      </div>
      <div className="via-ajuste">
        <span>Corregir aforo de <b>{area || 'Sin área'}</b>:</span>
        <button type="button" className="via-btn via-btn-ghost" disabled={enviando} onClick={() => ajustar(-1)}><FaMinus /> 1</button>
        <button type="button" className="via-btn via-btn-ghost" disabled={enviando} onClick={() => ajustar(1)}><FaPlus /> 1</button>
      </div>
      {error && <div className="via-alerta">{error}</div>}
      <ul className="via-lista">
        {filas.slice(0, 40).map((f) => (
          <li key={f.id}>
            <span className={`via-badge ${f.tipo === 'INGRESO' ? 'via-badge-verde' : f.tipo === 'SALIDA' ? 'via-badge-naranja' : ''}`}>
              {f.tipo}{f.tipo === 'AJUSTE' ? ` ${f.delta > 0 ? '+' : ''}${f.delta}` : ''}
            </span>
            <span>{hora(f.hora)}</span>
            <span className="via-muted">{f.area || f.camara_id}{f.track_id != null ? ` · #${f.track_id}` : ''}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
