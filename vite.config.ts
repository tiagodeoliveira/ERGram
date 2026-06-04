import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// Empty stand-in for the default `vm` polyfill (vm-browserify). vm only reaches
// our bundle via asn1.js's dead code-gen path (GramJS RSA uses big-integer, not
// asn1), and vm-browserify ships an eval() that app-store review flags. Swapping
// it for an empty module drops that eval(); asn1.js try/catches the missing
// runInThisContext and falls back to a plain function. See src/stubs/vm-empty.ts.
const vmStub = fileURLToPath(new URL('./src/stubs/vm-empty.ts', import.meta.url))

export default defineConfig({
  // GramJS needs Node globals in the browser. We provide process/global via the
  // plugin, but NOT Buffer — the plugin's Buffer is a separate shim class, which
  // makes GramJS's `instanceof Buffer` cross-fail (the 2FA "Bytes or str
  // expected" error). We set the global Buffer ourselves from the real `buffer`
  // package (see src/buffer-global.ts) and dedupe so there's exactly one class.
  plugins: [
    nodePolyfills({
      globals: { Buffer: false, global: true, process: true },
      overrides: { vm: vmStub },
    }),
  ],
  resolve: { dedupe: ['buffer'] },
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
})
