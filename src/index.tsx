import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import App from './App';
import './index.css';

// Polyfill Keyboard.getResizeMode on non-iOS platforms.
// Capacitor Keyboard plugin only implements getResizeMode on iOS; on Android/Web it returns UNIMPLEMENTED.
if (Capacitor.getPlatform() !== 'ios') {
  const safeGetResizeMode = async () => ({ mode: KeyboardResize.None });
  try {
    Keyboard.getResizeMode = safeGetResizeMode;
    const win = typeof window !== 'undefined' ? (window as any) : null;
    if (win?.Capacitor?.Plugins?.Keyboard) {
      win.Capacitor.Plugins.Keyboard.getResizeMode = safeGetResizeMode;
    }
  } catch (e) {
    console.warn('[Keyboard] Could not polyfill getResizeMode:', e);
  }
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

const root = ReactDOM.createRoot(rootElement as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
