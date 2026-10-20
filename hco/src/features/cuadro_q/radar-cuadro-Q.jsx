import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Loading from '../../layouts/Loading';
import './radar-cuadro-Q.css';

import { obtenerRegistrosCuadroQ } from '../../services/cuadroQService';

function getStoredAuthUser() {
  const raw = localStorage.getItem("authUser") || sessionStorage.getItem("authUser");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const MONTHS = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL",
  "MAYO", "JUNIO", "JULIO", "AGOSTO",
  "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
];

// Matriz de posiciones exacta para formar la "Q"
const Q_POSITIONS = {
  1: [1, 7],   2: [1, 8],   3: [2, 9],   4: [3, 10],  5: [4, 11],  6: [5, 11],
  7: [6, 11],  8: [7, 11],  9: [8, 11],  10: [9, 11], 11: [10, 11], 12: [11, 11],
  13: [12, 10], 14: [13, 9], 15: [14, 9], 16: [16, 10], 17: [15, 9], 18: [14, 8],
  19: [14, 7],  20: [13, 6], 21: [12, 5], 22: [11, 4], 23: [10, 4], 24: [9, 4],
  25: [8, 4],   26: [7, 4],  27: [6, 4],  28: [5, 4],  29: [4, 4],  30: [3, 5],
  31: [2, 6]
};

