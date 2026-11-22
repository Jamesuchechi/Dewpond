import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkbenchShell } from './WorkbenchShell';
import './workbench.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkbenchShell />
  </StrictMode>,
);
