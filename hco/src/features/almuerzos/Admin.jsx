import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx-js-style";
import {
  FaExclamationTriangle,
  FaFileExcel,
  FaFilePdf,
  FaInfoCircle,
  FaSave,
  FaSpinner,
  FaTimes,
  FaTrashAlt,
  FaUserEdit,
  FaUserPlus,
  FaUserShield,
  FaUtensils,
} from "react-icons/fa";
import "./Admin.css";

const API_URL =
  "https://script.google.com/macros/s/AKfycbyzQ67a7Fk4_U5ODe41GnIrQCezaQdpFInH_VFzLjHgQ1Yq99xxYZdXVFVovcV8gloW/exec";

const LOGIN_API_URL =
  "https://script.google.com/macros/s/AKfycbw4EHmCBr5HKvZ1S2ugMD_FFNj5g5PGmF8Y8iZVEZQz9YmQZug85CjKzA8Wc8uEquBz/exec";

const PHOTO_CACHE_PREFIX = "almuerzo_foto_cache_v1:";
const PHOTO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PHOTO_CONCURRENCY = 4;
const MAX_RESULTADOS_ADICIONAL = 30;

const photoCache = new Map();

function getAuthUser() {
  const raw = localStorage.getItem("authUser") || sessionStorage.getItem("authUser");

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem("authUser");
    sessionStorage.removeItem("authUser");
    return null;
  }
}

async function apiPost(payload) {
  const response = await fetch(API_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Error HTTP: " + response.status);
  }

  return await response.json();
}

async function apiGetLoginPreview(usuario) {
  const url = `${LOGIN_API_URL}?action=previewUser&usuario=${encodeURIComponent(
    usuario
  )}&_ts=${Date.now()}`;

  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Error HTTP login preview: " + response.status);
  }

  return await response.json();
}

function normalizarTextoCliente(valor) {
  return String(valor || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extraerDriveId(url) {
  const value = String(url || "").trim();
  if (!value) return "";

  let match = value.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match?.[1]) return match[1];

  match = value.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match?.[1]) return match[1];

  if (/^[a-zA-Z0-9_-]{20,}$/.test(value)) return value;

  return "";
}

function getAvatarFallback() {
  return (
    "data:image/svg+xml;utf8," +
    encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
        <rect width="80" height="80" rx="8" fill="#E9ECEF"/>
        <circle cx="40" cy="28" r="14" fill="#ADB5BD"/>
        <path d="M16 68c4-12 14-18 24-18s20 6 24 18" fill="#ADB5BD"/>
      </svg>
    `)
  );
}

function convertirUrlDrive(url) {
  const value = String(url || "").trim();

  if (!value) return getAvatarFallback();
  if (/^data:image\//i.test(value)) return value;

  const fileId = extraerDriveId(value);

  if (fileId) {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w120`;
  }

  if (/^https?:\/\//i.test(value)) return value;

  return getAvatarFallback();
}

function getPhotoCacheKey(identificador) {
  return PHOTO_CACHE_PREFIX + String(identificador || "").trim();
}

function leerFotoCachePersistente(identificador) {
  const key = getPhotoCacheKey(identificador);

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return "";

    const data = JSON.parse(raw);
    const savedAt = Number(data.savedAt || 0);

    if (!savedAt || Date.now() - savedAt > PHOTO_CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return "";
    }

    return String(data.foto || "").trim();
  } catch {
    return "";
  }
}

function guardarFotoCachePersistente(identificador, foto) {
  if (!identificador || !foto) return;

  try {
    localStorage.setItem(
      getPhotoCacheKey(identificador),
      JSON.stringify({
        foto,
        savedAt: Date.now(),
      })
    );
  } catch (error) {
    console.warn("No se pudo guardar foto en caché local:", error);
  }
}

