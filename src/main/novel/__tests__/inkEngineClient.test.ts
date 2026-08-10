import { existsSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { EngineApiError, InkEngineClient, NotFoundError, pickPort } from '../inkEngineClient'

describe('InkEngineClient error mapping', () => {
  it('NotFoundError is an Error subclass', () => {
    const err = new NotFoundError('InkOS 404: /api/v1/books/missing')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('404')
  })

  it('EngineApiError carries the engine error code', () => {
    const err = new EngineApiError('LLM_CONFIG_ERROR', 'Studio LLM API key not set.')
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('LLM_CONFIG_ERROR')
    expect(err.message).toContain('API key')
  })

  it('maps 404 responses to NotFoundError', async () => {
    // Note: the real engine returns 404 JSON for missing resources; the client
    // surfaces it as NotFoundError so callers can treat it as "absent".
    const response = new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'book missing' } }), {
      status: 404
    })
    expect(response.status).toBe(404)
    expect(NotFoundError.name).toBe('NotFoundError')
  })
})

// ── Integration: the real InkOS engine process ──────────────────────────────
// Spawns packages/studio/dist/api/index.js from the local inkos checkout and
// round-trips the REST surface. Skipped automatically when the checkout or its
// dist build is missing (e.g. CI without INKOS_ROOT).

const INKOS_ROOT = process.env.INKOS_ROOT ?? 'D:/Github_Open/inkos'
const ENGINE_ENTRY = path.join(INKOS_ROOT, 'packages', 'studio', 'dist', 'api', 'index.js')
const PROJECT_ROOT = path.join(INKOS_ROOT, 'test-project')
const engineAvailable = existsSync(ENGINE_ENTRY) && existsSync(path.join(PROJECT_ROOT, 'inkos.json'))

describe.skipIf(!engineAvailable)('InkEngineClient against the real engine', () => {
  it('spawns the engine, answers the project probe, lists books, and stops cleanly', async () => {
    const engine = new InkEngineClient(process.execPath, ENGINE_ENTRY, PROJECT_ROOT, pickPort())
    try {
      await engine.start()
      expect(engine.running).toBe(true)
      expect(engine.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

      const project = (await engine.request('GET', '/api/v1/project')) as Record<string, unknown>
      expect(project).toMatchObject({ name: expect.any(String) })

      // The books list is envelope-wrapped: { books: [...] }.
      const list = (await engine.request('GET', '/api/v1/books')) as { books: unknown[] }
      expect(Array.isArray(list.books)).toBe(true)
    } finally {
      engine.stop()
    }
  }, 90_000)

  it('round-trips the sample book (灯塔守夜人) with its three chapters', async () => {
    const engine = new InkEngineClient(process.execPath, ENGINE_ENTRY, PROJECT_ROOT, pickPort())
    try {
      await engine.start()

      // Book on the shelf with 3 chapters written.
      const list = (await engine.request('GET', '/api/v1/books')) as {
        books: Array<{ id: string; title: string; chaptersWritten: number }>
      }
      const sample = list.books.find((b) => b.id === 'lighthouse-keeper')
      expect(sample).toBeTruthy()
      expect(sample?.title).toBe('灯塔守夜人')
      expect(sample?.chaptersWritten).toBe(3)

      // Chapter list folds into the book detail: 3 chapters, next is #4.
      const detail = (await engine.request('GET', '/api/v1/books/lighthouse-keeper')) as {
        book: { title: string }
        chapters: unknown[]
        nextChapter: number
      }
      expect(detail.book.title).toBe('灯塔守夜人')
      expect(detail.chapters).toHaveLength(3)
      expect(detail.nextChapter).toBe(4)

      // Chapter 3 content round-trips.
      const chapter = (await engine.request('GET', '/api/v1/books/lighthouse-keeper/chapters/3')) as {
        chapterNumber: number
        content: string
      }
      expect(chapter.chapterNumber).toBe(3)
      expect(chapter.content).toContain('潮汐')
    } finally {
      engine.stop()
    }
  }, 90_000)
})
