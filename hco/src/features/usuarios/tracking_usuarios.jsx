// src/features/usuarios/tracking_usuarios.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabaseClient'; // Asegúrate que esta ruta es correcta
import Loading from "../../layouts/Loading";

import './tracking_usuarios.css';

// Constantes globales de tu sistema original
const TIPOS_USUARIO = ["White", "Blue"];


// Funciones utilitarias
const normalize = (text) => 
  String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

export default function TrackingUsuarios() {
  const navigate = useNavigate();
  
  // Estados de la tabla
  const [allItems, setAllItems] = useState([]);
  const [filteredItems, setFilteredItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ text: '', type: '' }); // type: 'error' | 'success'
  const [listaAreas, setListaAreas] = useState([]);
  

  // Estados de los filtros
  const [filters, setFilters] = useState({
    search: '',
    estado: '',
    tipo: '',
    area: ''
  });

  // Cargar usuarios al iniciar
  useEffect(() => {
    loadUsuarios();
  }, []);

  // Efecto para aplicar filtros cada vez que el usuario escribe o cambia un select
  useEffect(() => {
    applyFilters();
  }, [filters, allItems]);

  const loadUsuarios = async () => {
    setLoading(true);
    setMessage({ text: '', type: '' });

    try {
      // Pedimos todos los empleados a Supabase.
      // Asegúrate que los nombres de las columnas coincidan con las de tu BD.
      const { data, error } = await supabase
        .from('empleados')
        .select('*')
        .order('nombre', { ascending: true });

      if (error) throw error;

      setAllItems(data || []);
    } catch (error) {
      console.error("Error cargando usuarios:", error);
      setMessage({ text: 'Error al consultar la base de datos.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const cargarAreasDB = async () => {
      // Reemplaza 'areas' por el nombre exacto de tu tabla y 'nombre' por la columna
      const { data, error } = await supabase
        .from('areas')
        .select('nombre')
        .order('nombre', { ascending: true }); // Los ordena de la A a la Z

      if (data) {
        setListaAreas(data);
      } else {
        console.error("Error cargando áreas:", error);
      }
    };

    cargarAreasDB();
  }, []);


  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  const applyFilters = () => {
    const { search, estado, tipo, area } = filters;
    const searchNorm = normalize(search);
    const estadoNorm = normalize(estado);
    const tipoNorm = normalize(tipo);
    const areaNorm = normalize(area);

    const filtered = allItems.filter(item => {
      // 1. Filtros exactos (Selects)
      if (estadoNorm && normalize(item.estado) !== estadoNorm) return false;
      if (tipoNorm && normalize(item.tipo) !== tipoNorm) return false;
      if (areaNorm && normalize(item.area) !== areaNorm) return false;

      // 2. Filtro de búsqueda de texto (Input)
      if (searchNorm) {
        // Concatenamos todos los campos clave en un solo texto para buscar rápido
        const blob = normalize([
          item.dni, item.cod_mainchart, item.usuario, item.nombre, 
          item.cargo, item.area, item.jefe_directo
        ].join(" "));
        
        if (!blob.includes(searchNorm)) return false;
      }
      return true;
    });

    setFilteredItems(filtered);
  };

  const limpiarFiltros = () => {
    setFilters({
      search: '',
      estado: '',
      tipo: '',
      area: ''
    });
  };

  const cambiarEstado = async (item) => {
    const nuevoEstado = (item.estado || "").toLowerCase() === "activo" ? "Inactivo" : "Activo";
    const ok = window.confirm(`¿Desea cambiar el estado de ${item.nombre} a ${nuevoEstado}?`);
    
    if (!ok) return;
    setLoading(true);

    try {
      const { error } = await supabase
        .from('empleados')
        .update({ estado: nuevoEstado })
        .eq('id', item.id);

      if (error) throw error;

      setMessage({ text: 'Estado actualizado correctamente.', type: 'success' });
      // Recargamos la lista para ver el cambio
      await loadUsuarios(); 
    } catch (error) {
      console.error(error);
      setMessage({ text: 'No se pudo actualizar el estado.', type: 'error' });
      setLoading(false);
    }
  };

  const handleNuevoUsuario = () => {
    navigate('/usuarios/registra_usuario'); // <--- Actualizado aquí
  };

  const handleEditarUsuario = (id) => {
    navigate(`/usuarios/registra_usuario?id=${id}`); // <--- Actualizado aquí
  };


  return (
    <div className="registro-page">
      <section className="page-hero">
        <span className="page-chip">Administración</span>
        <h1>Tracking de usuarios</h1>
        <p>Consulte, filtre, edite, active o inactive usuarios registrados en la planilla operativa.</p>
      </section>

        <section className="card">
        {/* NUEVO TOOLBAR ORDENADO */}
        <div className="toolbar">
          <div className="toolbar-info">
            <h2>Usuarios</h2>
            <p>{filteredItems.length} usuario(s) encontrado(s)</p>
          </div>
            <div className="toolbar-actions">
                <button className="export-btn">
                {/* Aquí creamos el cuadrito semi-transparente para la X */}
                <span className="excel-icon">X</span> Exportar
                </button>
              <button onClick={handleNuevoUsuario} className="primary-btn">
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  width="16" 
                  height="16" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="3.5" 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  style={{ transform: 'translateY(-1px)' }}
                >
                  <path d="M12 5v14M5 12h14"/>
                </svg>
                Nuevo Usuario
              </button>


            </div>

        </div>

                {/* NUEVOS FILTROS FLEXIBLES */}
        <div className="filters">
          <input 
            type="search" 
            name="search"
            className="search-input"
            placeholder="Buscar por DNI, nombre, usuario o cargo..." 
            value={filters.search}
            onChange={handleFilterChange}
          />
          <select name="estado" value={filters.estado} onChange={handleFilterChange}>
            <option value="">Todos los estados</option>
            <option value="Activo">Activo</option>
            <option value="Inactivo">Inactivo</option>
          </select>
          <select name="tipo" value={filters.tipo} onChange={handleFilterChange}>
            <option value="">Todos los tipos</option>
            {TIPOS_USUARIO.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
                    <select 
            name="area" 
            value={filters.area} 
            onChange={handleFilterChange}
          >
            <option value="">Todas las áreas</option>
            {listaAreas.map((area, index) => (
              <option key={index} value={area.nombre}>
                {area.nombre}
              </option>
            ))}
          </select>


          
          <button onClick={loadUsuarios} className="secondary-btn" title="Actualizar Datos">
            Actualizar
          </button>
          
          <button onClick={limpiarFiltros} className="clear-btn" title="Limpiar Filtros">
            {/* Ícono SVG nativo de "Refrescar/Limpiar" (No necesita FontAwesome) */}
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
            </svg>
          </button>
        </div>



        {/* MENSAJES Y TABLA SIGUEN IGUAL */}
        {message.text && (
          <div className={`form-message ${message.type}`}>
            {message.text}
          </div>
        )}


        <div className="table-wrap">
          <table className="usuarios-table">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Estado</th>
                <th>DNI</th>
                <th>Código MYHR</th>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Cargo</th>
                <th>Área</th>
                <th>Jefe directo</th>
                <th>Usuario</th>
                <th>Foto</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 && !loading ? (
                <tr>
                  <td colSpan="12" className="empty">No hay usuarios para mostrar.</td>
                </tr>
              ) : (
                filteredItems.map((item, index) => {
                  const isActive = (item.estado || "").toLowerCase() === "activo";
                  const hasPhoto = !!item.foto_url;
                  
                  return (
                    <tr key={item.id}>
                      <td>{index + 1}</td>
                      <td>
                        <span className={`estado-pill ${isActive ? "activo" : "inactivo"}`}>
                          {item.estado || 'Inactivo'}
                        </span>
                      </td>
                      <td>{item.dni}</td>
                      <td>{item.cod_mainchart || '-'}</td>
                      <td>{item.nombre}</td>
                      <td>{item.tipo || '-'}</td>
                      <td>{item.cargo || '-'}</td>
                      <td>{item.area || '-'}</td>
                      <td>{item.jefe_directo || '-'}</td>
                      <td>{item.usuario || '-'}</td>
                      <td>
                        <span className={`foto-status ${hasPhoto ? "has" : "no"}`} title={hasPhoto ? "Tiene foto" : "No tiene foto"}>
                          {hasPhoto ? "✓" : "!"}
                        </span>
                      </td>
                      <td>
                        <div className="actions-inline">
                          <button onClick={() => handleEditarUsuario(item.id)} className="icon-btn edit" title="Editar">
                            ✎
                          </button>
                          <button onClick={() => cambiarEstado(item)} className="icon-btn status" title={isActive ? 'Desactivar' : 'Activar'}>
                            ⏻
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Llamada al componente global de Carga */}
      {loading && <Loading />}

    </div>
  );
}
