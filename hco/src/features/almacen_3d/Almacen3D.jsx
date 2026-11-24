import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaWarehouse, FaSave, FaSearch, FaFileExcel, FaFileUpload, FaLock, FaTimes, FaUndoAlt } from 'react-icons/fa';
import * as XLSX from 'xlsx';
import { cargarConfigAlmacen, guardarConfigAlmacen } from '../../services/almacenService';
import {
  claveProf, codProf, codRack, codigoUbicacion, colorCliente, generarCatalogo, infoProfundidad,
  esRackPeligrosos, leerAlturas, leerRack, listaRacks, normalizarUbicacion, separarCodigo,
} from './almacenModelo';
import { AlzadoRack, Planta } from './Vista2D';
import EditorConfig from './EditorConfig';
import './almacen.css';

const Vista3D = lazy(() => import('./Vista3D'));

const VISTAS = [
  ['planta', '2D Planta'],
  ['rack', '2D Rack'],
  ['3d', '3D'],
  ['config', 'Configurar'],
];

const MSG_SIN_ACCESO = 'No tienes acceso: solo el rol Superadministrador puede configurar el almacén.';

// Rol del usuario con sesión (mismo origen que el menú: authUser en local/sessionStorage)
const esSuperAdmin = () => {
  try {
    const u = JSON.parse(localStorage.getItem('authUser') || sessionStorage.getItem('authUser') || 'null');
    const rol = String(u?.rol || u?.role || u?.roles?.nombre || '').toUpperCase().replace(/[\s_-]+/g, '');
    return rol === 'SUPERADMIN';
  } catch {
    return false;
  }
};

const sinTildes = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Lee un Excel de ocupación. Necesita una columna "Ubicación"; opcionales SKU, Cliente y Cantidad.
const leerOcupacion = async (archivo) => {
  const wb = XLSX.read(await archivo.arrayBuffer(), { type: 'array' });
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  if (!filas.length) throw new Error('El archivo está vacío.');
  const cols = Object.keys(filas[0]);
  const buscar = (...claves) => cols.find((c) => claves.some((k) => sinTildes(c).includes(k)));
  const cUbi = buscar('ubic', 'location');
  if (!cUbi) throw new Error('No se encontró la columna "Ubicación".');
  const cSku = buscar('sku', 'item', 'articulo', 'codigo');
  const cCli = buscar('cliente', 'propietario', 'compan', 'owner');
  const cCant = buscar('cant', 'unid', 'qty');
  const datos = {};
  const malas = new Set();
  filas.forEach((f) => {
    const cod = normalizarUbicacion(f[cUbi]);
    if (!cod) {
      if (String(f[cUbi]).trim()) malas.add(String(f[cUbi]).trim());
      return;
    }
    const d = (datos[cod] ||= { skus: [], unidades: 0, cliente: '' });
    const sku = cSku ? String(f[cSku]).trim() : '';
    if (sku && !d.skus.includes(sku)) d.skus.push(sku);
    d.unidades += cCant ? Number(f[cCant]) || 0 : 0;
    if (cCli && !d.cliente) d.cliente = String(f[cCli]).trim();
  });
  return { datos, malas: [...malas] };
};

