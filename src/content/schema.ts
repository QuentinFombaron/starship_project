import { z } from 'zod'

/** Mission time in seconds relative to T-0 (negative = countdown). */
const T = z.number()

const Source = z.object({
  title: z.string(),
  url: z.url(),
  publisher: z.string().optional(),
})

const Objective = z.object({
  label: z.string(),
  status: z.enum(['achieved', 'partial', 'failed', 'not-attempted', 'pending']),
  note: z.string().optional(),
})

const Outcome = z.enum(['success', 'partial', 'failure', 'scheduled', 'scrubbed'])

const LatLon = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })

export const MissionSchema = z.object({
  id: z.string().regex(/^flight-\d{2}$/),
  number: z.number().int().positive(),
  name: z.string(),
  /** ISO 8601 UTC liftoff; for scheduled flights the NET date. */
  launchTime: z.iso.datetime(),
  outcome: Outcome,
  launchSite: z.object({ name: z.string(), pad: z.string(), position: LatLon }),
  vehicles: z.object({
    booster: z.object({ id: z.string(), block: z.string() }),
    ship: z.object({ id: z.string(), block: z.string() }),
  }),
  summary: z.string(),
  highlights: z.array(z.string()).default([]),
  objectives: z.array(Objective).default([]),
  payload: z
    .object({ name: z.string(), count: z.number().int().nonnegative().optional(), description: z.string().optional() })
    .optional(),
  orbit: z
    .object({
      perigeeKm: z.number(),
      apogeeKm: z.number(),
      inclinationDeg: z.number(),
      orbital: z.boolean(),
    })
    .optional(),
  boosterFate: z.string().optional(),
  shipFate: z.string().optional(),
  boosterLanding: LatLon.optional(),
  shipLanding: LatLon.optional(),
  durationSec: z.number().optional(),
  stats: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
  webcast: z.object({ youtubeId: z.string(), title: z.string().optional() }).optional(),
  heroImage: z.string().optional(),
  sources: z.array(Source).default([]),
  /** True when replay data (timeline + engines + keyframes) is available. */
  hasReplay: z.boolean().default(false),
})
export type Mission = z.infer<typeof MissionSchema>

export const EventKind = z.enum([
  'countdown',
  'liftoff',
  'milestone',
  'burn-start',
  'burn-end',
  'staging',
  'anomaly',
  'payload',
  'entry',
  'landing',
  'decision',
])

export const TimelineEventSchema = z.object({
  id: z.string(),
  t: T,
  title: z.string(),
  vehicle: z.enum(['booster', 'ship', 'both', 'ground']),
  kind: EventKind,
  status: z.enum(['nominal', 'partial', 'off-nominal', 'planned-not-flown']).default('nominal'),
  description: z.string().optional(),
  /** Mark events whose timing is estimated rather than confirmed. */
  estimated: z.boolean().default(false),
})
export const TimelineSchema = z.array(TimelineEventSchema)
export type TimelineEvent = z.infer<typeof TimelineEventSchema>

/** Engine layout + per-engine burn intervals. */
const BurnSchema = z.object({
  name: z.string(),
  start: T,
  end: T,
  /** Engine indices that participate in this burn (0-based into layout). */
  engines: z.array(z.number().int().nonnegative()),
  throttle: z.array(z.tuple([T, z.number().min(0).max(1)])).optional(),
})
const FailureSchema = z.object({
  engine: z.number().int().nonnegative(),
  t: T,
  kind: z.enum(['shutdown', 'no-relight', 'failure']),
  note: z.string().optional(),
})
const StageEnginesSchema = z.object({
  /** Group sizes from center outwards, e.g. [3, 10, 20] for Super Heavy. */
  rings: z.array(z.number().int().positive()),
  labels: z.array(z.string()).optional(),
  burns: z.array(BurnSchema),
  failures: z.array(FailureSchema).default([]),
})
export const EnginesSchema = z.object({
  booster: StageEnginesSchema,
  ship: StageEnginesSchema,
})
export type Engines = z.infer<typeof EnginesSchema>
export type StageEngines = z.infer<typeof StageEnginesSchema>

