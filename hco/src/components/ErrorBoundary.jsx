import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Aquí podrías enviar el error a un servicio como Sentry o Supabase
    console.error("Error capturado en el módulo:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#721c24', backgroundColor: '#f8d7da', borderRadius: '8px' }}>
          <h3>El módulo no está disponible temporalmente.</h3>
          <p>Puedes seguir usando las demás áreas del sistema.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
