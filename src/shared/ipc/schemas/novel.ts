import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * Novel routes (renderer → NovelService) — InkOS 引擎对接.
 * 每个 route 对应 InkOS API server 的一个 /api/v1 端点，由主进程 NovelService
 * 转发；渲染器不直接接触引擎进程。
 */

// ── InkOS contracts (mirrors packages/studio/src/shared/contracts.ts) ──────

const bookSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  platform: z.string(),
  genre: z.string(),
  targetChapters: z.number(),
  chapters: z.number(),
  chapterCount: z.number(),
  lastChapterNumber: z.number(),
  totalWords: z.number(),
  approvedChapters: z.number(),
  pendingReview: z.number(),
  pendingReviewChapters: z.number(),
  failedReview: z.number(),
  failedChapters: z.number(),
  recentRunStatus: z.string().nullable().optional(),
  updatedAt: z.string(),
  /** `nextChapterNumber - 1` — present on the wire list summary. */
  chaptersWritten: z.number().optional()
})

const chapterSummarySchema = z.object({
  number: z.number(),
  title: z.string(),
  status: z.string(),
  wordCount: z.number(),
  auditIssueCount: z.number(),
  updatedAt: z.string(),
  fileName: z.string().nullable(),
  auditIssues: z.array(z.string()).optional(),
  reviewNote: z.string().optional(),
  createdAt: z.string().optional()
})

const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string()
})

// ── Routes ────────────────────────────────────────────────────────────────

export const novelRequestSchemas = {
  // InkOS 项目（workspace）打开/关闭
  'novel.open_workspace': defineRoute({
    input: z.object({ root: z.string().min(1) }),
    output: z.string()
  }),
  'novel.close_workspace': defineRoute({
    input: z.void(),
    output: z.void()
  }),
  'novel.get_status': defineRoute({
    // 当前 workspace 的项目配置（语言、模型等）
    input: z.void(),
    output: z
      .object({
        name: z.string(),
        language: z.string(),
        languageExplicit: z.boolean(),
        model: z.string(),
        provider: z.string()
      })
      .nullable()
  }),

  // 书（book）—— 书架
  'novel.list_books': defineRoute({
    input: z.void(),
    output: z.array(bookSummarySchema)
  }),
  'novel.create_book': defineRoute({
    input: z.object({
      title: z.string().min(1),
      genre: z.string().min(1),
      language: z.enum(['zh', 'en']).optional(),
      platform: z.string().optional(),
      chapterWordCount: z.number().optional(),
      targetChapters: z.number().optional(),
      blurb: z.string().optional()
    }),
    output: z.object({ id: z.string() })
  }),
  'novel.create_status': defineRoute({
    input: z.object({ bookId: z.string().min(1) }),
    output: z.object({
      status: z.enum(['creating', 'ready', 'error', 'missing']),
      error: z.string().optional()
    })
  }),
  'novel.get_book': defineRoute({
    input: z.object({ bookId: z.string().min(1) }),
    output: bookSummarySchema.nullable()
  }),

  // 章节
  'novel.list_chapters': defineRoute({
    input: z.object({ bookId: z.string().min(1) }),
    output: z.object({
      chapters: z.array(chapterSummarySchema),
      chapterCount: z.number()
    })
  }),
  'novel.get_chapter': defineRoute({
    input: z.object({ bookId: z.string().min(1), chapterNumber: z.number().int().positive() }),
    output: z.object({
      chapterNumber: z.number(),
      filename: z.string().nullable(),
      content: z.string()
    })
  }),
  'novel.save_chapter': defineRoute({
    input: z.object({
      bookId: z.string().min(1),
      chapterNumber: z.number().int().positive(),
      content: z.string()
    }),
    output: z.void()
  }),

  // 写作/审稿动作
  'novel.write_next': defineRoute({
    input: z.object({ bookId: z.string().min(1) }),
    output: z.void()
  }),
  'novel.audit_chapter': defineRoute({
    input: z.object({ bookId: z.string().min(1), chapterNumber: z.number().int().positive() }),
    output: z.object({
      passed: z.boolean().optional(),
      issues: z.array(z.object({ severity: z.string().optional(), message: z.string().optional() })).optional()
    })
  }),
  'novel.revise_chapter': defineRoute({
    input: z.object({
      bookId: z.string().min(1),
      chapterNumber: z.number().int().positive(),
      mode: z.enum(['polish', 'rewrite', 'rework', 'spot-fix', 'anti-detect']).optional(),
      brief: z.string().optional()
    }),
    output: z.unknown()
  }),
  'novel.approve_chapter': defineRoute({
    input: z.object({
      bookId: z.string().min(1),
      chapterNumber: z.number().int().positive(),
      reason: z.string().optional()
    }),
    output: z.void()
  }),
  'novel.reject_chapter': defineRoute({
    input: z.object({
      bookId: z.string().min(1),
      chapterNumber: z.number().int().positive(),
      reason: z.string().optional()
    }),
    output: z.void()
  }),

  // 引擎错误（统一透传）
  'novel.engine_error': defineRoute({
    input: z.void(),
    output: apiErrorSchema.nullable()
  })
}