export default function Almacen3D() {
  const [cfg, setCfgInterno] = useState(null);
  const [guardada, setGuardada] = useState(null);
  const [origen, setOrigen] = useState('');
  const [aviso, setAviso] = useState('');
  const [guardando, setGuardando] = useState(false);
  // Solo el rol SUPERADMIN configura el almacén; los demás solo miran.
  const [puedeConfigurar] = useState(esSuperAdmin);
  const [vista, setVista] = useState(() => {
    const v = localStorage.getItem('almacen3d.vista') || 'planta';
    return v === 'config' && !esSuperAdmin() ? 'planta' : v;
  });
  const [rack, setRack] = useState(1);
  const [seleccion, setSeleccion] = useState(null); // código de ubicación RR-PPP-N
  const [selProf, setSelProf] = useState(null); // { rack, prof }
  const [busqueda, setBusqueda] = useState('');
  const [ocupacion, setOcupacion] = useState({});
  const [infoOcupacion, setInfoOcupacion] = useState('');
  const modoColor = 'cliente'; // futuro: condición, rotación
  const [tip, setTip] = useState(null);
  const archivoRef = useRef(null);

  useEffect(() => {
    cargarConfigAlmacen().then((r) => {
      setCfgInterno(r.config);
      setGuardada(JSON.stringify(r.config));
      setOrigen(r.origen);
      if (r.aviso) setAviso(r.aviso);
    });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('almacen3d.vista', vista);
    } catch { /* ignorar */ }
  }, [vista]);

  const setCfg = useCallback((upd) => setCfgInterno((c) => (typeof upd === 'function' ? upd(c) : upd)), []);
  const sucia = cfg && JSON.stringify(cfg) !== guardada;

  const catalogo = useMemo(() => (cfg ? generarCatalogo(cfg) : []), [cfg]);
  const validas = useMemo(() => new Set(catalogo.map((u) => u.codigo)), [catalogo]);
  const clientes = useMemo(() => [...new Set(Object.values(ocupacion).map((d) => d.cliente).filter(Boolean))].sort(), [ocupacion]);
  const ocupadas = useMemo(() => Object.keys(ocupacion).filter((c) => validas.has(c)).length, [ocupacion, validas]);
  const fueraDeCatalogo = useMemo(() => Object.keys(ocupacion).filter((c) => !validas.has(c)), [ocupacion, validas]);

  const guardar = async () => {
    setGuardando(true);
    const r = await guardarConfigAlmacen(cfg);
    setGuardando(false);
    setGuardada(JSON.stringify(cfg));
    setOrigen(r.ok ? 'nube' : 'local');
    setAviso(r.ok ? '' : r.aviso);
  };

  const descartar = () => setCfgInterno(JSON.parse(guardada));

  const seleccionarUbicacion = useCallback((cod) => {
    const { rack: r, prof: p } = separarCodigo(cod);
    setSeleccion(cod);
    setSelProf({ rack: r, prof: p });
    setRack(r);
  }, []);

  const seleccionarProf = useCallback((r, p) => {
    setSelProf({ rack: r, prof: p });
    setSeleccion(null);
    setRack(r);
  }, []);

  const hover = useCallback((texto, x, y) => setTip(texto ? { texto, x, y } : null), []);
  const hover3d = useCallback(
    (cod, x, y) => {
      if (!cod) return setTip(null);
      const d = ocupacion[cod];
      setTip({ texto: d ? `${cod} · ${d.cliente || 'Sin cliente'} · ${d.skus.length} SKU · ${d.unidades} und` : cod, x, y });
    },
    [ocupacion],
  );

  const buscar = (e) => {
    e.preventDefault();
    const cod = normalizarUbicacion(busqueda);
    if (!cod) return setAviso('Formato: RR-PPP-N, ej. 07-007-3 o P2-007-1');
    if (!validas.has(cod)) return setAviso(`${cod} no existe en la configuración actual.`);
    setAviso('');
    seleccionarUbicacion(cod);
    if (vista === 'config' || vista === 'planta') setVista('rack');
  };

  const cargarArchivo = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const { datos, malas } = await leerOcupacion(f);
      setOcupacion(datos);
      setInfoOcupacion(`${f.name}: ${Object.keys(datos).length} ubicaciones con stock${malas.length ? ` · ${malas.length} códigos no reconocidos` : ''}`);
    } catch (err) {
      setAviso(err.message);
    }
  };

  const exportarCatalogo = () => {
    const filas = catalogo.map((u) => ({ Ubicacion: u.codigo, Rack: codRack(u.rack), Profundidad: codProf(u.prof), Nivel: u.nivel, Pallets: u.pallets }));
    const ws = XLSX.utils.json_to_sheet(filas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ubicaciones');
    XLSX.writeFile(wb, `ubicaciones_almacen_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Edición rápida de la profundidad seleccionada
  const editarProf = (cambios) =>
    setCfg((c) => {
      const k = claveProf(selProf.rack, selProf.prof);
      const d = { ...(c.posiciones[k] || {}), ...cambios };
      Object.keys(d).forEach((x) => (d[x] == null || d[x] === false) && delete d[x]);
      const posiciones = { ...c.posiciones };
      if (Object.keys(d).length) posiciones[k] = d;
      else delete posiciones[k];
      return { ...c, posiciones };
    });

  if (!cfg) return <div className="alm-wrapper"><p className="alm-cargando">Cargando almacén…</p></div>;

  const infoSel = selProf ? infoProfundidad(cfg, selProf.rack, selProf.prof) : null;

  return (
    <div className="alm-wrapper">
      <header className="alm-header">
        <div className="alm-titulo">
          <span className="alm-icono"><FaWarehouse /></span>
          <div>
            <h1>Almacén 3D y 2D</h1>
            <p>
              {cfg.racks} racks · {catalogo.length.toLocaleString()} ubicaciones
              {Object.keys(ocupacion).length > 0 && ` · ocupadas ${ocupadas.toLocaleString()} (${Math.round((ocupadas / catalogo.length) * 100)}%)`}
              <span className={`alm-badge alm-badge-${origen}`}>{origen === 'nube' ? 'Guardado en la nube' : origen === 'local' ? 'Solo en este navegador' : 'Configuración inicial'}</span>
            </p>
          </div>
        </div>
        <div className="alm-acciones">
          <form onSubmit={buscar} className="alm-buscar">
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar 07-007-3" />
            <button type="submit" title="Buscar"><FaSearch /></button>
          </form>
          <button type="button" className="alm-btn alm-btn-sec" onClick={() => archivoRef.current?.click()} title="Excel con columna Ubicación (y opcional SKU, Cliente, Cantidad)">
            <FaFileUpload /> Cargar ocupación
          </button>
          <input ref={archivoRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={cargarArchivo} />
          <button type="button" className="alm-btn alm-btn-sec" onClick={exportarCatalogo}><FaFileExcel /> Exportar ubicaciones</button>
          {puedeConfigurar && sucia && <button type="button" className="alm-btn alm-btn-sec" onClick={descartar}><FaUndoAlt /> Descartar</button>}
          {puedeConfigurar && (
            <button type="button" className="alm-btn" disabled={!sucia || guardando} onClick={guardar}>
              <FaSave /> {guardando ? 'Guardando…' : sucia ? 'Guardar cambios' : 'Guardado'}
            </button>
          )}
        </div>
      </header>

      {aviso && <div className="alm-aviso">{aviso}<button type="button" onClick={() => setAviso('')}><FaTimes /></button></div>}
      {infoOcupacion && (
        <div className="alm-info">
          {infoOcupacion}
          {fueraDeCatalogo.length > 0 && ` · ${fueraDeCatalogo.length} con stock fuera de la configuración (ej. ${fueraDeCatalogo.slice(0, 3).join(', ')})`}
          <button type="button" onClick={() => { setOcupacion({}); setInfoOcupacion(''); }}><FaTimes /> Quitar</button>
        </div>
      )}

      <nav className="alm-tabs">
        {VISTAS.map(([k, t]) => {
          const bloqueado = k === 'config' && !puedeConfigurar;
          return (
            <button key={k} type="button" title={bloqueado ? MSG_SIN_ACCESO : undefined}
              className={`${vista === k ? 'activo' : ''} ${bloqueado ? 'bloqueado' : ''}`}
              aria-disabled={bloqueado || undefined}
              onClick={() => (bloqueado ? setAviso(MSG_SIN_ACCESO) : setVista(k))}>
              {bloqueado && <FaLock />} {t}
            </button>
          );
        })}
        {vista === 'rack' && (
          <select value={rack} onChange={(e) => setRack(leerRack(e.target.value))} className="alm-sel-rack">
            {listaRacks(cfg).map((r) => <option key={r} value={r}>{esRackPeligrosos(r) ? `Peligrosos ${r}` : `Rack ${codRack(r)}`}</option>)}
          </select>
        )}
        {(vista === '3d' || vista === 'rack') && clientes.length > 0 && (
          <span className="alm-leyenda">
            {clientes.slice(0, 12).map((c) => (
              <span key={c}><i style={{ background: colorCliente(clientes, c) }} />{c}</span>
            ))}
          </span>
        )}
        {vista === 'planta' && (
          <span className="alm-leyenda">
            {Object.keys(ocupacion).length ? (
              <>
                <span><i style={{ background: '#e2e8f0' }} />Vacía</span>
                <span><i style={{ background: '#22c55e' }} />&lt; 50%</span>
                <span><i style={{ background: '#eab308' }} />50–79%</span>
                <span><i style={{ background: '#ef4444' }} />≥ 80%</span>
              </>
            ) : (
              <span>El número = niveles de altura · azul más oscuro = más niveles</span>
            )}
            <span><i className="alm-i-puente" />Puente</span>
            <span><i className="alm-i-cambio" />Cambio puntual</span>
          </span>
        )}
      </nav>

      <div className="alm-cuerpo">
        <main className="alm-lienzo">
          {vista === 'planta' && (
            <Planta cfg={cfg} ocupacion={ocupacion} seleccionProf={selProf ? claveProf(selProf.rack, selProf.prof) : null}
              onSeleccionarProf={seleccionarProf} onHover={hover} />
          )}
          {vista === 'rack' && (
            <AlzadoRack cfg={cfg} rack={rack} ocupacion={ocupacion} clientes={clientes} seleccion={seleccion}
              seleccionProf={selProf ? claveProf(selProf.rack, selProf.prof) : null}
              onSeleccionar={seleccionarUbicacion} onSeleccionarProf={seleccionarProf} onHover={hover} />
          )}
          {vista === '3d' && (
            <Suspense fallback={<p className="alm-cargando">Cargando 3D…</p>}>
              <Vista3D cfg={cfg} ocupacion={ocupacion} clientes={clientes} modoColor={modoColor}
                seleccion={seleccion} onSeleccionar={seleccionarUbicacion} onHover={hover3d} />
            </Suspense>
          )}
          {vista === 'config' && puedeConfigurar && <EditorConfig cfg={cfg} setCfg={setCfg} />}
        </main>

        {selProf && vista !== 'config' && infoSel && (
          <aside className="alm-panel">
            <div className="alm-panel-cab">
              <h3>{claveProf(selProf.rack, selProf.prof)}</h3>
              <button type="button" onClick={() => { setSelProf(null); setSeleccion(null); }}><FaTimes /></button>
            </div>
            <p className="alm-ayuda">
              Rack {codRack(selProf.rack)} · Profundidad {codProf(selProf.prof)}
              {` · Altura ${infoSel.altura} niveles base`}
              {infoSel.puente && ` · Puente: existe desde el nivel ${infoSel.desde}`}
              {infoSel.enrejado && ' · Enrejado'}
              {` · ${infoSel.pallets} pallet${infoSel.pallets > 1 ? 's' : ''} por ubicación`}
            </p>
            {!puedeConfigurar && <p className="alm-sin-acceso"><FaLock /> Solo lectura. No tienes acceso para editar.</p>}
            {puedeConfigurar && <div className="alm-panel-edit">
              <label>Niveles
                <input type="number" min="1" value={infoSel.niveles}
                  onChange={(e) => { const n = parseInt(e.target.value, 10); if (n >= 1) editarProf({ niveles: n, alturas: null }); }} />
              </label>
              <label>Alturas (abajo → arriba)
                <input key={`${claveProf(selProf.rack, selProf.prof)}-${infoSel.alturas.join(',')}`} type="text" className="alm-in-alturas"
                  defaultValue={infoSel.alturasPersonalizadas ? infoSel.alturas.join(', ') : ''}
                  placeholder={`iguales (suma ${infoSel.altura})`}
                  onBlur={(e) => {
                    const t = e.target.value.trim();
                    if (!t) return editarProf({ alturas: null });
                    const a = leerAlturas(t);
                    const suma = a ? a.reduce((s, x) => s + x, 0) : 0;
                    if (!a || a.length !== infoSel.niveles || Math.abs(suma - infoSel.altura) > 0.01) {
                      setAviso(`Alturas: ${infoSel.niveles} números que sumen ${infoSel.altura} (ej. ${infoSel.niveles === 4 && infoSel.altura === 6 ? '1,1,2,2' : 'iguales'})`);
                      e.target.value = infoSel.alturasPersonalizadas ? infoSel.alturas.join(', ') : '';
                      return;
                    }
                    editarProf({ alturas: a });
                  }} />
              </label>
              <label>Pallets por ubicación
                <select value={infoSel.pallets} onChange={(e) => editarProf({ pallets: +e.target.value })}>
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="alm-check">
                <input type="checkbox" checked={infoSel.inactiva} onChange={(e) => editarProf({ inactiva: e.target.checked })} /> Inactiva
              </label>
              {infoSel.cambiada && <button type="button" className="alm-btn alm-btn-sec" onClick={() => editarProf({ niveles: null, inactiva: null, alturas: null, pallets: null })}>Volver al general</button>}
            </div>}
            <ul className="alm-niveles">
              {Array.from({ length: infoSel.niveles }, (_, i) => infoSel.niveles - i).map((n) => {
                const cod = codigoUbicacion(selProf.rack, selProf.prof, n);
                const existe = !infoSel.inactiva && n >= infoSel.desde;
                const d = ocupacion[cod];
                return (
                  <li key={n} className={`${seleccion === cod ? 'sel' : ''} ${existe ? '' : 'no-existe'}`} onClick={() => existe && seleccionarUbicacion(cod)}>
                    <b>{cod}</b>
                    <span>{!existe ? (infoSel.puente ? 'Puente' : 'No existe') : d ? `${d.cliente || 'Sin cliente'} · ${d.skus.length} SKU · ${d.unidades} und` : Object.keys(ocupacion).length ? 'Vacía' : ''}</span>
                    {d?.skus?.length > 0 && seleccion === cod && <small>{d.skus.slice(0, 10).join(', ')}{d.skus.length > 10 ? '…' : ''}</small>}
                  </li>
                );
              })}
            </ul>
            {puedeConfigurar && sucia && <p className="alm-msg">Hay cambios sin guardar.</p>}
          </aside>
        )}
      </div>

      {tip && <div className="alm-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>{tip.texto}</div>}
    </div>
  );
}
