import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaEdit, FaCheck } from 'react-icons/fa';
import Loading from '../../layouts/Loading';
import './tracking_mhe.css';

// Importamos el servicio
import { obtenerUltimasInspecciones } from '../../services/mheService';

export default function TrackingMHE() {
  const navigate = useNavigate();
  const [inspecciones, setInspecciones] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cargarInspecciones();
  }, []);

  const cargarInspecciones = async () => {
    try {
      const data = await obtenerUltimasInspecciones();
      setInspecciones(data || []);
    } catch (error) {
      console.error("Error al cargar PIV:", error);
    } finally {
      setLoading(false);
    }
  };

  const getBadgeClass = (estado) => {
    if (!estado) return '';
    const est = estado.toUpperCase();
    if (est === 'OPERATIVO' || est === 'APROBADO') return 'operativo';
    if (est === 'OBSERVADO' || est === 'PENDIENTE') return 'observado';
    return 'inoperativo';
  };

  const formatearFecha = (fecha) => {
    if (!fecha) return '-';
    return new Date(fecha).toLocaleString('es-PE', {
      dateStyle: 'short',
      timeStyle: 'short'
    });
  };

  const handleEditar = (insp) => {
    // Redirige al formulario pasando el ID o el objeto de la inspección
    navigate(`/mhe/mhe_evaluar?id=${insp.id}`, { state: { inspeccion: insp } });
  };

  const handleAprobar = async (insp) => {
    if (insp.estado_proceso === 'APROBADO') {
      return alert("Esta inspección ya se encuentra aprobada.");
    }
    const confirmar = window.confirm(`¿Desea aprobar la inspección del equipo ${insp.equipos?.serie || ''}?`);
    if (!confirmar) return;

    // Aquí puedes conectar tu función de aprobar del servicio (ej: aprobarInspeccionMhe(insp.id))
    console.log("Aprobando inspección:", insp.id);
  };

  return (
    <div className="tracking-page">
      {loading && <Loading />}

      <section className="page-hero">
        <div className="hero-titles">
          <span
            className="page-chip"
            style={{
              background: '#e0e7ff',
              color: '#3730a3',
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '11px',
              fontWeight: 'bold',
              marginBottom: '8px',
              display: 'inline-block'
            }}
          >
            Inspecciones
          </span>
          <h1>Tracking PIV (MHE)</h1>
          <p>Listado general de inspecciones diarias de equipos de manipulación.</p>
        </div>
        <button className="btn-nuevo" onClick={() => navigate('/mhe/mhe_evaluar')}>
          + Nueva Inspección
        </button>
      </section>

      <section className="card p-0">
        <div className="table-container" style={{ overflowX: 'auto' }}>
          <table style={{ whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                <th>Fecha y Hora</th>
                <th>Área</th>
                <th>Estado Proceso</th>
                <th>Categoría Equipo</th>
                <th>Equipo (Serie)</th>
                <th>Estado MHE</th>
                <th>Estado Personal</th>
                <th>Registrado Por</th>
                <th>Aprobado Por</th>
                <th>Revisado El</th>
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {inspecciones.length === 0 ? (
                <tr>
                  <td colSpan="11" style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                    No hay inspecciones registradas.
                  </td>
                </tr>
              ) : (
                inspecciones.map((insp) => {
                  const yaAprobado = insp.estado_proceso === 'APROBADO';

                  return (
                    <tr key={insp.id}>
                      {/* 1. Fecha y Hora */}
                      <td>{formatearFecha(insp.fecha_hora)}</td>

                      {/* 2. Área */}
                      <td>{insp.area?.nombre || '-'}</td>

                      {/* 3. Estado Proceso */}
                      <td>
                        <span className={`badge-estado ${getBadgeClass(insp.estado_proceso)}`}>
                          {insp.estado_proceso || 'PENDIENTE'}
                        </span>
                      </td>

                      {/* 4. Categoría Equipo */}
                      <td>{insp.equipos?.categorias_equipos?.nombre || 'N/A'}</td>

                      {/* 5. Equipo (Serie) */}
                      <td style={{ fontWeight: 'bold', color: '#0f172a' }}>
                        {insp.equipos?.serie || 'N/A'}
                      </td>

                      {/* 6. Estado MHE */}
                      <td>
                        <span className={`badge-estado ${getBadgeClass(insp.estado_mhe)}`}>
                          {insp.estado_mhe}
                        </span>
                      </td>

                      {/* 7. Estado Personal */}
                      <td>
                        <span className={`badge-estado ${getBadgeClass(insp.estado_personal)}`}>
                          {insp.estado_personal || 'OPERATIVO'}
                        </span>
                      </td>

                      {/* 8. Registrado Por */}
                      <td>{insp.registrado_por_nombre || '-'}</td>

                      {/* 9. Aprobado Por */}
                      <td>
                        {insp.aprobador?.nombre ||
                         insp.aprobado_por_nombre ||
                         insp.aprobado_por_id ||
                         '-'}
                      </td>

                      {/* 10. Revisado El */}
                      <td>{formatearFecha(insp.revisado_el)}</td>

                      {/* 11. Acciones (Editar / Aprobar) */}
                      <td style={{ textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                          <button
                            type="button"
                            onClick={() => handleEditar(insp)}
                            title="Editar inspección"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              background: '#ffffff',
                              color: '#334155',
                              fontSize: '12px',
                              fontWeight: '700',
                              cursor: 'pointer'
                            }}
                          >
                            <FaEdit style={{ color: '#0284c7' }} />
                            <span>Editar</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleAprobar(insp)}
                            disabled={yaAprobado}
                            title={yaAprobado ? "Ya aprobado" : "Aprobar inspección"}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              border: 'none',
                              background: yaAprobado ? '#e2e8f0' : '#16a34a',
                              color: yaAprobado ? '#64748b' : '#ffffff',
                              fontSize: '12px',
                              fontWeight: '700',
                              cursor: yaAprobado ? 'not-allowed' : 'pointer'
                            }}
                          >
                            <FaCheck />
                            <span>{yaAprobado ? 'Aprobado' : 'Aprobar'}</span>
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
    </div>
  );
}