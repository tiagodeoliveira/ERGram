import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  // GramJS needs Node globals in the browser. We provide process/global via the
  // plugin, but NOT Buffer — the plugin's Buffer is a separate shim class, which
  // makes GramJS's `instanceof Buffer` cross-fail (the 2FA "Bytes or str
  // expected" error). We set the global Buffer ourselves from the real `buffer`
  // package (see src/buffer-global.ts) and dedupe so there's exactly one class.
  plugins: [nodePolyfills({ globals: { Buffer: false, global: true, process: true } })],
  resolve: { dedupe: ['buffer'] },
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
})
