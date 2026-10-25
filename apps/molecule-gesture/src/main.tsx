import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { preloadMolecules } from './molecules/pubchem';

// Web fonts load after the page is up, so slow or blocked Wi-Fi never delays
// the first paint (the CSS falls back to system fonts meanwhile).
window.addEventListener('load', () => {
  // The common-molecule pack arrives before anyone speaks.
  preloadMolecules();
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.crossOrigin = 'anonymous';
  link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap';
  document.head.appendChild(link);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
