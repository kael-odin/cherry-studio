import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { InkEngineClient, NotFoundError, pickPort } from './inkEngineClient'
import {
  SAMPLE_BOOK_CONFIG,
  SAMPLE_BOOK_ID,
  SAMPLE_CHAPTER_INDEX,
  SAMPLE_CHAPTERS,
  SAMPLE_PROJECT_INKOS_JSON
} from './sampleSeed'

const logger = loggerService.withContext('NovelService')

/** InkOS API error envelope. */
export interface InkApiError {
  code: string
  message: string
}

// ── InkOS contracts (mirrors the live API wire format) ────────────────────

export interface InkBookSummary {
  id: string
  title: string
  platform: string
  genre: string
  status: string
  targetChapters: number
  chapterWordCount: number
  language?: 'zh' | 'en' | null
  createdAt: string
  updatedAt: string
  /** `nextChapterNumber - 1` — chapters actually on disk. */
  chaptersWritten: number
}

export interface InkChapterSummary {
  number: number
  title: string
  status: string
  wordCount: number
  createdAt: string
  updatedAt: string
  auditIssues: string[]
  reviewNote?: string
  lengthWarnings?: string[]
}

export interface InkChapterDetail {
  chapterNumber: number
  filename: string | null
  content: string
}

export interface InkProjectStatus {
  name: string
  language: string
  languageExplicit: boolean
  model: string
  provider: string
}

/** Book creation is async in the engine (architect run) — poll this for the result. */
export interface InkCreateStatus {
  status: 'creating' | 'ready' | 'error' | 'missing'
  error?: string
}

/** Result of a chapter audit run. */
export interface InkAuditResult {
  passed?: boolean
  issues?: Array<{ severity?: string; message?: string }>
}

/**
 * InkOS 工作台服务：把 InkOS 引擎（packages/studio API server，独立进程）
 * 暴露给渲染器。所有书/章节/写作/审稿操作都转发到引擎的 /api/v1 端点；
 * 主机进程不直接碰工作目录（VISION §7.1 引擎独立进程原则）。
 */
@Injectable('NovelService')
@ServicePhase(Phase.WhenReady)
export class NovelService extends BaseService {
  private workspacePath: string | null = null
  private engine: InkEngineClient | null = null
  private lastError: InkApiError | null = null

  protected onInit(): void {
    logger.info('NovelService initialized')
  }

  protected onDispose(): void {
    this.engine?.stop()
    this.engine = null
    this.workspacePath = null
    logger.info('NovelService disposed')
  }

  /** Current InkOS project root, or null when none is open. */
  getWorkspace(): string | null {
    return this.workspacePath
  }

  /** Open an InkOS project root; throws when it is not a project. */
  openWorkspace(root: string): string {
    if (!isInkProject(root)) {
      throw new Error(`not an inkos project root: ${root}`)
    }
    this.workspacePath = root
    this.engine?.stop()
    this.engine = null
    this.lastError = null
    logger.info(`Novel workspace opened: ${root}`)
    return root
  }

  closeWorkspace(): void {
    if (this.workspacePath) {
      logger.info(`Novel workspace closed: ${this.workspacePath}`)
      this.workspacePath = null
    }
    this.engine?.stop()
    this.engine = null
    this.lastError = null
  }

  /** Last engine error (cleared on success), for the renderer's error banner. */
  lastEngineError(): InkApiError | null {
    return this.lastError
  }

  /**
   * 一键初始化示例工作区：在 feature.novel.workspace 下生成一个 InkOS 项目
   * （inkos.json + 示例小说《灯塔守夜人》三章），然后打开它。
   * 已存在项目时直接打开，不覆盖用户数据。
   */
  async initWorkspace(): Promise<string> {
    const root = application.getPath('feature.novel.workspace')
    if (!isInkProject(root)) {
      await seedSampleWorkspace(root)
      logger.info(`Novel sample workspace seeded: ${root}`)
    }
    return this.openWorkspace(root)
  }

  /** InkOS project status (config) for the open workspace. */
  async projectStatus(): Promise<InkProjectStatus> {
    const engine = await this.engineApi()
    return engine.request('GET', '/api/v1/project')
  }

  /** Book shelf. */
  async listBooks(): Promise<InkBookSummary[]> {
    const engine = await this.engineApi()
    const { books } = await engine.request<{ books: InkBookSummary[] }>('GET', '/api/v1/books')
    return books
  }

  /**
   * Create a book via the engine. The engine starts an AI architect run and
   * answers immediately; the actual book appears on disk asynchronously —
   * poll `createStatus(bookId)` until it reports `ready`.
   */
  async createBook(input: {
    title: string
    genre: string
    language?: 'zh' | 'en'
    platform?: string
    chapterWordCount?: number
    targetChapters?: number
    blurb?: string
  }): Promise<{ id: string }> {
    const engine = await this.engineApi()
    return engine.request('POST', '/api/v1/books/create', input, 30_000)
  }

  /** Async book-creation status (creating → ready | error | missing). */
  async createStatus(bookId: string): Promise<InkCreateStatus> {
    const engine = await this.engineApi()
    try {
      return await engine.request('GET', `/api/v1/books/${encodeURIComponent(bookId)}/create-status`)
    } catch (error) {
      if (error instanceof NotFoundError) {
        return { status: 'missing' }
      }
      throw error
    }
  }

  /** One book summary (chapters come back with the detail). */
  async getBook(bookId: string): Promise<InkBookSummary | null> {
    const engine = await this.engineApi()
    try {
      const { book } = await engine.request<{ book: InkBookSummary }>(
        'GET',
        `/api/v1/books/${encodeURIComponent(bookId)}`
      )
      return book
    } catch (error) {
      if (error instanceof NotFoundError) return null
      throw error
    }
  }

