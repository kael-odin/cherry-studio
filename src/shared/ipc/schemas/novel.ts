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
  })
}
