import React from 'react';
import { useLocation } from 'react-router-dom';

class ErrorBoundaryInner extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps) {
    // Si cambias de ruta (ej. con el botón Atrás), limpiamos el estado de error
    if (this.state.hasError && prevProps.locationKey !== this.props.locationKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  componentDidCatch(error, errorInfo) {
    console.error("Error capturado en el módulo:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#721c24', backgroundColor: '#f8d7da', borderRadius: '12px', margin: '16px' }}>
          <h3>El módulo no está disponible temporalmente.</h3>
          <p>Puedes seguir usando las demás áreas del sistema.</p>
          
          {/* Muestra el motivo exacto del fallo para depurar rápido en móvil */}
          {this.state.error && (
            <pre style={{ marginTop: '12px', padding: '10px', background: '#ffffff', color: '#b91c1c', borderRadius: '6px', fontSize: '12px', textAlign: 'left', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
              {this.state.error.toString()}
            </pre>
          )}

          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: '14px', padding: '8px 18px', backgroundColor: '#721c24', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ErrorBoundary({ children }) {
  const location = useLocation();
  return (
    <ErrorBoundaryInner locationKey={location.pathname}>
      {children}
    </ErrorBoundaryInner>
  );
}