async function obtenerFotoUsuarioCorporativa(pedido) {
  const identificador = String(pedido?.dni || pedido?.cuenta || "").trim();

  if (!identificador) {
    return convertirUrlDrive(pedido?.foto);
  }

  if (photoCache.has(identificador)) {
    return photoCache.get(identificador);
  }

  const cached = leerFotoCachePersistente(identificador);

  if (cached) {
    photoCache.set(identificador, cached);
    return cached;
  }

  try {
    const result = await apiGetLoginPreview(identificador);

    let foto = getAvatarFallback();

    if (result?.ok && result?.found && result?.user) {
      foto =
        String(result.user.fotoDataUrl || "").trim() ||
        String(result.user.foto || "").trim() ||
        String(result.user.fotoWeb || "").trim() ||
        getAvatarFallback();
    } else {
      foto = convertirUrlDrive(pedido?.foto);
    }

    photoCache.set(identificador, foto);
    guardarFotoCachePersistente(identificador, foto);

    return foto;
  } catch (error) {
    console.warn("No se pudo resolver foto corporativa:", error);

    const fallback = convertirUrlDrive(pedido?.foto);
    photoCache.set(identificador, fallback);

    return fallback;
  }
}

function calcularTotales(pedidos, totalUsuariosEmpresa) {
  const conteo = {
    totalEnviados: 0,
    pendientes: 0,
    fondo1: 0,
    fondo2: 0,
    dieta: 0,
  };

  if (Array.isArray(pedidos)) {
    pedidos.forEach((pedido) => {
      conteo.totalEnviados++;

      const plato = String(pedido.plato || "").toUpperCase().trim();

      if (plato.includes("PLATO DE FONDO 01")) conteo.fondo1++;
      else if (plato.includes("PLATO DE FONDO 02")) conteo.fondo2++;
      else if (plato.includes("DIETA")) conteo.dieta++;
    });
  }

  conteo.pendientes = Math.max(0, Number(totalUsuariosEmpresa || 0) - conteo.totalEnviados);

  return conteo;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default function Admin() {
  const navigate = useNavigate();

  const [usuario] = useState(() => getAuthUser());
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);

  const [totalUsuariosEmpresa, setTotalUsuariosEmpresa] = useState(0);
  const [pedidos, setPedidos] = useState([]);
  const [resumen, setResumen] = useState({
    totalEnviados: 0,
    pendientes: 0,
    fondo1: 0,
    fondo2: 0,
    dieta: 0,
  });

  const [config, setConfig] = useState({
    estado: "",
    dia: "",
    actualizador: "",
  });

  const [fotos, setFotos] = useState({});
  const [toast, setToast] = useState(null);

  const [showReinicio, setShowReinicio] = useState(false);
  const [reiniciando, setReiniciando] = useState(false);

  const [showAdicional, setShowAdicional] = useState(false);
  const [usuariosPlanilla, setUsuariosPlanilla] = useState([]);
  const [busquedaAdicional, setBusquedaAdicional] = useState("");
  const [resultadosAdicional, setResultadosAdicional] = useState([]);
  const [seleccionadosAdicional, setSeleccionadosAdicional] = useState([]);
  const [loadingPersonas, setLoadingPersonas] = useState(false);
  const [registrandoAdicional, setRegistrandoAdicional] = useState(false);

  const rolActual = String(usuario?.rol || "").toUpperCase();
  const esSupervisor = rolActual === "SUPERVISOR";
  const puedeAdministrar = rolActual === "SUPERADMIN" || rolActual === "SUPERVISOR";

  const mostrarToast = useCallback((mensaje, tipo = "success") => {
    setToast({ mensaje, tipo });

    setTimeout(() => {
      setToast(null);
    }, 2600);
  }, []);

  const cargarDashboard = useCallback(async () => {
    try {
      setLoading(true);

      const result = await apiPost({ action: "getAdminDashboard" });

      if (result.status !== "success") {
        throw new Error(result.message || "No se pudo cargar el dashboard.");
      }

      const totalUsuarios = Number(result.totalUsuarios || 0);
      const pedidosResult = Array.isArray(result.pedidos) ? result.pedidos : [];

      setTotalUsuariosEmpresa(totalUsuarios);
      setPedidos(pedidosResult);
      setConfig({
        estado: result.config?.estado || "",
        dia: result.config?.dia || "",
        actualizador: result.config?.actualizador || "",
      });

      setResumen(result.resumen || calcularTotales(pedidosResult, totalUsuarios));
    } catch (error) {
      console.error(error);
      mostrarToast("No se pudo cargar la información del panel.", "danger");
    } finally {
      setLoading(false);
    }
  }, [mostrarToast]);

  useEffect(() => {
    if (!usuario) {
      navigate("/", { replace: true });
      return;
    }

    if (!puedeAdministrar) {
      alert("Acceso denegado. No tienes permisos.");
      navigate("/almuerzos/pedidos", { replace: true });
      return;
    }

    cargarDashboard();
  }, [usuario, puedeAdministrar, cargarDashboard, navigate]);

  useEffect(() => {
    if (!Array.isArray(pedidos) || !pedidos.length) return;

    let cancelado = false;
    let index = 0;

    async function worker() {
      while (index < pedidos.length) {
        const currentIndex = index++;
        const pedido = pedidos[currentIndex];
        const identificador = String(pedido?.dni || pedido?.cuenta || currentIndex).trim();

        try {
          const foto = await obtenerFotoUsuarioCorporativa(pedido);

          if (!cancelado && foto) {
            setFotos((prev) => ({
              ...prev,
              [identificador]: foto,
            }));
          }
        } catch (error) {
          console.warn("No se pudo cargar foto:", error);
        }
      }
    }

    const workers = [];
    const totalWorkers = Math.min(PHOTO_CONCURRENCY, pedidos.length);

    for (let i = 0; i < totalWorkers; i++) {
      workers.push(worker());
    }

    Promise.all(workers);

    return () => {
      cancelado = true;
    };
  }, [pedidos]);

  async function actualizarConfiguracion(nextConfig) {
    setSavingConfig(true);

    try {
      const result = await apiPost({
        action: "updateConfig",
        estado: nextConfig.estado,
        dia: nextConfig.dia,
        actualizador: usuario?.nombre || "Desconocido",
      });

      if (result.status !== "success") {
        throw new Error(result.message || "No se pudo guardar la configuración.");
      }

      mostrarToast(`Configuración actualizada: ${nextConfig.estado} / ${nextConfig.dia}`);
      await cargarDashboard();
    } catch (error) {
      console.error(error);
      mostrarToast(error.message || "Error al guardar la configuración.", "danger");
    } finally {
      setSavingConfig(false);
    }
  }

  async function reiniciarPedidos() {
    setReiniciando(true);

    try {
      const result = await apiPost({
        action: "reiniciarPedidosHistorico",
        solicitante: usuario?.nombre || "",
        solicitanteRol: usuario?.rol || "",
      });

      if (result.status !== "success") {
        throw new Error(result.message || "No se pudo reiniciar la data.");
      }

      setShowReinicio(false);
      mostrarToast(result.message || `Pedidos reiniciados. Eliminados: ${result.deletedRows || 0}`);
      await cargarDashboard();
    } catch (error) {
      console.error(error);
      mostrarToast(error.message || "Error al reiniciar pedidos.", "danger");
    } finally {
      setReiniciando(false);
    }
  }

  async function cargarPersonasAdicional() {
    setLoadingPersonas(true);

    try {
      const result = await apiPost({
        action: "getUsuariosPlanillaAlmuerzo",
      });

      if (result.status !== "success") {
        throw new Error(result.message || "No se pudo cargar la lista de personas.");
      }

      const lista = Array.isArray(result.usuarios)
        ? result.usuarios.map((u, index) => ({
            ...u,
            _index: index,
            _search: normalizarTextoCliente(`${u.nombre || ""} ${u.dni || ""} ${u.usuario || ""}`),
          }))
        : [];

      setUsuariosPlanilla(lista);
    } catch (error) {
      console.error(error);
      mostrarToast(error.message || "No se pudo cargar la lista de personas.", "danger");
    } finally {
      setLoadingPersonas(false);
    }
  }

  async function abrirModalAdicionalAlmuerzo() {
    setShowAdicional(true);
    setBusquedaAdicional("");
    setResultadosAdicional([]);
    setSeleccionadosAdicional([]);

    if (!usuariosPlanilla.length) {
      await cargarPersonasAdicional();
    }
  }

  useEffect(() => {
    if (!showAdicional) return;

    const timer = setTimeout(() => {
      const texto = normalizarTextoCliente(busquedaAdicional);

      if (texto.length < 2) {
        setResultadosAdicional([]);
        return;
      }

      const palabras = texto.split(/\s+/).filter(Boolean);
      const resultados = [];

      for (const persona of usuariosPlanilla) {
        const search = persona._search || "";
        const coincide = palabras.every((palabra) => search.includes(palabra));

        if (coincide) {
          resultados.push(persona);

          if (resultados.length >= MAX_RESULTADOS_ADICIONAL) break;
        }
      }

      setResultadosAdicional(resultados);
    }, 120);

    return () => clearTimeout(timer);
  }, [busquedaAdicional, usuariosPlanilla, showAdicional]);

  function seleccionarPersonaAdicional(persona) {
    const yaExiste = seleccionadosAdicional.some(
      (p) => p.dni === persona.dni && p.usuario === persona.usuario
    );

    if (!yaExiste) {
      setSeleccionadosAdicional((prev) => [...prev, persona]);
    }

    setBusquedaAdicional("");
    setResultadosAdicional([]);
  }

  function removerPersonaAdicional(indexSeleccionado) {
    setSeleccionadosAdicional((prev) => prev.filter((_, index) => index !== indexSeleccionado));
  }

  async function registrarAlmuerzoAdicional() {
    if (!seleccionadosAdicional.length) {
      mostrarToast("Seleccione al menos una persona.", "danger");
      return;
    }

    setRegistrandoAdicional(true);

    try {
      const personasPayload = seleccionadosAdicional.map((p) => ({
        dni: p.dni || "",
        cuenta: p.usuario || "",
        nombre: p.nombre || "",
        foto: p.foto || p.fotoWeb || "",
      }));

      const result = await apiPost({
        action: "registrarAlmuerzoAdicional",
        personas: personasPayload,
        solicitante: usuario?.nombre || "",
        solicitanteRol: usuario?.rol || "",
      });

      if (result.status !== "success") {
        throw new Error(result.message || "No se pudo registrar el adicional.");
      }

      setShowAdicional(false);
      mostrarToast(result.message || `Se registraron ${seleccionadosAdicional.length} almuerzos adicionales.`);
      await cargarDashboard();
    } catch (error) {
      console.error(error);
      mostrarToast(error.message || "Error al registrar los adicionales.", "danger");
    } finally {
      setRegistrandoAdicional(false);
    }
  }

  function exportarExcel() {
    const dataPedidos = Array.isArray(pedidos) ? pedidos.slice() : [];

    if (!dataPedidos.length) {
      mostrarToast("No hay datos para exportar.", "danger");
      return;
    }

    dataPedidos.sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || "")));

    const hoy = new Date();
    const fechaStr = `${String(hoy.getDate()).padStart(2, "0")}/${String(
      hoy.getMonth() + 1
    ).padStart(2, "0")}/${hoy.getFullYear()}`;
    const titulo = `Menu del dia ${fechaStr}`;

    const datos = [[titulo, "", "", ""], ["N°", "Nombre", "Menú", "VB"]];

    dataPedidos.forEach((pedido, index) => {
      datos.push([index + 1, String(pedido.nombre || "").trim(), String(pedido.plato || "").trim(), ""]);
    });

    const ws = XLSX.utils.aoa_to_sheet(datos);

    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
    ws["!cols"] = [{ wch: 6 }, { wch: 45 }, { wch: 28 }, { wch: 14 }];
    ws["!rows"] = [{ hpt: 24 }, { hpt: 20 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pedidos");

    const nombreArchivo = `Reporte_Pedidos_${fechaStr.replace(/\//g, "-")}.xlsx`;

    XLSX.writeFile(wb, nombreArchivo, {
      bookType: "xlsx",
      compression: true,
    });
  }

  function previsualizarPDF() {
    const dataPedidos = Array.isArray(pedidos) ? pedidos.slice() : [];

    if (!dataPedidos.length) {
      mostrarToast("No hay datos para previsualizar.", "danger");
      return;
    }

    dataPedidos.sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || "")));

    const hoy = new Date();
    const fechaStr = `${String(hoy.getDate()).padStart(2, "0")}/${String(
      hoy.getMonth() + 1
    ).padStart(2, "0")}/${hoy.getFullYear()}`;
    const titulo = `Menu del dia ${fechaStr}`;

    const filasHtml = dataPedidos
      .map(
        (pedido, index) => `
          <tr>
            <td class="td-num">${index + 1}</td>
            <td class="td-nombre">${escapeHtml(pedido.nombre || "")}</td>
            <td class="td-menu">${escapeHtml(pedido.plato || "")}</td>
            <td class="td-vb"></td>
          </tr>
        `
      )
      .join("");

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>${escapeHtml(titulo)}</title>
        <style>
          @page { size: A4 portrait; margin: 10mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; }
          .pdf-toolbar { position: sticky; top: 0; z-index: 10; display: flex; justify-content: center; gap: 10px; padding: 12px; background: #f1f3f5; border-bottom: 1px solid #ccc; }
          .pdf-toolbar button { border: none; border-radius: 6px; padding: 9px 16px; font-size: 14px; font-weight: 700; cursor: pointer; }
          .btn-print { background: #198754; color: #fff; }
          .btn-close { background: #6c757d; color: #fff; }
          .sheet { width: 100%; max-width: 190mm; margin: 12px auto; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          th, td { border: 1px solid #000; padding: 3px 5px; font-size: 12px; line-height: 1.15; vertical-align: middle; }
          .title-row th { background: #d9d9d9; font-size: 20px; font-weight: 800; text-align: center; padding: 6px 5px; }
          .header-row th { background: #d9d9d9; font-size: 13px; font-weight: 800; text-align: center; padding: 4px 5px; }
          .td-num { text-align: center; white-space: nowrap; }
          .td-nombre { text-align: left; overflow-wrap: break-word; }
          .td-menu { text-align: left; white-space: normal; }
          .td-vb { text-align: center; }
          tbody tr { height: 22px; }
          @media print {
            .pdf-toolbar { display: none !important; }
            th, td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <div class="pdf-toolbar">
          <button class="btn-print" onclick="window.print()">Imprimir / Guardar PDF</button>
          <button class="btn-close" onclick="window.close()">Cerrar</button>
        </div>
        <div class="sheet">
          <table>
            <colgroup>
              <col style="width: 6%;">
              <col style="width: 56%;">
              <col style="width: 28%;">
              <col style="width: 10%;">
            </colgroup>
            <thead>
              <tr class="title-row"><th colspan="4">${escapeHtml(titulo)}</th></tr>
              <tr class="header-row"><th>N°</th><th>Nombre</th><th>Menú</th><th>VB</th></tr>
            </thead>
            <tbody>${filasHtml}</tbody>
          </table>
        </div>
        <script>
          window.addEventListener("load", function () {
            setTimeout(function () { window.print(); }, 300);
          });
        </script>
      </body>
      </html>
    `;

    const win = window.open("", "_blank");

    if (!win) {
      mostrarToast("El navegador bloqueó la ventana emergente. Permite pop-ups para previsualizar PDF.", "danger");
      return;
    }

    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  if (!usuario || !puedeAdministrar) return null;

  return (
    <div className="admin-page">
      <main className="admin-main">
        <div className="admin-header-title">
          <h2>
            <FaUserShield /> Administración de Almuerzos
          </h2>
        </div>

        <div className="dashboard-grid">
          <div className="dash-card">
            <label>Estado</label>
            <div className="estado-toggle">
              <select
                className="admin-select"
                value={config.estado}
                disabled={loading || savingConfig}
                onChange={(e) => {
                  const next = { ...config, estado: e.target.value };
                  setConfig(next);
                  actualizarConfiguracion(next);
                }}
              >
                <option value="" disabled>
                  ⏳ Cargando...
                </option>
                <option value="Activo">Activo</option>
                <option value="Inactivo">Inactivo</option>
              </select>
            </div>
          </div>

          <div className="dash-card card-green">
            <label>Día</label>
            <select
              className="admin-select"
              value={config.dia}
              disabled={loading || savingConfig}
              onChange={(e) => {
                const next = { ...config, dia: e.target.value };
                setConfig(next);
                actualizarConfiguracion(next);
              }}
            >
              <option value="" disabled>
                ⏳ Cargando...
              </option>
              <option value="Lunes">Lunes</option>
              <option value="Martes">Martes</option>
              <option value="Miercoles">Miercoles</option>
              <option value="Jueves">Jueves</option>
              <option value="Viernes">Viernes</option>
            </select>
          </div>

          <div className="dash-card">
            <label>Total</label>
            <div className="dash-value">{resumen.totalEnviados}</div>
          </div>

          <div className="dash-card card-yellow">
            <label>Pendientes</label>
            <div className="dash-value">{resumen.pendientes}</div>
          </div>

          <div className="dash-card">
            <label>PLATO DE FONDO 01</label>
            <div className="dash-value">{resumen.fondo1}</div>
          </div>

          <div className="dash-card">
            <label>PLATO DE FONDO 02</label>
            <div className="dash-value">{resumen.fondo2}</div>
          </div>

          <div className="dash-card">
            <label>DIETA</label>
            <div className="dash-value">{resumen.dieta}</div>
          </div>

          <div className="lbl-ultima-actualizacion">
            {config.actualizador ? (
              <>
                <FaUserEdit /> Act. por: {config.actualizador}
              </>
            ) : null}
          </div>
        </div>

        <div className="admin-actions-bar">
          {!esSupervisor && (
            <button className="btn btn-warning shadow-sm" onClick={abrirModalAdicionalAlmuerzo}>
              <FaUserPlus className="me-2" /> Adicionar almuerzo
            </button>
          )}

          {!esSupervisor && (
            <button className="btn btn-primary shadow-sm" onClick={() => navigate("/almuerzos/lista_platillo")}>
              <FaUtensils className="me-2" /> Editar menú semanal
            </button>
          )}

          {!esSupervisor && (
            <button className="btn btn-danger shadow-sm" onClick={() => setShowReinicio(true)}>
              <FaTrashAlt className="me-2" /> Reiniciar pedidos
            </button>
          )}

          <button className="btn btn-success shadow-sm" onClick={exportarExcel}>
            <FaFileExcel className="me-2" /> Descargar Excel
          </button>

          <button className="btn btn-dark shadow-sm" onClick={previsualizarPDF}>
            <FaFilePdf className="me-2" /> Previsualizar PDF
          </button>
        </div>

        <div className="table-container mt-3">
          <table className="admin-table table table-hover mb-0">
            <thead>
              <tr>
                <th className="text-center">N°</th>
                <th className="text-center">Foto</th>
                <th>Nombre</th>
                <th className="text-center">Menú</th>
                <th className="text-center">Fecha</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="5" className="text-center p-4">
                    <FaSpinner className="admin-spin" /> Cargando pedidos...
                  </td>
                </tr>
              ) : pedidos.length === 0 ? (
                <tr>
                  <td colSpan="5" className="text-center">
                    No hay pedidos registrados para este día.
                  </td>
                </tr>
              ) : (
                pedidos.map((pedido, index) => {
                  const identificador = String(pedido?.dni || pedido?.cuenta || index).trim();
                  const foto =
                    fotos[identificador] ||
                    leerFotoCachePersistente(identificador) ||
                    convertirUrlDrive(pedido?.foto) ||
                    getAvatarFallback();

                  return (
                    <tr key={`${identificador}_${index}`}>
                      <td className="text-center">{index + 1}</td>
                      <td className="text-center">
                        <img
                          src={foto}
                          alt="Foto"
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.onerror = null;
                            e.currentTarget.src = getAvatarFallback();
                          }}
                        />
                      </td>
                      <td>
                        {pedido.nombre || ""}
                        {normalizarTextoCliente(pedido.estado) === "adicional" && (
                          <span className="badge bg-warning text-dark ms-2">Adicional</span>
                        )}
                      </td>
                      <td style={{ fontStyle: "italic" }}>{pedido.plato || ""}</td>
                      <td>{pedido.fecha || ""}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>

      {showReinicio && (
        <div className="admin-modal-backdrop">
          <div className="admin-modal">
            <div className="admin-modal-header danger">
              <h5>
                <FaExclamationTriangle /> Reiniciar pedidos
              </h5>
              <button onClick={() => setShowReinicio(false)}>
                <FaTimes />
              </button>
            </div>

            <div className="admin-modal-body text-center">
              Se eliminarán los registros de <strong>PEDIDOS_HISTORICO</strong>.
              <br />
              <br />
              Se guardará respaldo en <strong>PEDIDOS_BACKUP</strong>.
              <br />
              <br />
              Esta acción solo debe realizarse sábado o domingo.
            </div>

            <div className="admin-modal-footer">
              <button className="btn btn-secondary fw-bold" onClick={() => setShowReinicio(false)}>
                Cancelar
              </button>

              <button className="btn btn-danger fw-bold" disabled={reiniciando} onClick={reiniciarPedidos}>
                {reiniciando ? "Procesando..." : "Sí, reiniciar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdicional && (
        <div className="admin-modal-backdrop">
          <div className="admin-modal">
            <div className="admin-modal-header warning">
              <h5>
                <FaUserPlus /> Adicionar almuerzo
              </h5>
              <button onClick={() => setShowAdicional(false)}>
                <FaTimes />
              </button>
            </div>

            <div className="admin-modal-body">
              <div className="mb-3">
                <label className="form-label fw-bold">Buscar persona</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Escribe nombre, DNI o usuario"
                  autoComplete="off"
                  value={busquedaAdicional}
                  onChange={(e) => setBusquedaAdicional(e.target.value)}
                />

                <div className="list-group mt-2 adicional-resultados">
                  {loadingPersonas ? (
                    <div className="list-group-item text-muted small">Cargando personas...</div>
                  ) : busquedaAdicional.trim().length < 2 ? (
                    <div className="list-group-item text-muted small">
                      Escribe al menos 2 caracteres para buscar.
                    </div>
                  ) : resultadosAdicional.length === 0 ? (
                    <div className="list-group-item text-muted small">No se encontraron personas.</div>
                  ) : (
                    resultadosAdicional.map((persona) => (
                      <button
                        key={`${persona.dni}_${persona.usuario}_${persona._index}`}
                        type="button"
                        className="list-group-item list-group-item-action"
                        onClick={() => seleccionarPersonaAdicional(persona)}
                      >
                        <div className="fw-bold">{persona.nombre || "Sin nombre"}</div>
                        <div className="small text-muted">{persona.dni || persona.usuario || ""}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {seleccionadosAdicional.length > 0 && (
                <div className="adicional-preview">
                  <div className="mb-2 fw-bold text-success">
                    Seleccionados ({seleccionadosAdicional.length}):
                  </div>

                  {seleccionadosAdicional.map((persona, index) => {
                    const foto = convertirUrlDrive(persona.fotoWeb || persona.foto);

                    return (
                      <div
                        key={`${persona.dni}_${persona.usuario}_${index}`}
                        className="d-flex align-items-center justify-content-between gap-3 border rounded p-2 bg-light mb-2"
                      >
                        <div className="d-flex align-items-center gap-2">
                          <img
                            src={foto}
                            alt="Foto"
                            onError={(e) => {
                              e.currentTarget.onerror = null;
                              e.currentTarget.src = getAvatarFallback();
                            }}
                          />

                          <div style={{ lineHeight: 1.2 }}>
                            <div className="fw-bold" style={{ fontSize: "0.9rem" }}>
                              {persona.nombre || ""}
                            </div>
                            <div className="small text-muted" style={{ fontSize: "0.8rem" }}>
                              DNI: {persona.dni || "-"}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger border-0"
                          onClick={() => removerPersonaAdicional(index)}
                        >
                          <FaTimes />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="alert alert-info mt-3 mb-0">
                Menú: <strong>ADICIONAL</strong>
              </div>
            </div>

            <div className="admin-modal-footer">
              <button className="btn btn-secondary fw-bold" onClick={() => setShowAdicional(false)}>
                Cancelar
              </button>

              <button
                className="btn btn-warning fw-bold"
                disabled={seleccionadosAdicional.length === 0 || registrandoAdicional}
                onClick={registrarAlmuerzoAdicional}
              >
                <FaSave className="me-2" />
                {registrandoAdicional ? "Registrando..." : "Registrar adicional"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`admin-toast ${toast.tipo === "danger" ? "danger" : "success"}`}>
          <FaInfoCircle />
          <span>{toast.mensaje}</span>
        </div>
      )}
    </div>
  );
}
