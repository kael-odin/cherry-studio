import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Novel-spec workspace routes (renderer → NovelService).
 * All routes are read-only in P1; state writes stay behind the engine.
 */

const scenePlanSchema = z.object({
  id: z.string(),
  type: z.string(),
  targetChars: z.number().optional(),
  pov: z.string().optional(),
  goal: z.string().optional(),
  status: z.string().optional()
})

const sceneInfoSchema = z.object({
  plan: scenePlanSchema,
  marker: z.string(),
  index: z.number().int().nonnegative(),
  prose: z.string()
})

const chapterFrontmatterSchema = z.object({
  id: z.string(),
  volume: z.number().optional(),
  chapter: z.number().optional(),
  title: z.string().optional(),
  wordCount: z.number().optional(),
  proseCount: z.number().optional(),
  targetChars: z.number().optional(),
  countUnit: z.enum(['han_chars', 'words']).optional(),
  stateAfter: z.string().optional(),
  foreshadowPlanted: z.array(z.string()).optional(),
  foreshadowResolved: z.array(z.string()).optional(),
  status: z.string().optional(),
  scenes: z.array(scenePlanSchema).optional()
})

const chapterSummarySchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  volume: z.number().optional(),
  chapter: z.number().optional(),
  status: z.string().optional(),
  countUnit: z.enum(['han_chars', 'words']).optional(),
  targetChars: z.number().optional(),
  proseCount: z.number().optional(),
  sceneCount: z.number().int().nonnegative(),
  sceneMarkers: z.array(z.string())
})

const chapterReadSchema = z.object({
  frontmatter: chapterFrontmatterSchema,
  body: z.string(),
  proseCount: z.number().int().nonnegative()
})

const sceneContextSchema = z.object({
  chapterId: z.string(),
  scenes: z.array(sceneInfoSchema),
  bodySceneMarkers: z.array(z.string()),
  proseCount: z.number().int().nonnegative()
})

const reviewRecordSummarySchema = z.object({
  file: z.string(),
  chapterId: z.string().optional(),
  status: z.string().optional(),
  reviewerCount: z.number().int().nonnegative(),
  findingCount: z.number().int().nonnegative()
})

const workspaceStatusSchema = z.object({
  path: z.string(),
  chapterCount: z.number().int().nonnegative(),
  specVersion: z.string().optional()
})

const characterSnapshotSchema = z.object({
  location: z.string().optional(),
  psychology: z.string().optional(),
  knowledge: z.array(z.string()).optional(),
  inventory: z.array(z.string()).optional(),
  relationships: z.record(z.string(), z.string()).optional(),
  status: z.string().optional(),
  notes: z.string().optional()
})

const characterStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).optional(),
  current: characterSnapshotSchema,
  asOfChapter: z.number().int().nonnegative()
})

const foreshadowStateSchema = z.object({
  id: z.string(),
  planted_at: z.string().optional(),
  resolved_at: z.string().optional(),
  status: z.string().optional(),
  description: z.string().optional(),
  payoff: z.string().optional()
})

const timelineEventSchema = z.object({
  id: z.string(),
  chapter: z.string(),
  absolute_time: z.string().optional(),
  narrative_time: z.string().optional(),
  description: z.string(),
  participants: z.array(z.string()).optional()
})

const povStateSchema = z.object({
  chapter: z.string().optional(),
  viewpoint: z.string().optional(),
  tense: z.string().optional(),
  notes: z.string().optional()
})

const novelStateSchema = z.object({
  world: z.object({
    name: z.string().optional(),
    era: z.string().optional(),
    premise: z.string().optional(),
    rules: z.array(z.string()).optional()
  }),
  characters: z.array(characterStateSchema),
  foreshadow: z.array(foreshadowStateSchema),
  timeline: z.array(timelineEventSchema),
  pov: povStateSchema.nullable()
})

const reviewFindingSchema = z.object({
  id: z.string(),
  reviewer: z.string(),
  severity: z.string(),
  summary: z.string(),
  resolution: z.string(),
  rationale: z.string().optional()
})

const reviewPassSchema = z.object({
  reviewer: z.string(),
  status: z.enum(['completed', 'failed']),
  error: z.string().optional(),
  findings: z.array(reviewFindingSchema)
})

const reviewOutcomeSchema = z.object({
  chapterId: z.string(),
  passes: z.array(reviewPassSchema),
  gatePassed: z.boolean(),
  gateError: z.string().optional(),
  recordFile: z.string().optional(),
  consistency: z.string()
})

// Chapter ids follow `vNN-cNNN` (mirrors the reference runtime's chapterNumber).
const chapterIdSchema = z.string().regex(/^v\d+-c\d+$/, 'chapter_id must match vNN-cNNN')

export const novelRequestSchemas = {
  'novel.get_status': defineRoute({
    input: z.void(),
    output: workspaceStatusSchema.nullable()
  }),
  'novel.open_workspace': defineRoute({
    input: z.object({ root: z.string().min(1) }),
    output: z.string()
  }),
  'novel.close_workspace': defineRoute({
    input: z.void(),
    output: z.void()
  }),
  'novel.list_chapters': defineRoute({
    input: z.void(),
    output: z.array(chapterSummarySchema)
  }),
  'novel.read_chapter': defineRoute({
    input: z.object({ chapterId: chapterIdSchema }),
    output: chapterReadSchema
  }),
  'novel.scene_context': defineRoute({
    input: z.object({ chapterId: chapterIdSchema }),
    output: sceneContextSchema
  }),
  'novel.list_reviews': defineRoute({
    input: z.object({ chapterId: chapterIdSchema }),
    output: z.array(reviewRecordSummarySchema)
  }),
  'novel.state_read': defineRoute({
    // as_of_chapter: latest snapshot at or before this chapter (0/omitted = current).
    input: z.object({ asOfChapter: z.number().int().nonnegative().optional() }),
    output: novelStateSchema
  }),
  'novel.run_review': defineRoute({
    // Runs the three reviewer passes (consistency/foreshadow/style) with the
    // given model and appends the record to the engine's reviews ledger when
    // the finalize gate passes.
    input: z.object({ chapterId: chapterIdSchema, modelId: z.string().min(1) }),
    output: reviewOutcomeSchema
  }),
  'novel.finalize': defineRoute({
    // Engine-enforced finalize: scene statuses, prose length, latest review
    // record, clean consistency report — all guarded inside the engine.
    input: z.object({
      chapterId: chapterIdSchema,
      status: z.enum(['reviewed', 'final'])
    }),
    output: z.record(z.string(), z.unknown())
  })
}
