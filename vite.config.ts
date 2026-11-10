import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// BASE_PATH lo pone GitHub Actions con la carpeta del repo (ej. /guardias/).
// En tu computadora queda en "/".
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
})
