import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
      // USANDO EL SERVICIO
      const data = await obtenerUltimasInspecciones();
      setInspecciones(data);
    } catch (error) {
      console.error("Error al cargar PIV:", error);
    } finally {
      setLoading(false);
    }
  };

  const getBadgeClass = (estado) => {
    if (estado === 'OPERATIVO') return 'operativo';
    if (estado === 'OBSERVADO') return 'observado';
    return 'inoperativo';
  };

  return (
    <div className="tracking-page">
      {loading && <Loading />}

      <section className="page-hero">
        <div className="hero-titles">
          <span className="page-chip" style={{ background: '#e0e7ff', color: '#3730a3', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 'bold', marginBottom: '8px', display: 'inline-block' }}>Inspecciones</span>
          <h1>Tracking PIV (MHE)</h1>
          <p>Listado general de inspecciones diarias de equipos de manipulación.</p>
        </div>
        <button className="btn-nuevo" onClick={() => navigate('/mhe/mhe_evaluar')}>
          + Nueva Inspección
        </button>
      </section>

      <section className="card p-0">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Fecha y Hora</th>
                <th>Equipo (Serie)</th>
                <th>Operador</th>
                <th>Estado MHE</th>
                <th>Revisión</th>
              </tr>
            </thead>
            <tbody>
              {inspecciones.length === 0 ? (
                <tr><td colSpan="5" style={{textAlign: 'center', padding: '20px'}}>No hay inspecciones registradas.</td></tr>
              ) : (
                inspecciones.map((insp) => (
                  <tr key={insp.id}>
                    <td>{new Date(insp.fecha_hora).toLocaleString()}</td>
                    <td style={{fontWeight: 'bold'}}>{insp.equipos?.serie || 'N/A'}</td>
                    <td>{insp.registrado_por_nombre}</td>
                    <td><span className={`badge-estado ${getBadgeClass(insp.estado_mhe)}`}>{insp.estado_mhe}</span></td>
                    <td>{insp.estado_proceso}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}