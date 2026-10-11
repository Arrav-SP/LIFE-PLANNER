import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/figtree'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import App from './App'
import { registerServiceWorker } from './pwa'
import { listenForInstall } from './lib/install'

listenForInstall()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()
