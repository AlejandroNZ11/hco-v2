import { useState } from 'react';
import { FaPlus, FaTrash } from 'react-icons/fa';
import { claveProf, codRack, leerAlturas, pasillosImpares, profundidadesDeRack } from './almacenModelo';

const entero = (v, min = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= min ? n : null;
};
const decimal = (v) => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};
// "1,2,7-9" → [1,2,7,8,9]
const listaRacks = (t) => {
  const out = new Set();
  String(t || '').split(/[,;\s]+/).filter(Boolean).forEach((p) => {
    const m = p.match(/^(\d+)-(\d+)$/);
    if (m) for (let i = +m[1]; i <= +m[2]; i++) out.add(i);
    else if (entero(p, 1)) out.add(entero(p, 1));
  });
  return [...out].sort((a, b) => a - b);
};

export default function EditorConfig({ cfg, setCfg }) {
  const [rango, setRango] = useState({ rDesde: '', rHasta: '', pDesde: '', pHasta: '', accion: 'niveles', niveles: '', alturas: '' });
  const [msgRango, setMsgRango] = useState('');

  const set = (campo, valor) => setCfg((c) => ({ ...c, [campo]: valor }));
  const setMedida = (campo, valor) => setCfg((c) => ({ ...c, medidas: { ...c.medidas, [campo]: valor } }));

  const setRack = (r, campo, valor) =>
    setCfg((c) => {
      const k = codRack(r);
      const d = { ...(c.racksDetalle[k] || {}) };
      if (valor == null) delete d[campo];
      else d[campo] = valor;
      const racksDetalle = { ...c.racksDetalle };
      if (Object.keys(d).length) racksDetalle[k] = d;
      else delete racksDetalle[k];
      return { ...c, racksDetalle };
    });

  const togglePasillo = (r) =>
    setCfg((c) => ({
      ...c,
      pasillosDespuesDe: c.pasillosDespuesDe.includes(r)
        ? c.pasillosDespuesDe.filter((x) => x !== r)
        : [...c.pasillosDespuesDe, r].sort((a, b) => a - b),
    }));

  const setPuente = (i, campo, valor) =>
    setCfg((c) => ({ ...c, puentes: c.puentes.map((b, j) => (j === i ? { ...b, [campo]: valor } : b)) }));

  const aplicarRango = () => {
    const rD = entero(rango.rDesde, 1) ?? 1;
    const rH = entero(rango.rHasta, 1) ?? (rango.rDesde ? rD : cfg.racks);
    const niveles = entero(rango.niveles, 1);
    if (rango.accion === 'niveles' && !niveles) {
      setMsgRango('Indica la cantidad de niveles.');
      return;
    }
    const alturas = rango.alturas.trim() ? leerAlturas(rango.alturas) : null;
    if (rango.accion === 'niveles' && rango.alturas.trim() && (!alturas || alturas.length !== niveles)) {
      setMsgRango(`Las alturas deben ser ${niveles} números, ej. 1,1,2,2`);
      return;
    }
    let cont = 0;
    setCfg((c) => {
      const posiciones = { ...c.posiciones };
      for (let r = rD; r <= Math.min(rH, c.racks); r++) {
        const profs = profundidadesDeRack(c, r);
        const pD = entero(rango.pDesde, 1) ?? 1;
        const pH = entero(rango.pHasta, 1) ?? (rango.pDesde ? pD : profs);
        for (let p = pD; p <= Math.min(pH, profs); p++) {
          const k = claveProf(r, p);
          const d = { ...(posiciones[k] || {}) };
          if (rango.accion === 'niveles') {
            d.niveles = niveles;
            if (alturas) d.alturas = alturas;
            else delete d.alturas;
          }
          if (rango.accion === 'desactivar') d.inactiva = true;
          if (rango.accion === 'activar') delete d.inactiva;
          if (rango.accion === 'limpiar') {
            delete d.niveles;
            delete d.alturas;
            delete d.inactiva;
          }
          if (Object.keys(d).length) posiciones[k] = d;
          else delete posiciones[k];
          cont++;
        }
      }
      return { ...c, posiciones };
    });
    setMsgRango(`Aplicado a ${cont} profundidades. Recuerda Guardar.`);
  };

  const quitarPuntual = (k) =>
    setCfg((c) => {
      const posiciones = { ...c.posiciones };
      delete posiciones[k];
      return { ...c, posiciones };
    });

  const puntuales = Object.entries(cfg.posiciones).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="alm-editor">
      <section className="alm-card">
        <h3>General</h3>
        <div className="alm-grid-form">
          <label>Racks<input type="number" min="1" value={cfg.racks} onChange={(e) => entero(e.target.value, 1) && set('racks', entero(e.target.value, 1))} /></label>
          <label>Profundidades por rack<input type="number" min="1" value={cfg.profundidades} onChange={(e) => entero(e.target.value, 1) && set('profundidades', entero(e.target.value, 1))} /></label>
          <label>Altura del rack (niveles base)<input type="number" min="1" value={cfg.nivelesBase} onChange={(e) => entero(e.target.value, 1) && set('nivelesBase', entero(e.target.value, 1))} /></label>
        </div>
        <p className="alm-ayuda">La altura del rack es fija. Si una profundidad tiene más o menos niveles, se reparten dentro de esa altura.</p>
      </section>

      <section className="alm-card alm-card-ancha">
        <h3>Racks y pasillos</h3>
        <p className="alm-ayuda">Haz clic entre dos racks para poner o quitar un pasillo. Sin pasillo = espalda con espalda.</p>
        <div className="alm-pasillos">
          <span className="alm-pas-pas" title="Pasillo">pasillo</span>
          {Array.from({ length: cfg.racks }, (_, i) => i + 1).map((r) => {
            const hay = cfg.pasillosDespuesDe.includes(r);
            return (
              <span key={r} className="alm-pas-grupo">
                <span className="alm-pas-rack">{codRack(r)}</span>
                {r < cfg.racks && (
                  <button type="button" className={`alm-pas-corte ${hay ? 'pasillo' : ''}`}
                    title={hay ? `Pasillo entre ${codRack(r)} y ${codRack(r + 1)}` : `${codRack(r)} y ${codRack(r + 1)} espalda con espalda`}
                    onClick={() => togglePasillo(r)}>{hay ? 'pasillo' : '·'}</button>
                )}
              </span>
            );
          })}
          <span className="alm-pas-pas" title="Pasillo">pasillo</span>
        </div>
        <div className="alm-presets">
          <button type="button" className="alm-btn alm-btn-sec" onClick={() => set('pasillosDespuesDe', pasillosImpares(cfg.racks))}>01 | 02·03 | 04·05 …</button>
          <button type="button" className="alm-btn alm-btn-sec" onClick={() => set('pasillosDespuesDe', Array.from({ length: cfg.racks - 1 }, (_, i) => i + 1).filter((r) => r % 2 === 0))}>01·02 | 03·04 …</button>
          <button type="button" className="alm-btn alm-btn-sec" onClick={() => set('pasillosDespuesDe', Array.from({ length: cfg.racks - 1 }, (_, i) => i + 1))}>Pasillo entre todos</button>
        </div>
      </section>

      <section className="alm-card">
        <h3>Medidas (metros)</h3>
        <div className="alm-grid-form">
          {[
            ['anchoPosicion', 'Ancho de una profundidad'],
            ['altoNivel', 'Alto de un nivel base'],
            ['fondoRack', 'Fondo del rack'],
            ['pasillo', 'Ancho de pasillo'],
            ['espalda', 'Separación espalda con espalda'],
          ].map(([k, t]) => (
            <label key={k}>{t}<input type="number" step="0.05" min="0.05" defaultValue={cfg.medidas[k]} onBlur={(e) => decimal(e.target.value) && setMedida(k, decimal(e.target.value))} /></label>
          ))}
        </div>
      </section>

      <section className="alm-card">
        <h3>Puentes (paso por debajo del rack)</h3>
        <p className="alm-ayuda">De la profundidad "desde" a "hasta" se quita la parte de abajo (alto libre en niveles base). Racks vacío = todos. Ej.: <code>1-10, 15</code></p>
        <table className="alm-tabla">
          <thead><tr><th>Desde</th><th>Hasta</th><th>Alto libre</th><th>Racks</th><th /></tr></thead>
          <tbody>
            {cfg.puentes.map((b, i) => (
              <tr key={`${i}-${cfg.puentes.length}`}>
                <td><input type="number" min="1" value={b.desde} onChange={(e) => {
                  const v = entero(e.target.value, 1);
                  if (v) setCfg((c) => ({ ...c, puentes: c.puentes.map((x, j) => (j === i ? { ...x, desde: v, hasta: Math.max(v, x.hasta) } : x)) }));
                }} /></td>
                <td><input type="number" min="1" value={b.hasta} onChange={(e) => {
                  const v = entero(e.target.value, 1);
                  if (v && v >= b.desde) setPuente(i, 'hasta', v);
                }} /></td>
                <td><input type="number" min="0" value={b.nivelesLibres} onChange={(e) => setPuente(i, 'nivelesLibres', entero(e.target.value, 0) ?? 0)} /></td>
                <td><input type="text" placeholder="todos" defaultValue={(b.racks || []).join(', ')} onBlur={(e) => setPuente(i, 'racks', listaRacks(e.target.value))} /></td>
                <td><button type="button" className="alm-btn-icono" title="Quitar" onClick={() => set('puentes', cfg.puentes.filter((_, j) => j !== i))}><FaTrash /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="alm-btn alm-btn-sec" onClick={() => set('puentes', [...cfg.puentes, { desde: 1, hasta: 1, nivelesLibres: 2, racks: [] }])}><FaPlus /> Agregar puente</button>
      </section>

      <section className="alm-card">
        <h3>Cambiar por rango</h3>
        <p className="alm-ayuda">Ej.: rack 07, profundidad 007, 5 niveles → 07-007-1 … 07-007-5 dentro de la misma altura. Alturas de abajo hacia arriba en niveles base; deben sumar la altura del rack (4 niveles en 6: <code>1,1,2,2</code>). Deja vacío "hasta" para un solo valor y todo vacío para todos.</p>
        <div className="alm-grid-form">
          <label>Rack desde<input type="number" min="1" value={rango.rDesde} onChange={(e) => setRango({ ...rango, rDesde: e.target.value })} /></label>
          <label>Rack hasta<input type="number" min="1" value={rango.rHasta} onChange={(e) => setRango({ ...rango, rHasta: e.target.value })} /></label>
          <label>Profundidad desde<input type="number" min="1" value={rango.pDesde} onChange={(e) => setRango({ ...rango, pDesde: e.target.value })} /></label>
          <label>Profundidad hasta<input type="number" min="1" value={rango.pHasta} onChange={(e) => setRango({ ...rango, pHasta: e.target.value })} /></label>
          <label>Acción
            <select value={rango.accion} onChange={(e) => setRango({ ...rango, accion: e.target.value })}>
              <option value="niveles">Fijar cantidad de niveles</option>
              <option value="desactivar">Desactivar (no existe)</option>
              <option value="activar">Activar</option>
              <option value="limpiar">Quitar cambios (volver al general)</option>
            </select>
          </label>
          {rango.accion === 'niveles' && (
            <>
              <label>Niveles<input type="number" min="1" value={rango.niveles} onChange={(e) => setRango({ ...rango, niveles: e.target.value })} /></label>
              <label>Alturas (opcional)<input type="text" placeholder="iguales" value={rango.alturas} onChange={(e) => setRango({ ...rango, alturas: e.target.value })} /></label>
            </>
          )}
        </div>
        <button type="button" className="alm-btn" onClick={aplicarRango}>Aplicar</button>
        {msgRango && <span className="alm-msg">{msgRango}</span>}
      </section>

      <section className="alm-card">
        <h3>Por rack</h3>
        <p className="alm-ayuda">Vacío = usa el valor general ({cfg.profundidades} profundidades, altura {cfg.nivelesBase} niveles base).</p>
        <div className="alm-tabla-scroll">
          <table className="alm-tabla">
            <thead><tr><th>Rack</th><th>Profundidades</th><th>Altura (niveles)</th></tr></thead>
            <tbody>
              {Array.from({ length: cfg.racks }, (_, i) => i + 1).map((r) => {
                const d = cfg.racksDetalle[codRack(r)] || {};
                return (
                  <tr key={r}>
                    <td><b>{codRack(r)}</b></td>
                    <td><input type="number" min="1" placeholder={cfg.profundidades} value={d.profundidades ?? ''} onChange={(e) => setRack(r, 'profundidades', entero(e.target.value, 1))} /></td>
                    <td><input type="number" min="1" placeholder={cfg.nivelesBase} value={d.niveles ?? ''} onChange={(e) => setRack(r, 'niveles', entero(e.target.value, 1))} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="alm-card">
        <h3>Cambios puntuales ({puntuales.length})</h3>
        {!puntuales.length && <p className="alm-ayuda">Ninguno. Se crean desde "Cambiar por rango" o al hacer clic en una profundidad.</p>}
        {!!puntuales.length && (
          <div className="alm-tabla-scroll">
            <table className="alm-tabla">
              <thead><tr><th>Rack-Profundidad</th><th>Niveles</th><th>Alturas</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {puntuales.map(([k, d]) => (
                  <tr key={k}>
                    <td><b>{k}</b></td>
                    <td>{d.niveles ?? '—'}</td>
                    <td>{d.alturas ? d.alturas.join(', ') : 'iguales'}</td>
                    <td>{d.inactiva ? 'Inactiva' : 'Activa'}</td>
                    <td><button type="button" className="alm-btn-icono" title="Quitar cambio" onClick={() => quitarPuntual(k)}><FaTrash /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
