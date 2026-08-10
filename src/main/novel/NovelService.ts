import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import {
  bodySceneMarkers,
  type ChapterFrontmatter,
  chapterScenes,
  countProse,
  isNovelRepo,
  listChapters,
  readChapterDocument,
  type SceneInfo
} from './parser'

const logger = loggerService.withContext('NovelService')

export interface ChapterSummary {
  id: string
  title?: string
  volume?: number
  chapter?: number
  status?: string
  countUnit?: 'han_chars' | 'words'
  targetChars?: number
  proseCount?: number
  sceneCount: number
  sceneMarkers: string[]
}

export interface ChapterRead {
  frontmatter: ChapterFrontmatter
  body: string
  proseCount: number
}

export interface SceneContext {
  chapterId: string
  scenes: SceneInfo[]
  bodySceneMarkers: string[]
  proseCount: number
}

export interface ReviewRecordSummary {
  file: string
  chapterId?: string
  status?: string
  reviewerCount: number
  findingCount: number
}

/**
 * Novel-spec workspace service: opens a novel-spec git repository and serves
 * chapter/scene/state reads to the renderer. P1 is read-only — state writes
 * stay behind the engine's guarded tools (see VISION.md). The workspace root
 * is a renderer-provided absolute path (picked via the native dialog).
 */
@Injectable('NovelService')
@ServicePhase(Phase.WhenReady)
export class NovelService extends BaseService {
  private workspacePath: string | null = null

  protected onInit(): void {
    logger.info('NovelService initialized')
  }

  protected onDispose(): void {
    this.workspacePath = null
    logger.info('NovelService disposed')
  }

  /** Current workspace root, or null when none is open. */
  getWorkspace(): string | null {
    return this.workspacePath
  }

  /** Open a novel-spec repository; throws when the path is not one. */
  openWorkspace(root: string): string {
    if (!isNovelRepo(root)) {
      throw new Error(`not a novel-spec repository: ${root}`)
    }
    this.workspacePath = root
    logger.info(`Novel workspace opened: ${root}`)
    return root
  }

  closeWorkspace(): void {
    if (this.workspacePath) {
      logger.info(`Novel workspace closed: ${this.workspacePath}`)
      this.workspacePath = null
    }
  }

  private requireWorkspace(): string {
    if (!this.workspacePath) {
      throw new Error('no novel workspace open')
    }
    return this.workspacePath
  }

  /** Chapter list with frontmatter-derived summaries, ordered by chapter number. */
  listChapters(): ChapterSummary[] {
    const root = this.requireWorkspace()
    return listChapters(root).map((id) => {
      const doc = readChapterDocument(root, id)
      const markers = bodySceneMarkers(doc.body)
      return {
        id,
        title: doc.frontmatter.title,
        volume: doc.frontmatter.volume,
        chapter: doc.frontmatter.chapter,
        status: doc.frontmatter.status,
        countUnit: doc.frontmatter.countUnit,
        targetChars: doc.frontmatter.targetChars,
        proseCount: doc.frontmatter.proseCount,
        sceneCount: (doc.frontmatter.scenes ?? []).length,
        sceneMarkers: markers
      }
    })
  }

  /** Full chapter document with a fresh prose count. */
  readChapter(chapterId: string): ChapterRead {
    const root = this.requireWorkspace()
    const doc = readChapterDocument(root, chapterId)
    const unit = doc.frontmatter.countUnit ?? 'words'
    return { ...doc, proseCount: countProse(doc.body, unit) }
  }

  /** Per-scene context for a chapter (plan + markers + scene prose). */
  sceneContext(chapterId: string): SceneContext {
    const root = this.requireWorkspace()
    const doc = readChapterDocument(root, chapterId)
    return {
      chapterId,
      scenes: chapterScenes(doc),
      bodySceneMarkers: bodySceneMarkers(doc.body),
      proseCount: countProse(doc.body, doc.frontmatter.countUnit ?? 'words')
    }
  }

  /** Review records for a chapter (latest first). */
  listReviews(chapterId: string): ReviewRecordSummary[] {
    const root = this.requireWorkspace()
    const dir = path.join(root, 'reviews')
    let files: string[]
    try {
      files = readdirSync(dir).filter((name) => name.startsWith(`${chapterId}-`) && name.endsWith('.json'))
    } catch {
      return []
    }
    files.sort()
    return files.reverse().map((file) => {
      try {
        const record = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as {
          chapter_id?: string
          status?: string
          reviewers?: unknown[]
          findings?: unknown[]
        }
        return {
          file,
          chapterId: record.chapter_id,
          status: record.status,
          reviewerCount: record.reviewers?.length ?? 0,
          findingCount: record.findings?.length ?? 0
        }
      } catch {
        return { file, reviewerCount: 0, findingCount: 0 }
      }
    })
  }

  /** Workspace-level summary (spec version, chapter counts). */
  workspaceStatus(): { path: string; chapterCount: number; specVersion?: string } {
    const root = this.requireWorkspace()
    const chapterCount = listChapters(root).length
    let specVersion: string | undefined
    try {
      const spec = JSON.parse(readFileSync(path.join(root, '.novel', 'spec.json'), 'utf8')) as {
        version?: string
      }
      specVersion = spec.version
    } catch {
      // spec.json is optional in v0.1; absence is fine.
    }
    return { path: root, chapterCount, specVersion }
  }
}
