import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Polyfill: Promise.try fehlt in Electron 29 (Chromium 122), wird aber
// von pdfjs-dist v5+ benoetigt (verfuegbar ab Chrome 128).
if (typeof (Promise as any).try !== 'function') {
  ;(Promise as any).try = function <T>(fn: () => T | PromiseLike<T>): Promise<T> {
    return new Promise<T>(resolve => resolve(fn()))
  }
}

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
