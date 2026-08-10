import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { parse as parseYaml } from 'yaml'

/**
 * Pure novel-spec repository parsing for the novel panel. No Electron, no IO
 * beyond the repo files themselves. Semantics mirror the reference runtime
 * (reasonix-novel chapter.go); the repository is the single source of truth.
 */

export interface ScenePlan {
  id: string
  type: string
  targetChars?: number
  pov?: string
  goal?: string
  status?: string
}

export interface ChapterFrontmatter {
  id: string
  volume?: number
  chapter?: number
  title?: string
  wordCount?: number
  proseCount?: number
  targetChars?: number
  countUnit?: 'han_chars' | 'words'
  stateAfter?: string
  foreshadowPlanted?: string[]
  foreshadowResolved?: string[]
  status?: string
  scenes?: ScenePlan[]
}

export interface ChapterDocument {
  frontmatter: ChapterFrontmatter
  body: string
}

export interface SceneInfo {
  plan: ScenePlan
  /** Marker id, e.g. `s01`. */
  marker: string
  /** Order index in the declared scenes[] list. */
  index: number
  /** Prose for this scene (between its marker and the next), trimmed. */
  prose: string
}

const SCENE_MARKER_RE = /<!--\s*scene:(s[-\w]+)\s*-->/

/** A directory is a novel-spec repository when it declares `NOVEL.toml`. */
export function isNovelRepo(root: string): boolean {
  if (!root) return false
  try {
    return statSync(path.join(root, 'NOVEL.toml')).isFile()
  } catch {
    return false
  }
}

/**
 * Parse a chapter file (`chapters/<id>.md`) into frontmatter + prose body.
 * Mirrors reasonix-novel readChapterDocument: `---` fenced YAML on top, the
 * rest is the body.
 */
export function readChapterDocument(root: string, chapterId: string): ChapterDocument {
  const filePath = path.join(root, 'chapters', `${chapterId}.md`)
  let text: string
  try {
    text = readFileSync(filePath, 'utf8')
  } catch {
    throw new Error(`chapter not found: ${chapterId}`)
  }
  text = text.replace(/^﻿/, '')
  if (!text.startsWith('---')) {
    throw new Error(`chapter has no frontmatter: ${chapterId}`)
  }
  const rest = text.slice(3).replace(/^\r?\n/, '')
  const end = rest.indexOf('\n---')
  if (end < 0) {
    throw new Error(`chapter frontmatter has no closing fence: ${chapterId}`)
  }
  let frontmatter: ChapterFrontmatter
  try {
    frontmatter = (parseYaml(rest.slice(0, end)) ?? {}) as ChapterFrontmatter
  } catch {
    throw new Error(`parse chapter frontmatter failed: ${chapterId}`)
  }
  const body = rest.slice(end + 4).replace(/^\r?\n+/, '')
  return { frontmatter, body }
}

/**
 * List chapter files sorted by natural order (`v01-c003` → c001, c002, ...).
 * Non-chapter markdown files are skipped.
 */
export function listChapters(root: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(path.join(root, 'chapters'))
  } catch {
    return []
  }
  return entries
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.slice(0, -3))
    .sort((a, b) => {
      const num = (s: string) => {
        const m = /c(\d+)$/.exec(s)
        return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER
      }
      const an = num(a)
      const bn = num(b)
      return an === bn ? a.localeCompare(b) : an - bn
    })
}

/**
 * Extract the prose belonging to one planned scene: text between its marker
 * and the next marker, with the marker itself excluded (markers are structural
 * metadata, not prose). Throws when markers are missing or out of frontmatter
 * order — mirrors reasonix-novel sceneProse.
 */