  /** Chapter list + count, folded into the book detail response. */
  async listChapters(bookId: string): Promise<{ chapters: InkChapterSummary[]; chapterCount: number }> {
    const engine = await this.engineApi()
    const { chapters, nextChapter } = await engine.request<{
      chapters: InkChapterSummary[]
      nextChapter: number
    }>('GET', `/api/v1/books/${encodeURIComponent(bookId)}`)
    return { chapters, chapterCount: nextChapter - 1 }
  }

  /** Raw chapter document (title/status live in the chapter index). */
  async getChapter(bookId: string, chapterNumber: number): Promise<InkChapterDetail> {
    const engine = await this.engineApi()
    try {
      return await engine.request('GET', `/api/v1/books/${encodeURIComponent(bookId)}/chapters/${chapterNumber}`)
    } catch (error) {
      if (error instanceof NotFoundError) {
        return { chapterNumber, filename: null, content: '' }
      }
      throw error
    }
  }

  /** Save chapter content (engine runs the edit transaction + versions). */
  async saveChapter(bookId: string, chapterNumber: number, content: string): Promise<void> {
    const engine = await this.engineApi()
    await engine.request('PUT', `/api/v1/books/${encodeURIComponent(bookId)}/chapters/${chapterNumber}`, {
      content
    })
  }

  /** Write the next chapter (AI). Fire-and-forget; completion arrives via SSE. */
  async writeNext(bookId: string): Promise<void> {
    const engine = await this.engineApi()
    await engine.request('POST', `/api/v1/books/${encodeURIComponent(bookId)}/write-next`, {}, 30_000)
  }

  /** Audit a chapter for continuity/AI-tells. */
  async auditChapter(bookId: string, chapterNumber: number): Promise<InkAuditResult> {
    const engine = await this.engineApi()
    return engine.request('POST', `/api/v1/books/${encodeURIComponent(bookId)}/audit/${chapterNumber}`, {}, 180_000)
  }

  /** Revise a chapter (polish/rewrite/spot-fix) in the engine. */
  async reviseChapter(
    bookId: string,
    chapterNumber: number,
    mode: 'polish' | 'rewrite' | 'rework' | 'spot-fix' | 'anti-detect' = 'spot-fix',
    brief?: string
  ): Promise<unknown> {
    const engine = await this.engineApi()
    return engine.request(
      'POST',
      `/api/v1/books/${encodeURIComponent(bookId)}/revise/${chapterNumber}`,
      { mode, brief },
      180_000
    )
  }

  /** Approve a chapter. */
  async approveChapter(bookId: string, chapterNumber: number, reason?: string): Promise<void> {
    const engine = await this.engineApi()
    await engine.request('POST', `/api/v1/books/${encodeURIComponent(bookId)}/chapters/${chapterNumber}/approve`, {
      chapterNumber,
      reason
    })
  }

  /** Reject a chapter (engine rolls back to the previous chapter). */
  async rejectChapter(bookId: string, chapterNumber: number, reason?: string): Promise<void> {
    const engine = await this.engineApi()
    await engine.request('POST', `/api/v1/books/${encodeURIComponent(bookId)}/chapters/${chapterNumber}/reject`, {
      chapterNumber,
      reason
    })
  }

  /** Engine instance (started on demand); errors are captured for the UI. */
  private async engineApi(): Promise<InkEngineClient> {
    this.requireWorkspace()
    if (!this.engine) {
      this.engine = new InkEngineClient(process.execPath, inkosEntry(), this.workspacePath as string, pickPort())
    }
    try {
      await this.engine.start()
    } catch (error) {
      this.lastError = { code: 'ENGINE_START_FAILED', message: (error as Error).message }
      throw error
    }
    return this.engine
  }

  private requireWorkspace(): string {
    if (!this.workspacePath) {
      throw new Error('no novel workspace open')
    }
    return this.workspacePath
  }
}

/** InkOS engine entry: `packages/studio/dist/api/index.js` under INKOS_ROOT. */
function inkosEntry(): string {
  const root = process.env.INKOS_ROOT ?? 'D:/Github_Open/inkos'
  return path.join(root, 'packages', 'studio', 'dist', 'api', 'index.js')
}

/** True when the path is an InkOS project root (has inkos.json). */
function isInkProject(root: string): boolean {
  return existsSync(path.join(root, 'inkos.json'))
}

/** Write the sample InkOS project (project config + sample book) into `root`. */
async function seedSampleWorkspace(root: string): Promise<void> {
  const bookDir = path.join(root, 'books', SAMPLE_BOOK_ID)
  const chaptersDir = path.join(bookDir, 'chapters')
  await mkdir(chaptersDir, { recursive: true })
  await writeFile(path.join(root, 'inkos.json'), JSON.stringify(SAMPLE_PROJECT_INKOS_JSON, null, 2), 'utf-8')
  await writeFile(path.join(root, '.gitignore'), '.env\nnode_modules/\n.DS_Store\n', 'utf-8')
  await writeFile(path.join(bookDir, 'book.json'), JSON.stringify(SAMPLE_BOOK_CONFIG, null, 2), 'utf-8')
  await writeFile(path.join(chaptersDir, 'index.json'), JSON.stringify(SAMPLE_CHAPTER_INDEX, null, 2), 'utf-8')
  for (const chapter of SAMPLE_CHAPTERS) {
    await writeFile(path.join(chaptersDir, chapter.filename), chapter.content, 'utf-8')
  }
}
