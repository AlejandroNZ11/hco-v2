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
    if (this.state.hasError && prevProps.locationKey !== this.props.locationKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  componentDidCatch(error, errorInfo) {
    console.error("Error capturado en el módulo:", error, errorInfo);
  }

  handleRetry = () => {
    const msg = String(this.state.error || "");
    const esErrorDeCargaModulo =
      msg.includes("Unable to preload CSS") ||
      msg.includes("Failed to fetch dynamically imported module") ||
      msg.includes("Importing a module script failed");

    this.setState({ hasError: false, error: null }, () => {
      if (esErrorDeCargaModulo) {
        window.location.reload();
      }
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 m-4 bg-red-50 border border-red-100 rounded-2xl shadow-sm">
          {/* Icono SVG de Advertencia */}
          <svg className="w-16 h-16 text-red-500 mb-4 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>

          <h3 className="text-xl md:text-2xl font-bold text-red-800 mb-2 text-center">
            El módulo no está disponible temporalmente
          </h3>
          <p className="text-red-600 text-center mb-6 max-w-md">
            Ha ocurrido un problema de conexión o carga. Puedes intentar de nuevo o seguir usando las demás áreas del sistema.
          </p>
          
          {this.state.error && (
            <div className="w-full max-w-2xl bg-white/70 rounded-lg p-4 mb-6 overflow-x-auto border border-red-100 shadow-inner">
              <pre className="text-xs md:text-sm text-red-700 font-mono whitespace-pre-wrap text-left m-0">
                {this.state.error.toString()}
              </pre>
            </div>
          )}

          <button
            type="button"
            onClick={this.handleRetry}
            className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors duration-200 shadow-md focus:ring-4 focus:ring-red-200 focus:outline-none flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
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