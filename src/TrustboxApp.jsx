import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import markup from './legacy-markup.html?raw';
import behaviour from './legacy-behaviour.js?raw';
import MonitoringDashboard from './components/MonitoringDashboard.jsx';

/**
 * React entry point for the supplied TRUSTBOX prototype.
 * The original markup, CSS, wording, demo values, interactions and Three.js
 * scene are retained so the rendered design stays faithful to the source.
 */
export default function TrustboxApp() {
  const host = useRef(null);

  useEffect(() => {
    // The original script expects THREE to be globally available.
    window.THREE = THREE;
    // Run the supplied DOM behaviour only after React has mounted its markup.
    const runOriginalBehaviour = new Function('THREE', behaviour);
    runOriginalBehaviour(THREE);
    const dashboardRoot = createRoot(document.getElementById('monitoring-root'));
    dashboardRoot.render(<MonitoringDashboard />);

    return () => {
      dashboardRoot.unmount();
      // The source prototype registers window-level listeners and owns a
      // WebGL renderer. A full page navigation naturally releases these;
      // keep this component mounted for the lifetime of the single-page app.
    };
  }, []);

  return <div ref={host} dangerouslySetInnerHTML={{ __html: markup }} />;
}
