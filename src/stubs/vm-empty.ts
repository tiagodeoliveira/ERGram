// Empty stand-in for Node's `vm`, aliased over the default `vm-browserify`
// polyfill (see vite.config.ts).
//
// The only thing that pulls `vm` into our bundle is asn1.js's optional code-gen
// path (reached transitively through crypto-browserify). GramJS never invokes
// it — its RSA uses `big-integer`, not asn1 — so this code is dead weight.
// vm-browserify implements `runInThisContext` with `eval()`, which app-store
// review flags as a security risk. Replacing it here removes that eval() from
// the build entirely.
//
// asn1.js calls `require('vm').runInThisContext(...)` inside a try/catch and
// falls back to a plain function when it throws, so an empty module is safe:
// `runInThisContext` is simply undefined here.
export {}