export default function RadarCuadroQ() {
  const navigate = useNavigate();
  const [currentUser] = useState(() => getStoredAuthUser());
  const [loading, setLoading] = useState(true);

  const currentYearNum = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYearNum);
  const [selectedArea, setSelectedArea] = useState('');

  const [registros, setRegistros] = useState([]);

  useEffect(() => {
    if (!currentUser) {
      navigate('/');
      return;
    }
    cargarDatos();
  }, [currentUser, navigate]);

  const cargarDatos = async () => {
    setLoading(true);
    try {
      const dataReg = await obtenerRegistrosCuadroQ();
      setRegistros(dataReg || []);
    } catch (error) {
      console.error("Error al cargar datos para el Radar Q:", error);
    } finally {
      setLoading(false);
    }
  };

  // Extraer ÚNICAMENTE los años que existen en la base de datos
  const listaAnios = useMemo(() => {
    const aniosSet = new Set();
    registros.forEach((reg) => {
      const fecha = reg.fecha_registro || reg.fecha_hora_actualiza;
      if (fecha) {
        const match =
          String(fecha).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) ||
          String(fecha).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (match) {
          const anio = match[1].length === 4 ? match[1] : match[3];
          aniosSet.add(Number(anio));
        }
      }
    });

    if (aniosSet.size === 0) {
      aniosSet.add(currentYearNum);
    }

    return Array.from(aniosSet).sort((a, b) => b - a);
  }, [registros, currentYearNum]);

  // Ajustar año seleccionado si no está en la lista de años de la BD
  useEffect(() => {
    if (listaAnios.length > 0 && !listaAnios.includes(Number(selectedYear))) {
      setSelectedYear(listaAnios[0]);
    }
  }, [listaAnios, selectedYear]);

  // Lista única de áreas de error para el filtro
  const listaAreas = useMemo(() => {
    const areasSet = new Set();
    registros.forEach((reg) => {
      if (reg.area_error) areasSet.add(String(reg.area_error).trim());
    });
    return Array.from(areasSet).sort();
  }, [registros]);

  // Filtrar registros por año y área seleccionada
  const registrosFiltrados = useMemo(() => {
    return registros.filter((reg) => {
      const fechaTxt = reg.fecha_registro || reg.fecha_hora_actualiza || '';
      const date = parseDateText(fechaTxt);
      if (date && date.getFullYear() !== Number(selectedYear)) {
        return false;
      }

      if (selectedArea) {
        const areaReg = String(reg.area_error || '').trim().toLowerCase();
        if (areaReg !== selectedArea.toLowerCase()) return false;
      }
      return true;
    });
  }, [registros, selectedArea, selectedYear]);

  // Construir índice de días
  const dayIndex = useMemo(() => {
    const map = {};

    registrosFiltrados.forEach((item) => {
      if (isCanceled(item)) return;
      if (!isApproved(item)) return;

      const fechaTxt = item.fecha_registro || item.fecha_hora_actualiza || '';
      const date = parseDateText(fechaTxt);
      if (!date) return;
      if (date.getFullYear() !== Number(selectedYear)) return;

      const key = dateKey(date);
      if (!map[key]) {
        map[key] = { approved: 0, rejection: 0 };
      }

      map[key].approved++;
      if (hasRejection(item)) {
        map[key].rejection++;
      }
    });

    return map;
  }, [registrosFiltrados, selectedYear]);

  // Feriados de Perú
  function getPeruHolidays(year) {
    const holidays = {};
    const add = (m, d) => {
      holidays[dateKey(new Date(year, m - 1, d))] = true;
    };

    add(1, 1);   // Año Nuevo
    add(5, 1);   // Día del Trabajo
    add(6, 7);   // Batalla de Arica
    add(6, 29);  // San Pedro y San Pablo
    add(7, 23);  // FAP
    add(7, 28);  // Fiestas Patrias
    add(7, 29);  // Fiestas Patrias
    add(8, 6);   // Batalla de Junín
    add(8, 30);  // Santa Rosa de Lima
    add(10, 8);  // Combate de Angamos
    add(11, 1);  // Todos los Santos
    add(12, 8);  // Inmaculada Concepción
    add(12, 9);  // Batalla de Ayacucho
    add(12, 25); // Navidad

    const easter = getEasterDate(year);
    holidays[dateKey(addDays(easter, -3))] = true; // Jueves Santo
    holidays[dateKey(addDays(easter, -2))] = true; // Viernes Santo

    return holidays;
  }

  function getEasterDate(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function parseDateText(text) {
    text = String(text || "").trim();
    const m1 = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m1) return new Date(Number(m1[3]), Number(m1[2]) - 1, Number(m1[1]));

    const m2 = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m2) return new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
    return null;
  }

  function dateKey(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function stripTime(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function normalize(value) {
    return String(value || "").toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function isApproved(item) {
    const ev = normalize(item.evaluacion);
    const est = normalize(item.estado);
    return (
      ev === "aprobado" ||
      est === "aprobado" ||
      est === "pendiente" ||
      est === "en proceso" ||
      est === "atrazado" ||
      est === "atrasado" ||
      est === "concluido"
    );
  }

  function isCanceled(item) {
    return normalize(item.evaluacion) === "cancelado" || normalize(item.estado) === "cancelado";
  }

  function hasRejection(item) {
    const causa = normalize(item.causa_raiz || item.causaRaiz || '');
    const desc = normalize(item.descripcion_error || item.descripcion || '');
    return causa.indexOf("rechazo") !== -1 || desc.indexOf("rechazo") !== -1;
  }

  function isParoProgramado(date, holidaysMap) {
    const day = date.getDay();
    if (day === 0 || day === 6) return true;
    return !!holidaysMap[dateKey(date)];
  }

  function getDayStatus(year, monthIndex, day, holidaysMap) {
    const date = new Date(year, monthIndex, day);
    const key = dateKey(date);
    const today = stripTime(new Date());

    if (stripTime(date).getTime() > today.getTime()) {
      return "future";
    }

    if (isParoProgramado(date, holidaysMap)) {
      return "stop";
    }

    const info = dayIndex[key];
    if (!info || info.approved <= 0) {
      return "quality";
    }

    if (info.rejection > 0) {
      return "rejection";
    }

    return "internal";
  }

  function getStatusLabel(status) {
    if (status === "quality") return "Calidad Total";
    if (status === "internal") return "Errores Internos";
    if (status === "rejection") return "Rechazos";
    if (status === "stop") return "Paro programado";
    if (status === "future") return "Día futuro";
    return "";
  }

  // Calcular totales anuales de los 12 meses
  const resultadosAnuales = useMemo(() => {
    const holidaysMap = getPeruHolidays(Number(selectedYear));
    let tQuality = 0, tInternal = 0, tRejection = 0, tStop = 0;

    const mesesData = MONTHS.map((mesNombre, monthIndex) => {
      const daysInMonth = new Date(selectedYear, monthIndex + 1, 0).getDate();
      const counts = { quality: 0, internal: 0, rejection: 0, stop: 0 };

      for (let day = 1; day <= 31; day++) {
        if (day <= daysInMonth) {
          const status = getDayStatus(selectedYear, monthIndex, day, holidaysMap);
          if (counts[status] !== undefined) {
            counts[status]++;
          }
        }
      }

      tQuality += counts.quality;
      tInternal += counts.internal;
      tRejection += counts.rejection;
      tStop += counts.stop;

      return {
        mesNombre,
        monthIndex,
        daysInMonth,
        counts
      };
    });

    return {
      mesesData,
      totales: {
        quality: tQuality,
        internal: tInternal,
        rejection: tRejection,
        stop: tStop
      }
    };
  }, [selectedYear, dayIndex]);

  const areaTextoLabel = selectedArea ? ` · Área: ${selectedArea}` : " · Todas las áreas";

  return (
    <div className="radar-page">
      {loading && <Loading />}

      {/* CABECERA COMPACTA ESTILO CUADRO Q */}
      <section className="radar-header-card">
        <div className="radar-head-left">
          <div className="radar-title-row">
            <span className="field-badge auto">CUADRO Q</span>
            <h1>Radar de Q</h1>
          </div>
          <p id="radarStatus">
            Radar anual <strong>{selectedYear}</strong>{areaTextoLabel} — <strong>{registrosFiltrados.length}</strong> registros
          </p>
        </div>

        <div className="radar-actions">
          <select
            value={selectedArea}
            onChange={(e) => setSelectedArea(e.target.value)}
          >
            <option value="">Todas las áreas</option>
            {listaAreas.map((ar) => (
              <option key={ar} value={ar}>{ar}</option>
            ))}
          </select>

          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
          >
            {listaAnios.map((anio) => (
              <option key={anio} value={anio}>{anio}</option>
            ))}
          </select>

          <button
            type="button"
            id="btnReload"
            className="primary-btn"
            onClick={cargarDatos}
          >
            Actualizar
          </button>
        </div>
      </section>

      {/* PANEL DE RESUMEN DELGADO CON COLORES EN ETIQUETAS */}
      <section id="summaryPanel" className="summary-panel">
        <div className="summary-card quality">
          <div className="summary-card-top">
            <span className="summary-tag quality">Calidad Total</span>
            <span className="summary-dot quality"></span>
          </div>
          <strong>{resultadosAnuales.totales.quality}</strong>
        </div>

        <div className="summary-card internal">
          <div className="summary-card-top">
            <span className="summary-tag internal">Errores Internos</span>
            <span className="summary-dot internal"></span>
          </div>
          <strong>{resultadosAnuales.totales.internal}</strong>
        </div>

        <div className="summary-card rejection">
          <div className="summary-card-top">
            <span className="summary-tag rejection">Rechazos</span>
            <span className="summary-dot rejection"></span>
          </div>
          <strong>{resultadosAnuales.totales.rejection}</strong>
        </div>

        <div className="summary-card stop">
          <div className="summary-card-top">
            <span className="summary-tag stop">Paro Programado</span>
            <span className="summary-dot stop"></span>
          </div>
          <strong>{resultadosAnuales.totales.stop}</strong>
        </div>
      </section>

      {/* GRILLA DE MESES */}
      <section id="radarGrid" className="radar-grid">
        {resultadosAnuales.mesesData.map(({ mesNombre, monthIndex, daysInMonth }) => {
          const holidaysMap = getPeruHolidays(Number(selectedYear));

          return (
            <article className="month-card" key={monthIndex}>
              <div className="month-title">{mesNombre}</div>
              <div className="month-body">
                <div className="q-board">
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => {
                    const pos = Q_POSITIONS[day];
                    if (!pos) return null;
                    const row = pos[0];
                    const col = pos[1];

                    let className = "empty-box";
                    let label = "";

                    if (day <= daysInMonth) {
                      className = getDayStatus(selectedYear, monthIndex, day, holidaysMap);
                      label = String(day);
                    }

                    return (
                      <div
                        key={day}
                        className={`q-day ${className}`}
                        style={{ gridRow: row, gridColumn: col }}
                        title={day <= daysInMonth ? `${mesNombre} ${day} - ${getStatusLabel(className)}` : ""}
                      >
                        {label}
                      </div>
                    );
                  })}
                </div>

                <div className="month-legend">
                  <span className="legend-box quality"></span>
                  <span className="legend-label">Calidad Total</span>
                  <span className="legend-box internal"></span>
                  <span className="legend-label">Errores Internos</span>
                  <span className="legend-box rejection"></span>
                  <span className="legend-label">Rechazos</span>
                  <span className="legend-box stop"></span>
                  <span className="legend-label">Paro programado</span>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
