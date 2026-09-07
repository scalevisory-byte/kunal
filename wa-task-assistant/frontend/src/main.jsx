import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { applyTheme, getTheme } from './lib/theme.js';

/*
 * Before the first render, so the page never appears in one theme and then
 * swaps. It goes here rather than in an inline <script> because the app's own
 * content-security-policy allows scripts from 'self' only — and the body is
 * blank until React runs anyway, so there is nothing to flash.
 */
applyTheme(getTheme());

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((err) => console.warn('Service worker registration failed:', err));
  });
}
