import React from 'react';
import { createRoot } from 'react-dom/client';
import TrustboxApp from './TrustboxApp.jsx';
import './styles.css';
import './monitoring.css';

// Deliberately no StrictMode: the original interactive prototype initialises
// global DOM listeners and a Three.js renderer once on mount.
createRoot(document.getElementById('root')).render(<TrustboxApp />);