export function sceneProse(body: string, scenes: ScenePlan[], sceneIndex: number): string {
  if (sceneIndex < 0 || sceneIndex >= scenes.length) {
    throw new Error('scene index is out of range')
  }
  const starts: number[] = []
  for (const scene of scenes) {
    const marker = `<!-- scene:${scene.id} -->`
    const index = body.indexOf(marker)
    if (index < 0) {
      throw new Error(`chapter body must contain ordered ${marker} markers`)
    }
    if (starts.length > 0 && index <= starts[starts.length - 1]) {
      throw new Error('chapter scene markers are not in frontmatter order')
    }
    starts.push(index)
  }
  const marker = `<!-- scene:${scenes[sceneIndex].id} -->`
  const start = starts[sceneIndex] + marker.length
  const end = sceneIndex + 1 < starts.length ? starts[sceneIndex + 1] : body.length
  return body.slice(start, end).trim()
}

/**
 * Count prose length per the chapter's count_unit, excluding scene markers
 * (mirrors reasonix-novel countProse: han_chars counts Han characters only;
 * words counts whitespace-delimited tokens). The regex is rebuilt per call —
 * sharing the module-level regex would carry exec()'s lastIndex across calls
 * and silently skip markers.
 */
export function countProse(body: string, unit: 'han_chars' | 'words'): number {
  const prose = body.replace(new RegExp(SCENE_MARKER_RE.source, 'g'), '')
  if (unit === 'words') {
    return (prose.match(/\S+/g) ?? []).length
  }
  if (unit === 'han_chars') {
    let count = 0
    for (const ch of prose) {
      if (/\p{Script=Han}/u.test(ch)) count++
    }
    return count
  }
  throw new Error(`unsupported count_unit: ${unit}`)
}

/** Marker ids present in the body, in order of appearance. */
export function bodySceneMarkers(body: string): string[] {
  return (body.match(new RegExp(SCENE_MARKER_RE.source, 'g')) ?? []).map(
    (m) => (SCENE_MARKER_RE.exec(m) as RegExpExecArray)[1]
  )
}

/** Build scene info (plan + marker + per-scene prose) for a parsed chapter. */
export function chapterScenes(doc: ChapterDocument): SceneInfo[] {
  const plans = doc.frontmatter.scenes ?? []
  return plans.map((plan, index) => ({
    plan,
    marker: plan.id,
    index,
    prose: sceneProse(doc.body, plans, index)
  }))
}

/* ------------------------------------------------------------------ *
 * State reading (read-only, as-of-chapter aware).                     *
 * Mirrors the reference runtime's buildStateSummary semantics:        *
 * character current is the latest history snapshot at or before the   *
 * requested chapter; foreshadow/timeline/pov are filtered the same    *
 * way. The repo files are the single source of truth — no mutation.   *
 * ------------------------------------------------------------------ */

export interface CharacterSnapshot {
  location?: string
  psychology?: string
  knowledge?: string[]
  inventory?: string[]
  relationships?: Record<string, string>
  status?: string
  notes?: string
}

export interface CharacterState {
  id: string
  name: string
  aliases?: string[]
  current: CharacterSnapshot
  /** as_of_chapter of the snapshot shown (current view: latest history chapter). */
  asOfChapter: number
}

export interface ForeshadowState {
  id: string
  /** Raw file keys are snake_case (`planted_at`/`resolved_at`), mirroring the repo format. */
  planted_at?: string
  resolved_at?: string
  status?: string
  description?: string
  payoff?: string
}

export interface TimelineEvent {
  id: string
  chapter: string
  absolute_time?: string
  narrative_time?: string
  description: string
  participants?: string[]
}

export interface PovState {
  chapter?: string
  viewpoint?: string
  tense?: string
  notes?: string
}

export interface NovelState {
  world: {
    name?: string
    era?: string
    premise?: string
    rules?: string[]
  }
  characters: CharacterState[]
  foreshadow: ForeshadowState[]
  timeline: TimelineEvent[]
  pov: PovState | null
}

/** Raw `current`/history snapshot of a character state file. */
interface CharacterDocument {
  id: string
  name: string
  aliases?: string[]
  current?: CharacterSnapshot
  history?: Array<{ as_of_chapter: number; snapshot: CharacterSnapshot }>
}

const stateDir = (root: string) => `${root}/.novel/state`

function readStateFile<T>(root: string, name: string): T | null {
  try {
    return JSON.parse(readFileSync(`${stateDir(root)}/${name}`, 'utf8')) as T
  } catch {
    return null
  }
}

