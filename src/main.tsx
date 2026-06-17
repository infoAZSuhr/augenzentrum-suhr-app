import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
}

// Electron: globaler Drag&Drop-Schutz — verhindert dass die Seite
// zur gedropten Datei navigiert. Einzelne Drop-Zonen rufen
// e.stopPropagation() auf und behandeln den Drop selbst.
document.addEventListener('dragover', e => e.preventDefault())
document.addEventListener('drop', e => e.preventDefault())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
