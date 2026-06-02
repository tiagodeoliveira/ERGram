// Make the global Buffer the SAME class GramJS imports from the `buffer` package.
// The vite node-polyfills plugin otherwise injects its own pre-built Buffer shim,
// which is a *different* class than `buffer`'s — so GramJS's `instanceof Buffer`
// checks cross-fail (the 2FA "Bytes or str expected, not Buffer" error).
// Must be imported BEFORE any GramJS module so the global is set at init time.
import { Buffer } from 'buffer'

;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer
