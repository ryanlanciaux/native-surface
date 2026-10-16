import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Only the faces this page uses; the landing page's dark tokens/global
// styles stay out of this entry.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import { SurfacesApp } from './SurfacesApp';
import './surfaces.css';

const container = document.getElementById('root');
if (!container) throw new Error('surfaces: #root missing from surfaces.html');

createRoot(container).render(
  <StrictMode>
    <SurfacesApp />
  </StrictMode>,
);
