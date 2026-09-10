import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./ListaPlatillo.css";

const API_URL = "https://script.google.com/macros/s/AKfycbyzQ67a7Fk4_U5ODe41GnIrQCezaQdpFInH_VFzLjHgQ1Yq99xxYZdXVFVovcV8gloW/exec";
const DIAS = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes"];
const ESTRUCTURA_FILAS = [
    { id: "entrada", label: "ENTRADA 1", calId: "calEntrada" },
    { id: "fondo1", label: "FONDO 1", calId: "calFondo1" },
    { id: "fondo2", label: "FONDO 2", calId: "calFondo2" },
    { id: "dieta", label: "DIETA", calId: "calDieta" }
];

export default function ListaPlatillo() {
    const navigate = useNavigate();
    const [menu, setMenu] = useState({});
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState({ type: "info", message: "Cargando menú semanal..." });
    const [toast, setToast] = useState({ show: false, message: "", type: "success" });

    const initMenuState = () => {
        const initialState = {};
        DIAS.forEach(dia => {
            initialState[dia] = {
                entrada: "", calEntrada: "",
                fondo1: "", calFondo1: "",
                fondo2: "", calFondo2: "",
                dieta: "", calDieta: ""
            };
        });
        return initialState;
    };

    useEffect(() => {
        const raw = localStorage.getItem("authUser") || sessionStorage.getItem("authUser");
        let user = null;
        try {
            user = raw ? JSON.parse(raw) : null;
        } catch (e) {
            console.error("Error leyendo usuario", e);
        }

        if (!user) {
            navigate("/");
            return;
        }
        if (String(user.rol || "").toUpperCase() !== "SUPERADMIN") {
            alert("Acceso denegado.");
            navigate("/almuerzos/pedidos");
            return;
        }

        setMenu(initMenuState());
        cargarMenu();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigate]);

    const mostrarToast = (mensaje, tipo = "success") => {
        setToast({ show: true, message: mensaje, type: tipo });
        setTimeout(() => setToast({ show: false, message: "", type: "success" }), 3000);
    };

    const cargarMenu = async () => {
        setLoading(true);
        setStatus({ type: "info", message: "Cargando..." });
        try {
            const response = await fetch(API_URL, {
                method: "POST",
                body: JSON.stringify({ action: "getListaPlatillos" })
            });
            
            if (!response.ok) throw new Error("Error HTTP: " + response.status);
            
            const result = await response.json();
            if (result.status !== "success") {
                throw new Error(result.message || "No se pudo cargar el menú.");
            }

            const loadedMenu = initMenuState();
            DIAS.forEach(dia => {
                if (result.menu?.[dia]) {
                    loadedMenu[dia] = { ...loadedMenu[dia], ...result.menu[dia] };
                }
            });
            
            setMenu(loadedMenu);
            setStatus({ type: "success", message: "Actualizado" });
        } catch (error) {
            console.error(error);
            setStatus({ type: "danger", message: "Error de conexión" });
            mostrarToast("No se pudo cargar el menú.", "danger");
        } finally {
            setLoading(false);
        }
    };

    const guardarMenu = async () => {
        setLoading(true);
        setStatus({ type: "info", message: "Guardando..." });
        try {
            const response = await fetch(API_URL, {
                method: "POST",
                body: JSON.stringify({ action: "guardarListaPlatillos", menu })
            });
            
            if (!response.ok) throw new Error("Error HTTP: " + response.status);
            
            const result = await response.json();
            if (result.status !== "success") {
                throw new Error(result.message || "No se pudo guardar el menú.");
            }

            setStatus({ type: "success", message: "Guardado" });
            mostrarToast("Menú semanal actualizado correctamente.");
        } catch (error) {
            console.error(error);
            setStatus({ type: "danger", message: "Error al guardar" });
            mostrarToast(error.message || "Error al guardar el menú.", "danger");
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (dia, campo, valor) => {
        setMenu(prev => ({
            ...prev,
            [dia]: {
                ...prev[dia],
                [campo]: valor
            }
        }));
    };

        return (
        <main className="menu-editor-main">
            <div className="menu-editor-card">
                
                {/* Cabecera y Botones */}
                <div className="editor-header-section">
                    <div className="editor-title">
                        <h2>Editar Menú Semanal</h2>
                        <p>Modifica los platillos y calorías. Los cambios se reflejarán automáticamente en el sistema de pedidos.</p>
                    </div>

                    <div className="editor-actions">
                        {status.message && (
                            <span className={`status-text text-${status.type}`}>
                                {status.message}
                            </span>
                        )}
                        <button 
                            onClick={cargarMenu} 
                            disabled={loading} 
                            className="btn-action btn-reload"
                        >
                            Recargar
                        </button>
                        <button 
                            onClick={guardarMenu} 
                            disabled={loading} 
                            className="btn-action btn-save"
                        >
                            {loading ? "Guardando..." : "Guardar cambios"}
                        </button>
                    </div>

                </div>

                {/* Tabla de edición */}
                <div className="editor-table-wrap">
                    <table className="custom-modern-table">
                        <thead>
                            <tr>
                                <th>Tipo</th>
                                {DIAS.map(dia => (
                                    <React.Fragment key={dia}>
                                        <th>{dia}</th>
                                        <th className="text-center" style={{width: "80px"}}>Cal</th>
                                    </React.Fragment>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {ESTRUCTURA_FILAS.map((fila) => (
                                <tr key={fila.id}>
                                    <th>{fila.label}</th>
                                    {DIAS.map((dia) => (
                                        <React.Fragment key={`${dia}-${fila.id}`}>
                                            <td>
                                                <input
                                                    type="text"
                                                    className="menu-input input-platillo"
                                                    disabled={loading}
                                                    placeholder=""
                                                    value={menu[dia]?.[fila.id] || ""}
                                                    onChange={(e) => handleInputChange(dia, fila.id, e.target.value)}
                                                />
                                            </td>
                                            <td className="td-cal">
                                                <input
                                                    type="text"
                                                    className="menu-input input-calorias"
                                                    disabled={loading}
                                                    placeholder="---"
                                                    value={menu[dia]?.[fila.calId] || ""}
                                                    onChange={(e) => handleInputChange(dia, fila.calId, e.target.value)}
                                                />
                                            </td>
                                        </React.Fragment>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Notificaciones Toast */}
            {toast.show && (
                <div className="toast-container custom-toast-container position-fixed bottom-0 end-0 p-4">
                    <div className={`toast show align-items-center text-white bg-${toast.type} border-0 shadow-lg`}>
                        <div className="d-flex">
                            <div className="toast-body fw-bold">
                                {toast.message}
                            </div>
                            <button 
                                type="button" 
                                className="btn-close btn-close-white me-2 m-auto" 
                                onClick={() => setToast({ ...toast, show: false })}
                            ></button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );

}