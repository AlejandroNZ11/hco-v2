import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Loading from "../../layouts/Loading";
import './tracking_usuarios.css';
import * as XLSX from "xlsx-js-style";

// Importaciones Offline-First
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '../../services/localDb';
import { useNetwork } from '../../hooks/useNetwork';

import { 
  FaHome, FaSyncAlt, FaCog, FaKey, FaSignOutAlt, FaExchangeAlt, FaArrowLeft, FaBroom,
  FaEdit, FaPowerOff, FaCheckCircle, FaTimesCircle, FaUser
} from "react-icons/fa";


// Importamos los servicios para sincronizar cuando hay red
import { obtenerTodosLosEmpleados, obtenerAreas, cambiarEstadoEmpleado } from '../../services/empleadosService';

const TIPOS_USUARIO = ["White", "Blue"];

const normalize = (text) =>
  String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

export default function TrackingUsuarios() {
  const navigate = useNavigate();
  const isOnline = useNetwork();

  // 1. LECTURA REACTIVA ESTABLE DESDE DEXIE (Pasamos [] como 3er argumento para evitar nuevas referencias)
  const usuariosDb = useLiveQuery(() => localDb.usuarios.toArray(), [], []);
  const listaAreas = useLiveQuery(() => localDb.areas.toArray(), [], []);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  const [filters, setFilters] = useState({
    search: '',
    estado: '',
    tipo: '',
    area: ''
  });

  // Estado para el modal de confirmación personalizado
  const [confirmModal, setConfirmModal] = useState({
    show: false,
    item: null,
    nuevoEstado: ""
  });

  // =========================================================================
  // EFECTO DE ARRASTRE CON EL MOUSE (MANITO DESLIZANTE EN LA TABLA)
  // =========================================================================
  useEffect(() => {
    const slider = document.querySelector('.table-wrap');
    if (!slider) return;

    let isDown = false;
    let startX;
    let scrollLeft;

    const handleMouseDown = (e) => {
      isDown = true;
      slider.classList.add('active');
      startX = e.pageX - slider.offsetLeft;
      scrollLeft = slider.scrollLeft;
    };

    const handleMouseLeave = () => {
      isDown = false;
      slider.classList.remove('active');
    };

    const handleMouseUp = () => {
      isDown = false;
      slider.classList.remove('active');
    };

    const handleMouseMove = (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - slider.offsetLeft;
      const walk = (x - startX) * 1.5;
      slider.scrollLeft = scrollLeft - walk;
    };

    slider.addEventListener('mousedown', handleMouseDown);
    slider.addEventListener('mouseleave', handleMouseLeave);
    slider.addEventListener('mouseup', handleMouseUp);
    slider.addEventListener('mousemove', handleMouseMove);

    return () => {
      slider.removeEventListener('mousedown', handleMouseDown);
      slider.removeEventListener('mouseleave', handleMouseLeave);
      slider.removeEventListener('mouseup', handleMouseUp);
      slider.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  // =========================================================================
  // SINCRONIZACIÓN INICIAL CON SUPABASE (Con candado para no repetir)
  // =========================================================================
  // SINCRONIZACIÓN INTELIGENTE CON SUPABASE
  const syncIniciado = React.useRef(false);

  useEffect(() => {
    const sincronizarDatos = async () => {
      if (!isOnline || syncIniciado.current) return;
      syncIniciado.current = true;

      // Solo mostramos el spinner de pantalla completa si la base local está vacía
      const mostrarLoader = usuariosDb.length === 0;
      if (mostrarLoader) setLoading(true);

      try {
        // Verificar si hay cambios offline pendientes antes de sobrescribir
        const pendientes = await localDb.sync_queue
          .where('tabla')
          .equals('usuarios')
          .count()
          .catch(() => 0);

        const [datosEmpleados, datosAreas] = await Promise.all([
          obtenerTodosLosEmpleados(),
          obtenerAreas()
        ]);

        if (datosEmpleados && datosEmpleados.length > 0 && pendientes === 0) {
          const empleadosFormateados = datosEmpleados.map(emp => ({
            ...emp,
            cargo: emp.cargo ? emp.cargo.nombre : '-',
            area: emp.area ? emp.area.nombre : '-',
            jefe_directo: emp.jefe ? emp.jefe.nombre : '-'
          }));
          // Actualiza y limpia registros que ya no existan
          await localDb.usuarios.bulkPut(empleadosFormateados);
        }

        if (datosAreas && datosAreas.length > 0) {
          await localDb.areas.bulkPut(datosAreas);
        }
      } catch (error) {
        console.error("Error sincronizando base local:", error);
      } finally {
        if (mostrarLoader) setLoading(false);
      }
    };

    sincronizarDatos();
  }, [isOnline]); // Se ejecuta al montar si hay red o cuando vuelve el internet

  // 2. PROCESAMIENTO LOCAL (Formateo de relaciones y ORDENAMIENTO A-Z)
  const allItems = React.useMemo(() => {
    const empleadosMapeados = usuariosDb.map(emp => ({
      ...emp,
      cargo: (typeof emp.cargo === 'object' ? emp.cargo?.nombre : emp.cargo) || '-',
      area: (typeof emp.area === 'object' ? emp.area?.nombre : emp.area) || '-',
      jefe_directo: (typeof emp.jefe === 'object' ? emp.jefe?.nombre : emp.jefe_directo) || '-'
    }));

    return empleadosMapeados.sort((a, b) => {
      const nombreA = String(a.nombre || "");
      const nombreB = String(b.nombre || "");
      return nombreA.localeCompare(nombreB, 'es', { sensitivity: 'base' });
    });
  }, [usuariosDb]);

  // 2.1. FILTRADO DIRECTO CON USEMEMO (Cero bucles infinitos)
  const filteredItems = React.useMemo(() => {
    const { search, estado, tipo, area } = filters;
    const searchNorm = normalize(search);
    const estadoNorm = normalize(estado);
    const tipoNorm = normalize(tipo);
    const areaNorm = normalize(area);

    return allItems.filter(item => {
      if (estadoNorm && normalize(item.estado) !== estadoNorm) return false;
      if (tipoNorm && normalize(item.tipo) !== tipoNorm) return false;
      if (areaNorm && normalize(item.area) !== areaNorm) return false;

      if (searchNorm) {
        const blob = normalize([
          item.dni, item.cod_mainchart, item.usuario, item.nombre,
          item.cargo, item.area, item.jefe_directo
        ].join(" "));
        if (!blob.includes(searchNorm)) return false;
      }
      return true;
    });
  }, [filters, allItems]);

  useEffect(() => {
    if (!message.text) return;
    const timer = setTimeout(() => {
      setMessage({ text: '', type: '' });
    }, 3000);
    return () => clearTimeout(timer);
  }, [message.text]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  const limpiarFiltros = () => {
    setFilters({ search: '', estado: '', tipo: '', area: '' });
  };

  // 3. FUNCIONES DE MODAL Y MUTACIÓN OFFLINE-FIRST
  const abrirConfirmacionEstado = (item) => {
    const nuevoEstado = (item.estado || "").toLowerCase() === "activo" ? "Inactivo" : "Activo";
    setConfirmModal({
      show: true,
      item,
      nuevoEstado
    });
  };

  const confirmarCambioEstado = async () => {
    const { item, nuevoEstado } = confirmModal;
    setConfirmModal({ show: false, item: null, nuevoEstado: "" });

    try {
      await localDb.usuarios.update(item.id, { estado: nuevoEstado });

      if (isOnline) {
        await cambiarEstadoEmpleado(item.id, nuevoEstado);
        setMessage({ text: 'Estado actualizado en el servidor.', type: 'success' });
      } else {
        await localDb.sync_queue.add({
          tabla: 'usuarios',
          operacion: 'UPDATE',
          payload: { id: item.id, estado: nuevoEstado }
        });
        setMessage({ text: 'Modo Offline: Estado guardado localmente.', type: 'warning' });
      }
    } catch (error) {
      console.error(error);
      setMessage({ text: 'No se pudo actualizar el estado.', type: 'error' });
    }
  };

  const handleNuevoUsuario = () => navigate('/usuarios/registra_usuario');
  const handleEditarUsuario = (id) => navigate(`/usuarios/registra_usuario?id=${id}`);

  const obtenerFechaArchivo = () => {
    const hoy = new Date();
    const dia = String(hoy.getDate()).padStart(2, "0");
    const mes = String(hoy.getMonth() + 1).padStart(2, "0");
    return `${dia}-${mes}-${hoy.getFullYear()}`;
  };

  const exportarExcelUsuarios = () => {
    try {
      if (!filteredItems || filteredItems.length === 0) {
        setMessage({ text: "No hay usuarios para exportar.", type: "error" });
        return;
      }
      setLoading(true);

      const rows = filteredItems.map((item, index) => ({
        "N°": index + 1, "estado": item.estado || "", "dni": item.dni || "",
        "cod_mainchart": item.cod_mainchart || "", "nombre": item.nombre || "",
        "sexo": item.sexo || "", "tipo": item.tipo || "", "cargo": item.cargo || "",
        "area": item.area || "", "jefe_directo": item.jefe_directo || "",
        "correo_ceva": item.correo_ceva || "", "correo_3m": item.correo_3m || "",
        "usuario": item.usuario || "", "rubrica": item.rubrica || ""
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet["!cols"] = [
        { wch: 6 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 35 }, { wch: 14 },
        { wch: 12 }, { wch: 28 }, { wch: 28 }, { wch: 35 }, { wch: 30 }, { wch: 30 },
        { wch: 30 }, { wch: 25 }
      ];

      const headerStyle = {
        fill: { patternType: "solid", fgColor: { rgb: "002060" } },
        font: { color: { rgb: "FFFFFF" }, bold: true },
        alignment: { horizontal: "center", vertical: "center" }
      };

      const range = XLSX.utils.decode_range(worksheet["!ref"]);
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        if (worksheet[cellAddress]) worksheet[cellAddress].s = headerStyle;
      }
      worksheet["!rows"] = [{ hpt: 22 }];
      worksheet["!autofilter"] = { ref: worksheet["!ref"] };

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Usuarios");
      XLSX.writeFile(workbook, `usuarios ${obtenerFechaArchivo()}.xlsx`);

      setMessage({ text: "Excel exportado correctamente.", type: "success" });
    } catch (error) {
      console.error("Error exportando Excel:", error);
      setMessage({ text: "No se pudo exportar el Excel.", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tracking-usuarios-page">
      <section className="page-hero">
        <span className="page-chip">Administración</span>
        <h1>Tracking de usuarios {isOnline ? '🟢' : '🔴 (Sin Conexión)'}</h1>
        <p>Consulte, filtre, edite, active o inactive usuarios registrados en la planilla operativa.</p>
      </section>

      <section className="tracking-card">

        <div className="toolbar">
          <div className="toolbar-info">
            <h2>Usuarios</h2>
            <p>{filteredItems.length} usuario(s) encontrado(s)</p>
          </div>

          <div className="toolbar-actions">
            <button type="button" className="export-btn" onClick={exportarExcelUsuarios} disabled={loading}>
              <span className="excel-icon">X</span>
              {loading ? "Exportando..." : "Exportar"}
            </button>
            <button type="button" onClick={handleNuevoUsuario} className="primary-btn">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'translateY(-1px)' }}>
                <path d="M12 5v14M5 12h14" />
              </svg>
              Nuevo Usuario
            </button>
          </div>
        </div>

        <div className="filters">
          <input type="search" name="search" className="search-input" placeholder="Buscar por DNI, nombre, usuario o cargo..." value={filters.search} onChange={handleFilterChange} />
          <select name="estado" value={filters.estado} onChange={handleFilterChange}>
            <option value="">Todos los estados</option>
            <option value="Activo">Activo</option>
            <option value="Inactivo">Inactivo</option>
          </select>
          <select name="tipo" value={filters.tipo} onChange={handleFilterChange}>
            <option value="">Todos los tipos</option>
            <option value="White">White</option>
            <option value="Blue">Blue</option>
          </select>
          
          <select name="area" value={filters.area} onChange={handleFilterChange}>
            <option value="">Todas las áreas</option>
            {listaAreas.map((area, index) => {
              const nombreArea = typeof area === 'object' ? (area?.nombre || '') : String(area || '');
              if (!nombreArea) return null;
              return (
                <option key={area?.id || index} value={nombreArea}>
                  {nombreArea}
                </option>
              );
            })}
          </select>
          
          <button type="button" onClick={limpiarFiltros} className="clear-btn" title="Limpiar Filtros">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
            </svg>
          </button>
        </div>
        
        {message.text && (
          <div className={`toast-message ${message.type}`}>{message.text}</div>
        )}

        <div className="table-wrap">
          <table className="usuarios-table">
            <thead>
              <tr>
                <th>Nº</th><th>Estado</th><th>DNI</th><th>Código MYHR</th><th>Nombre</th>
                <th>Tipo</th><th>Cargo</th><th>Área</th><th>Jefe directo</th><th>Usuario</th>
                <th>Foto</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 && !loading ? (
                <tr><td colSpan="12" className="empty">No hay usuarios para mostrar.</td></tr>
              ) : (
                filteredItems.map((item, index) => {
                  const isActive = (item.estado || "").toLowerCase() === "activo";
                  const hasPhoto = !!item.foto_url;
                  return (
                    <tr key={item.id}>
                      <td>{index + 1}</td>
                      <td><span className={`estado-pill ${isActive ? "activo" : "inactivo"}`}>{item.estado || 'Inactivo'}</span></td>
                      <td>{item.dni}</td>
                      <td>{item.cod_mainchart || '-'}</td>
                      <td>{item.nombre}</td>
                      <td>{item.tipo || '-'}</td>
                      <td>{item.cargo || '-'}</td>
                      <td>{item.area || '-'}</td>
                      <td>{item.jefe_directo || '-'}</td>
                      <td>{item.usuario ? item.usuario.split('@')[0].toUpperCase() : '-'}</td>
                      <td>
                        <span 
                          className={`foto-status-icon ${hasPhoto ? "has" : "no"}`} 
                          title={hasPhoto ? "Tiene foto" : "No tiene foto"}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyModel: 'center',
                            color: hasPhoto ? '#0f883b' : '#adabab', // Verde si tiene, rojo si no
                            fontSize: '16px'
                          }}
                        >
                          <FaUser />
                        </span>
                      </td>

                      <td>
                          <div className="actions-inline">
                            <button type="button" onClick={() => handleEditarUsuario(item.id)} className="icon-btn edit" title="Editar usuario">
                              <FaEdit size={14} />
                            </button>
                            <button type="button" onClick={() => abrirConfirmacionEstado(item)} className="icon-btn status" title={isActive ? 'Desactivar' : 'Activar'}>
                              <FaPowerOff size={13} />
                            </button>
                          </div>
                        </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {loading && <Loading />}

      {/* MODAL DE CONFIRMACIÓN MODERNO (Bootstrap 5 + Tailwind) */}
      {confirmModal.show && (
        <div className="modal fade show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-0 shadow-lg rounded-4 p-4 text-center bg-white">
              
              {/* Icono superior llamativo */}
              <div className="mx-auto d-flex align-items-center justify-content-center rounded-circle bg-warning bg-opacity-10 text-warning mb-3" style={{ width: '56px', height: '56px', fontSize: '24px' }}>
                ⚠️
              </div>

              <h4 className="fw-bold text-dark mb-2" style={{ fontSize: '18px' }}>
                ¿Cambiar estado de usuario?
              </h4>

              <p className="text-muted fs-6 mb-4 px-2">
                ¿Deseas cambiar el estado de <strong className="text-dark">{confirmModal.item?.nombre}</strong> a <span className={`badge ${confirmModal.nuevoEstado === 'Activo' ? 'bg-success' : 'bg-danger'}`}>{confirmModal.nuevoEstado}</span>?
              </p>

              <div className="d-flex justify-content-center gap-2">
                <button
                  type="button"
                  className="btn btn-light text-secondary fw-bold px-4 py-2 rounded-3 border-0 shadow-sm"
                  onClick={() => setConfirmModal({ show: false, item: null, nuevoEstado: "" })}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-primary fw-bold px-4 py-2 rounded-3 shadow-sm"
                  style={{ background: '#0f4c81', border: 'none' }}
                  onClick={confirmarCambioEstado}
                >
                  Sí, cambiar
                </button>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}