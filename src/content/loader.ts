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
  type CommentaryLine,
  type Engines,
  type GlossaryEntry,
  type Keyframes,
  type MediaItem,
  type Mission,
  type Post,
  type Telemetry,
  type TimelineEvent,
  type Vehicle,
  type Webcast,
} from './schema'

const missionFiles = import.meta.glob<unknown>('/content/flights/*/mission.json', { eager: true, import: 'default' })
const vehicleFiles = import.meta.glob<unknown>('/content/vehicles/*.json', { eager: true, import: 'default' })
const glossaryFile = import.meta.glob<unknown>('/content/glossary.json', { eager: true, import: 'default' })
const mediaFiles = import.meta.glob<unknown>('/content/flights/*/media.json', { eager: true, import: 'default' })
const timelineFiles = import.meta.glob<unknown>('/content/flights/*/timeline.json', { eager: true, import: 'default' })

const lazy = {
  engines: import.meta.glob<unknown>('/content/flights/*/engines.json', { import: 'default' }),
  keyframes: import.meta.glob<unknown>('/content/flights/*/keyframes.json', { import: 'default' }),
  commentary: import.meta.glob<unknown>('/content/flights/*/commentary.json', { import: 'default' }),
  posts: import.meta.glob<unknown>('/content/flights/*/posts.json', { import: 'default' }),
  webcast: import.meta.glob<unknown>('/content/flights/*/webcast.json', { import: 'default' }),
  telemetry: import.meta.glob<unknown>('/content/flights/*/telemetry.json', { import: 'default' }),
}

export const missions: Mission[] = Object.entries(missionFiles)
  .map(([path, raw]) => {
    const r = MissionSchema.safeParse(raw)
    if (!r.success) {
      console.error(`Invalid mission ${path}`, r.error.issues)
      return null
    }
    return r.data
  })
  .filter((m): m is Mission => m !== null)
  .sort((a, b) => a.number - b.number)

export const getMission = (id: string) => missions.find((m) => m.id === id || String(m.number) === id)

export const vehicles: Vehicle[] = Object.values(vehicleFiles)
  .map((raw) => VehicleSchema.safeParse(raw))
  .filter((r) => r.success)
  .map((r) => r.data!)
  .sort((a, b) => a.type.localeCompare(b.type) || naturalId(a.id) - naturalId(b.id))

function naturalId(id: string) {
  return Number(id.replace(/\D/g, '')) || 0
}

export const glossary: GlossaryEntry[] = (() => {
  const raw = Object.values(glossaryFile)[0]
  return raw ? GlossarySchema.parse(raw) : []
})()

export function getMedia(missionId: string): MediaItem[] {
  const raw = mediaFiles[`/content/flights/${missionId}/media.json`]
  return raw ? MediaSchema.parse(raw) : []
}

export function getTimeline(missionId: string): TimelineEvent[] {
  const raw = timelineFiles[`/content/flights/${missionId}/timeline.json`]
  return raw ? TimelineSchema.parse(raw).sort((a, b) => a.t - b.t) : []
}

export interface ReplayData {
  mission: Mission
  timeline: TimelineEvent[]
  engines: Engines
  keyframes: Keyframes
  telemetry: Telemetry
  commentary: CommentaryLine[]
  posts: Post[]
  media: MediaItem[]
  webcast: Webcast | null
}

async function loadOpt<T>(map: Record<string, () => Promise<unknown>>, missionId: string, file: string, parse: (x: unknown) => T) {
  const loader = map[`/content/flights/${missionId}/${file}`]
  return loader ? parse(await loader()) : null
}

export async function loadReplay(missionId: string): Promise<ReplayData> {
  const mission = getMission(missionId)
  if (!mission) throw new Error(`Unknown mission ${missionId}`)
  const id = mission.id
  const [engines, keyframes, telemetry, commentary, posts, webcast] = await Promise.all([
    loadOpt(lazy.engines, id, 'engines.json', (x) => EnginesSchema.parse(x)),
    loadOpt(lazy.keyframes, id, 'keyframes.json', (x) => KeyframesSchema.parse(x)),
    loadOpt(lazy.telemetry, id, 'telemetry.json', (x) => TelemetrySchema.parse(x)),
    loadOpt(lazy.commentary, id, 'commentary.json', (x) => CommentarySchema.parse(x)),
    loadOpt(lazy.posts, id, 'posts.json', (x) => PostsSchema.parse(x)),
    loadOpt(lazy.webcast, id, 'webcast.json', (x) => WebcastSchema.parse(x)),
  ])
  if (!engines || !keyframes || !telemetry) throw new Error(`Replay data missing for ${id}`)
  return {
    mission,
    timeline: getTimeline(id),
    engines,
    keyframes,
    telemetry,
    commentary: (commentary ?? []).sort((a, b) => a.t - b.t),
    posts: (posts ?? []).sort((a, b) => a.t - b.t),
    media: getMedia(id),
    webcast,
  }
}