/**
 * Latest character snapshot at or before the given chapter (0 = current).
 * Mirrors the reference runtime: the current view is the newest history
 * entry; an as-of view is the newest entry with as_of_chapter <= chapter.
 */
export function characterStateAt(root: string, id: string, asOf = 0): CharacterState | null {
  const document = readStateFile<CharacterDocument>(root, `characters/${id}.json`)
  if (!document?.id) return null
  let snapshot = document.current ?? {}
  let chapter = 0
  if (asOf > 0) {
    const best = (document.history ?? []).reduce<{ chapter: number; snapshot?: CharacterSnapshot } | null>(
      (best, entry) =>
        entry.as_of_chapter > 0 && entry.as_of_chapter <= asOf && (!best || entry.as_of_chapter > best.chapter)
          ? { chapter: entry.as_of_chapter, snapshot: entry.snapshot }
          : best,
      null
    )
    if (best?.snapshot) {
      snapshot = best.snapshot
      chapter = best.chapter
    }
  } else if (document.history && document.history.length > 0) {
    const latest = document.history[document.history.length - 1]
    chapter = latest.as_of_chapter
  }
  return { id: document.id, name: document.name, aliases: document.aliases, current: snapshot, asOfChapter: chapter }
}

/**
 * All character states as of a chapter (0 = current), in file order.
 * `_index.json` holds display-name mappings only and is skipped.
 */
export function characterStates(root: string, asOf = 0): CharacterState[] {
  let entries: string[]
  try {
    entries = readdirSync(`${stateDir(root)}/characters`)
  } catch {
    return []
  }
  return entries
    .filter((name) => name.endsWith('.json') && name !== '_index.json')
    .map((name) => characterStateAt(root, name.slice(0, -5), asOf))
    .filter((state): state is CharacterState => state !== null)
}

/**
 * Foreshadow entries open as of a chapter (0 = current: status planted;
 * otherwise planted at or before the chapter and unresolved by it).
 */
export function foreshadowAt(root: string, asOf = 0): ForeshadowState[] {
  const document = readStateFile<{ entries: ForeshadowState[] }>(root, 'foreshadow.json')
  const chapterNumber = (id: string | undefined) => {
    const match = /c(\d+)$/.exec(id ?? '')
    return match ? Number(match[1]) : 0
  }
  return (document?.entries ?? []).filter((entry) => {
    if (asOf <= 0) return entry.status === 'planted'
    const planted = chapterNumber(entry.planted_at)
    const resolved = chapterNumber(entry.resolved_at)
    return planted > 0 && planted <= asOf && (resolved === 0 || resolved > asOf)
  })
}

/** Timeline events at or before the given chapter, newest last (limit optional). */
export function timelineAt(root: string, asOf = 0, limit?: number): TimelineEvent[] {
  const document = readStateFile<{ events: TimelineEvent[] }>(root, 'timeline.json')
  const chapterNumber = (chapter: string | undefined) => {
    const match = /c(\d+)$/.exec(chapter ?? '')
    return match ? Number(match[1]) : 0
  }
  const events = (document?.events ?? []).filter((event) => asOf <= 0 || chapterNumber(event.chapter) <= asOf)
  return limit !== undefined ? events.slice(-limit) : events
}

/** POV register (current view). The file wraps the register in a `current` envelope. */
export function povState(root: string): PovState | null {
  const document = readStateFile<{ current?: PovState }>(root, 'pov.json')
  return document?.current ?? null
}

/**
 * World bible (name/era/premise/rules). Never mutates the repo.
 */
export function worldState(root: string): NovelState['world'] {
  return readStateFile<NovelState['world']>(root, 'world.json') ?? {}
}

/** Read-only, as-of-chapter-aware view of the whole durable state. */
export function readNovelState(root: string, asOf = 0): NovelState {
  return {
    world: worldState(root),
    characters: characterStates(root, asOf),
    foreshadow: foreshadowAt(root, asOf),
    timeline: timelineAt(root, asOf),
    pov: povState(root)
  }
}
