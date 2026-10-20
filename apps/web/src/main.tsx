import '@fontsource-variable/archivo/wdth-italic.css';
import '@fontsource-variable/archivo/wdth.css';
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { EmulatorContext } from './hooks/useEmulator';
import { handleLaunchFiles, registerPwa, relaunch } from './pwa';
import { EmulatorClient } from './worker/client';

// One emulator for the page's lifetime, created outside React so StrictMode can't double it.
const client = new EmulatorClient();
registerPwa();
relaunch(client);
handleLaunchFiles(client);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EmulatorContext.Provider value={client}>
      <App />
    </EmulatorContext.Provider>
  </StrictMode>,
);
