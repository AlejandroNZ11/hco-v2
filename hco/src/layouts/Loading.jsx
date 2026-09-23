import React from 'react';
import './Loading.css';

const Loading = () => {
  return (
    <div className="loading-overlay">
      <div className="loading-card">
        
        {/* Spinner HCO Corporativo */}
        <div className="hco-spinner-wrapper">
          <div className="hco-spinner-circle"></div>
          <div className="hco-spinner-logo">
            <span className="text-dark">H</span>
            <span className="text-blue">C</span>
            <span className="text-dark">O</span>
          </div>
        </div>

        <p>Cargando datos...</p>
      </div>
    </div>
  );
};

export default Loading;
