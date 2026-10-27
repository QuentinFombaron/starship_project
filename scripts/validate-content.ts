/** Validates every content file against the Zod schemas plus cross-file consistency checks. */
import fs from 'node:fs'
import path from 'node:path'
import type { ZodType } from 'zod'
import {
  CommentarySchema,
  EnginesSchema,
  GlossarySchema,
  KeyframesSchema,
  MediaSchema,
  MissionSchema,
  PostsSchema,
  TelemetrySchema,
  TimelineSchema,
  VehicleSchema,
  WebcastSchema,
} from '../src/content/schema.ts'

const root = path.resolve('content')
let errors = 0
const fail = (file: string, msg: string) => {
  errors++
  console.error(`✗ ${path.relative(process.cwd(), file)}: ${msg}`)
}
function check<T>(file: string, schema: ZodType<T>): T | null {
  if (!fs.existsSync(file)) return null
  const r = schema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')))
  if (!r.success) {
    for (const i of r.error.issues.slice(0, 5)) fail(file, `${i.path.join('.')}: ${i.message}`)
    return null
  }
  return r.data
}

const FILES: Record<string, ZodType<unknown>> = {
  'timeline.json': TimelineSchema,
  'engines.json': EnginesSchema,
  'keyframes.json': KeyframesSchema,
  'commentary.json': CommentarySchema,
  'posts.json': PostsSchema,
  'media.json': MediaSchema,
  'webcast.json': WebcastSchema,
  'telemetry.json': TelemetrySchema,
}

const numbers = new Set<number>()
for (const dir of fs.readdirSync(path.join(root, 'flights')).sort()) {
  const base = path.join(root, 'flights', dir)
  const mission = check(path.join(base, 'mission.json'), MissionSchema)
  if (!mission) {
    fail(base, 'missing or invalid mission.json')
    continue
  }
  if (mission.id !== dir) fail(base, `mission.id "${mission.id}" does not match folder`)
  if (numbers.has(mission.number)) fail(base, `duplicate flight number ${mission.number}`)
  numbers.add(mission.number)
  const loaded: Record<string, unknown> = {}
  for (const [f, schema] of Object.entries(FILES)) loaded[f] = check(path.join(base, f), schema)
  if (mission.hasReplay) {
    for (const f of ['timeline.json', 'engines.json', 'keyframes.json', 'telemetry.json']) if (!loaded[f]) fail(base, `hasReplay but ${f} is missing/invalid`)
  }
  const engines = loaded['engines.json'] as ReturnType<typeof EnginesSchema.parse> | null
  if (engines) {
    for (const stage of ['booster', 'ship'] as const) {
      const total = engines[stage].rings.reduce((a, b) => a + b, 0)
      for (const b of engines[stage].burns) {
        if (b.end < b.start) fail(base, `${stage} burn "${b.name}" ends before it starts`)
        for (const e of b.engines) if (e >= total) fail(base, `${stage} burn "${b.name}" references engine ${e} ≥ ${total}`)
      }
      for (const f of engines[stage].failures) if (f.engine >= total) fail(base, `${stage} failure references engine ${f.engine}`)
    }
  }
  const timeline = loaded['timeline.json'] as ReturnType<typeof TimelineSchema.parse> | null
  if (timeline) {
    const ids = new Set<string>()
    for (const e of timeline) {
      if (ids.has(e.id)) fail(base, `duplicate timeline id ${e.id}`)
      ids.add(e.id)
    }
  }
}
for (const f of fs.readdirSync(path.join(root, 'vehicles'))) check(path.join(root, 'vehicles', f), VehicleSchema)
check(path.join(root, 'glossary.json'), GlossarySchema)

if (errors) {
  console.error(`\n${errors} content error(s)`)
  process.exit(1)
}
console.log(`✓ content valid (${numbers.size} flights)`)
