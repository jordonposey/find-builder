import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// If your URL will be https://<you>.github.io/<repo>/ use base: '/<repo>/'
// If your repo is <you>.github.io (root site), use base: '/'
export default defineConfig({
  plugins: [react()],
  base: '/find-helper/',
})
