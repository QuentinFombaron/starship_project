// MapLibre v6 loads its worker relative to its own module URL, which breaks once Vite pre-bundles it.
// Copy the worker (and the shared chunk it imports) into /public so it can be served from a stable URL.
import fs from 'node:fs'
import path from 'node:path'
const src = path.resolve('node_modules/maplibre-gl/dist')
const dst = path.resolve('public/maplibre')
fs.mkdirSync(dst, { recursive: true })
for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) fs.copyFileSync(path.join(src, f), path.join(dst, f))
console.log('copied maplibre worker → public/maplibre')
