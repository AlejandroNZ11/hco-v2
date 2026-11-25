import { useState } from 'react';
import { FaPlus, FaTrash } from 'react-icons/fa';
import {
  claveProf, codRack, distribucion, leerAlturas, leerRack, nombrePasillo, pasillosImpares, pasillosPares, profundidadesDeRack,
} from './almacenModelo';

const OPC_PALLETS = [1, 2, 3, 4];

const entero = (v, min = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= min ? n : null;
};
const decimal = (v) => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};
// "1,2,7-9, P2, P3" → [1,2,7,8,9,"P2","P3"]
const listaRacks = (t) => {
  const out = new Set();
  String(t || '').split(/[,;\s]+/).filter(Boolean).forEach((p) => {
    const m = p.match(/^(\d+)-(\d+)$/);
    if (m) for (let i = +m[1]; i <= +m[2]; i++) out.add(leerRack(i));
    else if (/^[A-Za-z][A-Za-z0-9]{0,3}$/.test(p)) out.add(p.toUpperCase());
    else if (entero(p, 1)) out.add(leerRack(entero(p, 1))); // "36" de médicos queda como texto
  });
  return [...out].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
};

export default function EditorConfig({ cfg, setCfg }) {
  const [rango, setRango] = useState({ rDesde: '', rHasta: '', pDesde: '', pHasta: '', accion: 'niveles', niveles: '', alturas: '', pallets: '2' });
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

  const setStage = (campo, valor) => setCfg((c) => ({ ...c, stage: { ...c.stage, [campo]: valor } }));
  const setPel = (campo, valor) => setCfg((c) => ({ ...c, peligrosos: { ...c.peligrosos, [campo]: valor } }));
  const setPelRack = (i, cambios) =>
    setCfg((c) => ({ ...c, peligrosos: { ...c.peligrosos, racks: c.peligrosos.racks.map((x, j) => (j === i ? { ...x, ...cambios } : x)) } }));

  const setMed = (campo, valor) => setCfg((c) => ({ ...c, medicos: { ...c.medicos, [campo]: valor } }));
  const setMedRack = (i, cambios) =>
    setCfg((c) => ({ ...c, medicos: { ...c.medicos, racks: c.medicos.racks.map((x, j) => (j === i ? { ...x, ...cambios } : x)) } }));
  const moverMed = (i, d) =>
    setCfg((c) => {
      const racks = [...c.medicos.racks];
      [racks[i], racks[i + d]] = [racks[i + d], racks[i]];
      return { ...c, medicos: { ...c.medicos, racks } };
    });
  const codigoLibre = (v, i) =>
    /^[A-Z0-9]{1,4}$/.test(v) && ![...cfg.peligrosos.racks, ...cfg.medicos.racks].some((o) => o.codigo === v && o !== cfg.medicos.racks[i]);

  const moverPel = (i, d) =>
    setCfg((c) => {
      const racks = [...c.peligrosos.racks];
      [racks[i], racks[i + d]] = [racks[i + d], racks[i]];
      return { ...c, peligrosos: { ...c.peligrosos, racks } };
    });
  const setEnrejado = (i, cambios) =>
    setCfg((c) => ({ ...c, enrejados: c.enrejados.map((x, j) => (j === i ? { ...x, ...cambios } : x)) }));

  const togglePasillo = (r) =>
    setCfg((c) => ({
      ...c,
      pasillosDespuesDe: c.pasillosDespuesDe.includes(r)
        ? c.pasillosDespuesDe.filter((x) => x !== r)
        : [...c.pasillosDespuesDe, r].sort((a, b) => a - b),
    }));

  const setRotulo = (campo, valor) => setCfg((c) => ({ ...c, rotulos: { ...c.rotulos, [campo]: valor } }));
  const setColumna = (i, cambios) =>
    setCfg((c) => ({ ...c, columnas: c.columnas.map((x, j) => (j === i ? { ...x, ...cambios } : x)) }));

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
          if (rango.accion === 'pallets') {
            if (+rango.pallets > 1) d.pallets = +rango.pallets;
            else delete d.pallets;
          }
          if (rango.accion === 'desactivar') d.inactiva = true;
          if (rango.accion === 'activar') delete d.inactiva;
          if (rango.accion === 'limpiar') {
            delete d.niveles;
            delete d.alturas;
            delete d.inactiva;
            delete d.pallets;
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
  const pasillosPrincipales = distribucion(cfg).pasillos;

  return (
    <div className="alm-editor">
      <section className="alm-card">
        <h3>General</h3>
        <div className="alm-grid-form">
          <label>Racks<input type="number" min="1" value={cfg.racks} onChange={(e) => entero(e.target.value, 1) && set('racks', entero(e.target.value, 1))} /></label>
          <label>Profundidades por rack<input type="number" min="1" value={cfg.profundidades} onChange={(e) => entero(e.target.value, 1) && set('profundidades', entero(e.target.value, 1))} /></label>
          <label>Altura del rack (niveles base)<input type="number" min="1" value={cfg.nivelesBase} onChange={(e) => entero(e.target.value, 1) && set('nivelesBase', entero(e.target.value, 1))} /></label>
          <label>Pallets por ubicación
            <select value={cfg.palletsPorUbicacion} onChange={(e) => set('palletsPorUbicacion', +e.target.value)}>
              {OPC_PALLETS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <p className="alm-ayuda">La altura del rack es fija. Si una profundidad tiene más o menos niveles, se reparten dentro de esa altura. Los pallets por ubicación se pueden cambiar por rack, por puente, por rango o en una sola profundidad.</p>
      </section>

      <section className="alm-card">
        <h3>Rótulos de rack</h3>
        <p className="alm-ayuda">Cartel blanco en la punta de cada rack con su número y una flecha roja hacia su pasillo.</p>
        <label className="alm-check-linea">
          <input type="checkbox" checked={cfg.rotulos.activo} onChange={(e) => setRotulo('activo', e.target.checked)} /> Mostrar rótulos
        </label>
        <label className="alm-check-linea">
          <input type="checkbox" checked={cfg.rotulos.atras} onChange={(e) => setRotulo('atras', e.target.checked)} /> También en el fondo del rack
        </label>
        <div className="alm-grid-form">
          <label>Altura del rótulo (m)<input type="number" min="1" step="0.5" value={cfg.rotulos.altura} onChange={(e) => decimal(e.target.value) && setRotulo('altura', decimal(e.target.value))} /></label>
        </div>
      </section>

      <section className="alm-card alm-card-ancha">
        <h3>Racks y pasillos</h3>
        <p className="alm-ayuda">Haz clic entre dos racks para poner o quitar un pasillo. Sin pasillo = espalda con espalda.</p>
        <div className="alm-grid-form">
          <label>Pasillo por la parte de atrás (m, 0 = sin pasillo)<input type="number" min="0" step="0.5" value={cfg.anchoPasilloAtras} onChange={(e) => { const v = parseFloat(e.target.value); if (v >= 0) set('anchoPasilloAtras', v); }} /></label>
          <label className="alm-check-linea" style={{ alignSelf: 'end' }}>
            <input type="checkbox" checked={cfg.tuneles} onChange={(e) => set('tuneles', e.target.checked)} /> Mostrar túneles (paso por los puentes)
          </label>
        </div>
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
          <button type="button" className={`alm-pas-corte ${cfg.pasilloAlFinal ? 'pasillo' : ''}`}
            title={cfg.pasilloAlFinal ? `Pasillo después del ${codRack(cfg.racks)}` : `El ${codRack(cfg.racks)} va pegado al muro`}
            onClick={() => set('pasilloAlFinal', !cfg.pasilloAlFinal)}>{cfg.pasilloAlFinal ? 'pasillo' : 'muro'}</button>
        </div>
        <div className="alm-presets">
          <button type="button" className="alm-btn alm-btn-sec" onClick={() => set('pasillosDespuesDe', pasillosImpares(cfg.racks))}>01 | 02·03 | 04·05 …</button>
          <button type="button" className="alm-btn alm-btn-sec" onClick={() => set('pasillosDespuesDe', pasillosPares(cfg.racks))}>01·02 | 03·04 … {cfg.racks % 2 ? `${codRack(cfg.racks)} solo` : ''}</button>
          <button type="button" className="alm-btn alm-btn-sec" onClick={() => set('pasillosDespuesDe', Array.from({ length: cfg.racks - 1 }, (_, i) => i + 1))}>Pasillo entre todos</button>
        </div>
      </section>

      <section className="alm-card">
        <h3>Apiladores ({cfg.apiladores.reduce((s, a) => s + a.cantidad, 0)})</h3>
        <p className="alm-ayuda">Cuántos apiladores hay en cada pasillo. Se reparten a lo largo del pasillo (en 3D y en la planta).</p>
        <table className="alm-tabla">
          <thead><tr><th>Pasillo</th><th>Cantidad</th><th /></tr></thead>
          <tbody>
            {cfg.apiladores.map((a, i) => (
              <tr key={`${i}-${cfg.apiladores.length}`}>
                <td>
                  <select value={a.antesDe} onChange={(e) => setCfg((c) => ({ ...c, apiladores: c.apiladores.map((x, j) => (j === i ? { ...x, antesDe: +e.target.value } : x)) }))}>
                    {pasillosPrincipales.map((p) => <option key={p.antesDe} value={p.antesDe}>{nombrePasillo(cfg, p.antesDe)}</option>)}
                  </select>
                </td>
                <td><input type="number" min="0" value={a.cantidad} onChange={(e) => { const v = entero(e.target.value, 0); if (v != null) setCfg((c) => ({ ...c, apiladores: c.apiladores.map((x, j) => (j === i ? { ...x, cantidad: v } : x)) })); }} /></td>
                <td><button type="button" className="alm-btn-icono" title="Quitar" onClick={() => set('apiladores', cfg.apiladores.filter((_, j) => j !== i))}><FaTrash /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="alm-btn alm-btn-sec" onClick={() => set('apiladores', [...cfg.apiladores, { antesDe: pasillosPrincipales[0]?.antesDe ?? 1, cantidad: 1 }])}><FaPlus /> Agregar apilador</button>
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
        <h3>Stage y rampas (al frente)</h3>
        <p className="alm-ayuda">Zona de preparación delante de la profundidad 001, con las rampas (andenes) en el muro del frente.</p>
        <label className="alm-check-linea">
          <input type="checkbox" checked={cfg.stage.activo} onChange={(e) => setStage('activo', e.target.checked)} /> Mostrar stage
        </label>
        <div className="alm-grid-form">
          <label>Pasillo al frente de los racks (m, 0 = sin pasillo)<input type="number" min="0" step="0.5" value={cfg.pasilloFrente} onChange={(e) => { const v = parseFloat(e.target.value); if (v >= 0) set('pasilloFrente', v); }} /></label>
          <label>Fondo del stage (m)<input type="number" min="1" step="0.5" value={cfg.stage.fondo} onChange={(e) => decimal(e.target.value) && setStage('fondo', decimal(e.target.value))} /></label>
          <label>Cantidad de rampas<input type="number" min="0" value={cfg.stage.rampas} onChange={(e) => entero(e.target.value, 0) != null && setStage('rampas', entero(e.target.value, 0))} /></label>
          <label>Ancho de rampa (m)<input type="number" min="1" step="0.1" value={cfg.stage.anchoRampa} onChange={(e) => decimal(e.target.value) && setStage('anchoRampa', decimal(e.target.value))} /></label>
        </div>
      </section>

      <section className="alm-card alm-card-ancha">
        <h3>Almacén de peligrosos</h3>
        <p className="alm-ayuda">
          Ubicaciones como <code>P2-007-1</code>: rack P2, profundidad 007, nivel 1. Los racks van de la pared hacia afuera en el orden de la tabla.
          <b> Fila</b> = dónde arranca su primera profundidad (P1 arranca en la fila 7, a la altura del 007 de P2).
          Sin <b>pasillo antes</b> = espalda con espalda con el anterior.
        </p>
        <label className="alm-check-linea">
          <input type="checkbox" checked={cfg.peligrosos.activo} onChange={(e) => setPel('activo', e.target.checked)} /> Mostrar peligrosos
        </label>
        <div className="alm-grid-form">
          <label>Lado
            <select value={cfg.peligrosos.lado} onChange={(e) => setPel('lado', e.target.value)}>
              <option value="izquierda">Pegado al rack 01</option>
              <option value="derecha">Después del rack {codRack(cfg.racks)}</option>
            </select>
          </label>
          <label>Separación de la pared (m)<input type="number" min="0" step="0.5" value={cfg.peligrosos.separacion} onChange={(e) => { const v = parseFloat(e.target.value); if (v >= 0) setPel('separacion', v); }} /></label>
          <label>Zona de ingreso (ancho m)<input type="number" min="0" step="0.5" value={cfg.peligrosos.zonaIngreso} onChange={(e) => { const v = parseFloat(e.target.value); if (v >= 0) setPel('zonaIngreso', v); }} /></label>
          <label title="Solo se usa si no hay pasillo al frente de los racks">Zona de puertas (fondo m)<input type="number" min="0" step="0.5" value={cfg.peligrosos.antesala} onChange={(e) => { const v = parseFloat(e.target.value); if (v >= 0) setPel('antesala', v); }} /></label>
          <label>Correr hacia el frente (m)<input type="number" step="0.5" value={cfg.peligrosos.adelante ?? 0} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setPel('adelante', v); }} /></label>
          <label>Pasillo entre puertas (ancho m, 0 = sin pasillo)<input type="number" min="0" step="0.5" value={cfg.peligrosos.anchoPasilloIngreso ?? 3} onChange={(e) => { const v = parseFloat(e.target.value); if (v >= 0) setPel('anchoPasilloIngreso', v); }} /></label>
        </div>
        <table className="alm-tabla">
          <thead><tr><th>Rack</th><th>Desde</th><th>Hasta</th><th>Altura</th><th>Fila</th><th>Pallets</th><th>Pasillo antes</th><th /></tr></thead>
          <tbody>
            {cfg.peligrosos.racks.map((x, i) => (
              <tr key={x.codigo}>
                <td><input type="text" defaultValue={x.codigo} onBlur={(e) => {
                  const v = e.target.value.trim().toUpperCase();
                  if (/^[A-Z][A-Z0-9]{0,3}$/.test(v) && !cfg.peligrosos.racks.some((o, j) => j !== i && o.codigo === v)) setPelRack(i, { codigo: v });
                  else e.target.value = x.codigo;
                }} /></td>
                <td><input type="number" min="1" value={x.desde} onChange={(e) => { const v = entero(e.target.value, 1); if (v) setPelRack(i, { desde: v, hasta: Math.max(v, x.hasta) }); }} /></td>
                <td><input type="number" min="1" value={x.hasta} onChange={(e) => { const v = entero(e.target.value, 1); if (v && v >= x.desde) setPelRack(i, { hasta: v }); }} /></td>
                <td><input type="number" min="1" value={x.niveles} onChange={(e) => { const v = entero(e.target.value, 1); if (v) setPelRack(i, { niveles: v }); }} /></td>
                <td><input type="number" min="1" value={x.fila} onChange={(e) => { const v = entero(e.target.value, 1); if (v) setPelRack(i, { fila: v }); }} /></td>
                <td><input type="number" min="1" max="4" placeholder={cfg.palletsPorUbicacion} value={x.pallets ?? ''} onChange={(e) => { const v = entero(e.target.value, 1); setPelRack(i, { pallets: v ? Math.min(v, 4) : null }); }} /></td>
                <td style={{ textAlign: 'center' }}>{i === 0 ? '—' : <input type="checkbox" style={{ width: 'auto' }} checked={x.pasilloAntes} onChange={(e) => setPelRack(i, { pasilloAntes: e.target.checked })} />}</td>
                <td>
                  <button type="button" className="alm-btn-icono alm-btn-orden" title="Subir" disabled={i === 0} onClick={() => moverPel(i, -1)}>▲</button>
                  <button type="button" className="alm-btn-icono alm-btn-orden" title="Bajar" disabled={i === cfg.peligrosos.racks.length - 1} onClick={() => moverPel(i, 1)}>▼</button>
                  <button type="button" className="alm-btn-icono" title="Quitar" onClick={() => setPel('racks', cfg.peligrosos.racks.filter((_, j) => j !== i))}><FaTrash /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="alm-btn alm-btn-sec" onClick={() => {
          let k = 1;
          while (cfg.peligrosos.racks.some((x) => x.codigo === `P${k}`)) k++;
          setPel('racks', [...cfg.peligrosos.racks, { codigo: `P${k}`, desde: 1, hasta: 18, niveles: 5, fila: 1, pasilloAntes: true }]);
        }}><FaPlus /> Agregar rack de peligrosos</button>

        <h4 className="alm-subtitulo">Enrejados (ubicaciones con jaula)</h4>
        <table className="alm-tabla">
          <thead><tr><th>Rack</th><th>Desde</th><th>Hasta</th><th>Hasta nivel</th><th /></tr></thead>
          <tbody>
            {cfg.enrejados.map((x, i) => (
              <tr key={`${i}-${cfg.enrejados.length}`}>
                <td><input type="text" defaultValue={codRack(x.rack)} onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (!v) { e.target.value = codRack(x.rack); return; }
                  setEnrejado(i, { rack: leerRack(v) });
                }} /></td>
                <td><input type="number" min="1" value={x.desde} onChange={(e) => { const v = entero(e.target.value, 1); if (v) setEnrejado(i, { desde: v, hasta: Math.max(v, x.hasta) }); }} /></td>
                <td><input type="number" min="1" value={x.hasta} onChange={(e) => { const v = entero(e.target.value, 1); if (v && v >= x.desde) setEnrejado(i, { hasta: v }); }} /></td>
                <td><input type="number" min="1" placeholder="todo" value={x.hastaNivel ?? ''} onChange={(e) => setEnrejado(i, { hastaNivel: entero(e.target.value, 1) })} /></td>
                <td><button type="button" className="alm-btn-icono" title="Quitar" onClick={() => set('enrejados', cfg.enrejados.filter((_, j) => j !== i))}><FaTrash /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="alm-btn alm-btn-sec" onClick={() => set('enrejados', [...cfg.enrejados, { rack: 'P6', desde: 1, hasta: 1, hastaNivel: null }])}><FaPlus /> Agregar enrejado</button>
        <p className="alm-ayuda">Sirve para cualquier rack (P6, M1, 07…). <b>Hasta nivel</b> vacío = la jaula cubre toda la altura; ej. M1 009–010 hasta el nivel 4 (5 y 6 sin reja).</p>
      </section>

      <section className="alm-card alm-card-ancha">
        <h3>Almacén de médicos</h3>
        <p className="alm-ayuda">
          Va detrás de los racks, pasando el pasillo de atrás. Ubicaciones como <code>M1-009-4</code> o <code>36-005-2</code>.
          Los racks van de izquierda a derecha (desde el lado del rack 01) en el orden de la tabla. <b>Fila</b> = fila de médicos donde arranca
          (1 = junto al pasillo de atrás). <b>Misma línea que</b> = va en la misma línea que otro rack (36 bajo M5, 37 bajo M6).
          La altura de cada rack se pone en <b>Altura</b> (5 o 6 niveles).
        </p>
        <label className="alm-check-linea">
          <input type="checkbox" checked={cfg.medicos.activo} onChange={(e) => setMed('activo', e.target.checked)} /> Mostrar médicos
        </label>
        <div className="alm-grid-form">
          <label>Empieza en X (m desde el borde del rack 01)<input type="number" step="0.5" value={cfg.medicos.x} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setMed('x', v); }} /></label>
          <label>Separación del pasillo de atrás (m)<input type="number" min="0" step="0.1" value={cfg.medicos.separacion} onChange={(e) => { const v = parseFloat(e.target.value); if (v >= 0) setMed('separacion', v); }} /></label>
          <label>Puerta de ingreso (m desde el borde)<input type="number" min="0" step="0.5" value={cfg.medicos.puertaIngreso} onChange={(e) => { const v = parseFloat(e.target.value); if (v >= 0) setMed('puertaIngreso', v); }} /></label>
          <label>Niveles para racks nuevos
            <select value={cfg.medicos.nivelesPorDefecto} onChange={(e) => setMed('nivelesPorDefecto', +e.target.value)}>
              {[4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <label className="alm-check-linea">
          <input type="checkbox" checked={cfg.medicos.cuarto.activo} onChange={(e) => setMed('cuarto', { ...cfg.medicos.cuarto, activo: e.target.checked })} />
          Cuarto cerrado con los racks
          <input type="text" style={{ width: 90 }} defaultValue={cfg.medicos.cuarto.racks.join(', ')}
            onBlur={(e) => setMed('cuarto', { ...cfg.medicos.cuarto, racks: e.target.value.split(/[,;\s]+/).filter(Boolean).map((x) => x.toUpperCase()) })} />
          hasta la fila
          <input type="number" min="1" style={{ width: 60 }} value={cfg.medicos.cuarto.hastaFila} onChange={(e) => { const v = entero(e.target.value, 1); if (v) setMed('cuarto', { ...cfg.medicos.cuarto, hastaFila: v }); }} />
          (Puerta 1 adelante y Puerta atrás)
        </label>
        <table className="alm-tabla">
          <thead><tr><th>Rack</th><th>Desde</th><th>Hasta</th><th>Altura</th><th>Fila</th><th>Pallets</th><th>Pasillo antes</th><th>Misma línea que</th><th /></tr></thead>
          <tbody>
            {cfg.medicos.racks.map((x, i) => (
              <tr key={x.codigo}>
                <td><input type="text" defaultValue={x.codigo} onBlur={(e) => {
                  const v = e.target.value.trim().toUpperCase().replace(/^0+(?=\d)/, '');
                  if (codigoLibre(v, i)) setMedRack(i, { codigo: v });
                  else e.target.value = x.codigo;
                }} /></td>
                <td><input type="number" min="1" value={x.desde} onChange={(e) => { const v = entero(e.target.value, 1); if (v) setMedRack(i, { desde: v, hasta: Math.max(v, x.hasta) }); }} /></td>
                <td><input type="number" min="1" value={x.hasta} onChange={(e) => { const v = entero(e.target.value, 1); if (v && v >= x.desde) setMedRack(i, { hasta: v }); }} /></td>
                <td><input type="number" min="1" value={x.niveles} onChange={(e) => { const v = entero(e.target.value, 1); if (v) setMedRack(i, { niveles: v }); }} /></td>
                <td><input type="number" min="1" value={x.fila} onChange={(e) => { const v = entero(e.target.value, 1); if (v) setMedRack(i, { fila: v }); }} /></td>
                <td><input type="number" min="1" max="4" placeholder={cfg.palletsPorUbicacion} value={x.pallets ?? ''} onChange={(e) => { const v = entero(e.target.value, 1); setMedRack(i, { pallets: v ? Math.min(v, 4) : null }); }} /></td>
                <td style={{ textAlign: 'center' }}>{i === 0 || x.mismaXQue ? '—' : <input type="checkbox" style={{ width: 'auto' }} checked={x.pasilloAntes} onChange={(e) => setMedRack(i, { pasilloAntes: e.target.checked })} />}</td>
                <td>
                  <select value={x.mismaXQue || ''} onChange={(e) => setMedRack(i, { mismaXQue: e.target.value || null })}>
                    <option value="">—</option>
                    {cfg.medicos.racks.filter((o) => o.codigo !== x.codigo && !o.mismaXQue).map((o) => <option key={o.codigo} value={o.codigo}>{o.codigo}</option>)}
                  </select>
                </td>
                <td>
                  <button type="button" className="alm-btn-icono alm-btn-orden" title="Subir" disabled={i === 0} onClick={() => moverMed(i, -1)}>▲</button>
                  <button type="button" className="alm-btn-icono alm-btn-orden" title="Bajar" disabled={i === cfg.medicos.racks.length - 1} onClick={() => moverMed(i, 1)}>▼</button>
                  <button type="button" className="alm-btn-icono" title="Quitar" onClick={() => setMed('racks', cfg.medicos.racks.filter((_, j) => j !== i))}><FaTrash /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="alm-btn alm-btn-sec" onClick={() => {
          let k = 1;
          while (cfg.medicos.racks.some((x) => x.codigo === `M${k}`)) k++;
          setMed('racks', [...cfg.medicos.racks, { codigo: `M${k}`, desde: 1, hasta: 15, niveles: cfg.medicos.nivelesPorDefecto || 6, fila: 1, pasilloAntes: true, mismaXQue: null }]);
        }}><FaPlus /> Agregar rack de médicos</button>
      </section>

      <section className="alm-card alm-card-ancha">
        <h3>Puentes y túneles (paso por debajo del rack)</h3>
        <p className="alm-ayuda">De la profundidad "desde" a "hasta" se quita la parte de abajo (alto libre en niveles base). Racks vacío = todos los del almacén principal; en peligrosos se nombran. Ej.: <code>1-10, 15</code>, <code>23-32</code> o <code>P2, P3, P4, P5</code>.
          <b> Ubic. arriba</b> = cuántas ubicaciones hay sobre el paso (2, 3 o 4; vacío = las que salgan de la altura). <b>Pallets</b> = pallets por ubicación en el puente. <b>A lo ancho</b> = cuántas ubicaciones hay a lo ancho del puente (ej. puente 024–026 con 2: quedan 024 y 025 anchas y la 026 es solo paso; vacío = una por profundidad).</p>
        <table className="alm-tabla">
          <thead><tr><th>Desde</th><th>Hasta</th><th>Alto libre</th><th>Ubic. arriba</th><th>A lo ancho</th><th>Pallets</th><th>Racks</th><th /></tr></thead>
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
                <td><input type="number" min="1" max="10" placeholder="auto" value={b.nivelesArriba ?? ''} onChange={(e) => setPuente(i, 'nivelesArriba', entero(e.target.value, 1))} /></td>
                <td><input type="number" min="1" max={b.hasta - b.desde + 1} placeholder={b.hasta - b.desde + 1} value={b.ubicacionesAncho ?? ''} onChange={(e) => { const v = entero(e.target.value, 1); setPuente(i, 'ubicacionesAncho', v ? Math.min(v, b.hasta - b.desde + 1) : null); }} /></td>
                <td><input type="number" min="1" max="4" placeholder="rack" value={b.pallets ?? ''} onChange={(e) => { const v = entero(e.target.value, 1); setPuente(i, 'pallets', v ? Math.min(v, 4) : null); }} /></td>
                <td><input type="text" placeholder="todos" defaultValue={(b.racks || []).join(', ')} onBlur={(e) => setPuente(i, 'racks', listaRacks(e.target.value))} /></td>
                <td><button type="button" className="alm-btn-icono" title="Quitar" onClick={() => set('puentes', cfg.puentes.filter((_, j) => j !== i))}><FaTrash /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="alm-btn alm-btn-sec" onClick={() => set('puentes', [...cfg.puentes, { desde: 1, hasta: 1, nivelesLibres: 2, racks: [], nivelesArriba: null, pallets: null, ubicacionesAncho: null }])}><FaPlus /> Agregar puente</button>
      </section>

      <section className="alm-card">
        <h3>Columnas y muros</h3>
        <p className="alm-ayuda">
          La columna ocupa el lugar de una o más profundidades. El rack no se alarga ni se mueven los puentes:
          la numeración sigue sin saltarse y el rack termina antes (ej. 044 con una columna de 1 → llega a 043).
          <b> En la posición</b> = posición física donde empieza (como si no hubiera columnas). Racks vacío = todos los del almacén principal;
          en peligrosos y médicos se nombran (ej. <code>M5</code>) y la posición se cuenta desde el inicio de ese rack.
          <b> Muro</b> corta todo el fondo del rack.
        </p>
        <table className="alm-tabla">
          <thead><tr><th>Tipo</th><th>Racks</th><th>En la posición</th><th>Ocupa (profundidades)</th><th /></tr></thead>
          <tbody>
            {cfg.columnas.map((k, i) => (
              <tr key={`${i}-${cfg.columnas.length}`}>
                <td>
                  <select value={k.tipo || 'columna'} onChange={(e) => setColumna(i, { tipo: e.target.value })}>
                    <option value="columna">Columna</option>
                    <option value="muro">Muro</option>
                  </select>
                </td>
                <td><input type="text" placeholder="todos" defaultValue={(k.racks || []).join(', ')} onBlur={(e) => setColumna(i, { racks: listaRacks(e.target.value) })} /></td>
                <td><input type="number" min="1" value={k.desde} onChange={(e) => { const v = entero(e.target.value, 1); if (v) setColumna(i, { desde: v }); }} /></td>
                <td><input type="number" min="1" value={k.ocupa} onChange={(e) => { const v = entero(e.target.value, 1); if (v) setColumna(i, { ocupa: v }); }} /></td>
                <td><button type="button" className="alm-btn-icono" title="Quitar" onClick={() => set('columnas', cfg.columnas.filter((_, j) => j !== i))}><FaTrash /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="alm-btn alm-btn-sec" onClick={() => set('columnas', [...cfg.columnas, { racks: [], desde: 10, ocupa: 1, tipo: 'columna' }])}><FaPlus /> Agregar columna o muro</button>
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
              <option value="pallets">Fijar pallets por ubicación</option>
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
          {rango.accion === 'pallets' && (
            <label>Pallets
              <select value={rango.pallets} onChange={(e) => setRango({ ...rango, pallets: e.target.value })}>
                {OPC_PALLETS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
        </div>
        <button type="button" className="alm-btn" onClick={aplicarRango}>Aplicar</button>
        {msgRango && <span className="alm-msg">{msgRango}</span>}
      </section>

      <section className="alm-card">
        <h3>Por rack</h3>
        <p className="alm-ayuda">Vacío = usa el valor general ({cfg.profundidades} profundidades, altura {cfg.nivelesBase} niveles base, {cfg.palletsPorUbicacion} pallet{cfg.palletsPorUbicacion > 1 ? 's' : ''}). Profundidades = largo del rack sin columnas (044; 23 al 32 llegan a 054). Las columnas descuentan solas.</p>
        <div className="alm-tabla-scroll">
          <table className="alm-tabla">
            <thead><tr><th>Rack</th><th>Profundidades</th><th>Llega a</th><th>Altura (niveles)</th><th>Pallets</th></tr></thead>
            <tbody>
              {Array.from({ length: cfg.racks }, (_, i) => i + 1).map((r) => {
                const d = cfg.racksDetalle[codRack(r)] || {};
                return (
                  <tr key={r}>
                    <td><b>{codRack(r)}</b></td>
                    <td><input type="number" min="1" placeholder={cfg.profundidades} value={d.profundidades ?? ''} onChange={(e) => setRack(r, 'profundidades', entero(e.target.value, 1))} /></td>
                    <td style={{ textAlign: 'center' }}>{String(profundidadesDeRack(cfg, r)).padStart(3, '0')}</td>
                    <td><input type="number" min="1" placeholder={cfg.nivelesBase} value={d.niveles ?? ''} onChange={(e) => setRack(r, 'niveles', entero(e.target.value, 1))} /></td>
                    <td><input type="number" min="1" max="4" placeholder={cfg.palletsPorUbicacion} value={d.pallets ?? ''} onChange={(e) => { const v = entero(e.target.value, 1); setRack(r, 'pallets', v ? Math.min(v, 4) : null); }} /></td>
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
              <thead><tr><th>Rack-Profundidad</th><th>Niveles</th><th>Alturas</th><th>Pallets</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {puntuales.map(([k, d]) => (
                  <tr key={k}>
                    <td><b>{k}</b></td>
                    <td>{d.niveles ?? '—'}</td>
                    <td>{d.alturas ? d.alturas.join(', ') : 'iguales'}</td>
                    <td>{d.pallets ?? '—'}</td>
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