/** Anchor values for trajectory reconstruction. */
const AnchorSchema = z.object({
  t: T,
  altKm: z.number().optional(),
  speedKmh: z.number().optional(),
  /** Ground distance from the pad along the launch azimuth (negative = back towards the pad). */
  downrangeKm: z.number().optional(),
  note: z.string().optional(),
})
export const KeyframesSchema = z.object({
  booster: z.array(AnchorSchema),
  ship: z.array(AnchorSchema),
  /** Trajectory targets used by the reconstruction script. */
  targets: z.object({
    launchAzimuthDeg: z.number().optional(),
    perigeeKm: z.number(),
    apogeeKm: z.number(),
    inclinationDeg: z.number(),
    shipBallisticCoeff: z.number().default(260),
    shipLiftToDrag: z.number().default(0.25),
  }),
  notes: z.string().optional(),
})
export type Keyframes = z.infer<typeof KeyframesSchema>

export const CommentarySchema = z.array(
  z.object({
    t: T,
    text: z.string(),
    kind: z.enum(['host', 'explainer', 'callout']).default('host'),
    speaker: z.string().optional(),
    level: z.enum(['essential', 'detailed']).default('essential'),
  }),
)
export type CommentaryLine = z.infer<typeof CommentarySchema>[number]

export const PostsSchema = z.array(
  z.object({
    t: T,
    url: z.url(),
    author: z.string(),
    handle: z.string(),
    text: z.string(),
    /** Whether the post was found and verified at the URL. */
    verified: z.boolean().default(false),
  }),
)
export type Post = z.infer<typeof PostsSchema>[number]

export const MediaSchema = z.array(
  z.object({
    src: z.url(),
    thumb: z.url().optional(),
    caption: z.string(),
    credit: z.string(),
    license: z.string(),
    page: z.url().optional(),
    t: T.optional(),
  }),
)
export type MediaItem = z.infer<typeof MediaSchema>[number]

export const WebcastSchema = z.object({
  youtubeId: z.string(),
  /** Seconds into the video at which T-0 (liftoff) occurs. */
  t0Offset: z.number(),
  calibrated: z.boolean().default(false),
})
export type Webcast = z.infer<typeof WebcastSchema>

export const VehicleSchema = z.object({
  id: z.string(),
  type: z.enum(['booster', 'ship']),
  block: z.string(),
  status: z.enum(['active', 'expended', 'retired', 'destroyed', 'in-production', 'reflown']),
  flights: z.array(z.number().int()),
  summary: z.string(),
  history: z
    .array(z.object({ date: z.iso.date(), event: z.string() }))
    .default([]),
})
export type Vehicle = z.infer<typeof VehicleSchema>

export const GlossarySchema = z.array(z.object({ term: z.string(), short: z.string().optional(), definition: z.string() }))
export type GlossaryEntry = z.infer<typeof GlossarySchema>[number]

/** Generated telemetry track, column-oriented for compactness. */
export const TelemetryTrackSchema = z.object({
  dt: z.number(),
  t0: z.number(),
  /** lat, lon (deg), alt (m), speed (m/s), vertical speed (m/s), heading (deg), pitch (deg), q (Pa), accel (g) */
  lat: z.array(z.number()),
  lon: z.array(z.number()),
  alt: z.array(z.number()),
  speed: z.array(z.number()),
  vspeed: z.array(z.number()),
  heading: z.array(z.number()),
  pitch: z.array(z.number()),
  q: z.array(z.number()),
  accel: z.array(z.number()),
  lox: z.array(z.number()),
  ch4: z.array(z.number()),
})
export const TelemetrySchema = z.object({
  generated: z.string(),
  booster: TelemetryTrackSchema,
  ship: TelemetryTrackSchema,
  plannedShipGroundTrack: z.array(z.tuple([z.number(), z.number()])).optional(),
})
export type TelemetryTrack = z.infer<typeof TelemetryTrackSchema>
export type Telemetry = z.infer<typeof TelemetrySchema>
