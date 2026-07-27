import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './src/components/ErrorBoundary';

// Global error handler to catch stale asset loading errors (404s from old deployments)
window.addEventListener('error', (e) => {
  const target = e.target as HTMLElement;
  if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
    console.warn('Asset load failed, refreshing for latest deployment...', target);
    if (!sessionStorage.getItem('asset_reload_attempted')) {
      sessionStorage.setItem('asset_reload_attempted', 'true');
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (let reg of registrations) reg.unregister();
          window.location.reload();
        });
      } else {
        window.location.reload();
      }
    }
  }
}, true);

// Register Service Worker with active update checking
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      console.log('SW registered: ', registration);
      registration.update();
    }).catch(registrationError => {
      console.log('SW registration failed: ', registrationError);
    });
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
