import { describe, expect, it } from 'vitest'

import {
  bodySceneMarkers,
  chapterScenes,
  characterStateAt,
  characterStates,
  countProse,
  foreshadowAt,
  isNovelRepo,
  listChapters,
  povState,
  readChapterDocument,
  readNovelState,
  sceneProse,
  timelineAt,
  worldState
} from '../parser'

const SAMPLE = 'D:/Github_Open/novel-spec/examples/sample-novel'

describe('novel parser', () => {
  it('detects a novel-spec repository by NOVEL.toml', () => {
    expect(isNovelRepo(SAMPLE)).toBe(true)
    expect(isNovelRepo('D:/Github_Open/novel-spec')).toBe(false)
    expect(isNovelRepo('')).toBe(false)
  })

  it('lists chapters in numeric order', () => {
    expect(listChapters(SAMPLE)).toEqual(['v01-c001', 'v01-c002', 'v01-c003'])
  })

  it('parses chapter frontmatter and body', () => {
    const doc = readChapterDocument(SAMPLE, 'v01-c003')
    expect(doc.frontmatter.id).toBe('v01-c003')
    expect(doc.frontmatter.status).toBe('reviewed')
    expect(doc.frontmatter.scenes).toHaveLength(3)
    expect(doc.frontmatter.scenes?.[0].id).toBe('s01')
    // Body excludes frontmatter, keeps prose + scene markers.
    expect(doc.body).toContain('<!-- scene:s01 -->')
    expect(doc.body).not.toContain('state_after:')
  })

  it('extracts scene markers in body order', () => {
    const doc = readChapterDocument(SAMPLE, 'v01-c003')
    expect(bodySceneMarkers(doc.body)).toEqual(['s01', 's02', 's03'])
  })

  it('splits scene prose at markers', () => {
    const doc = readChapterDocument(SAMPLE, 'v01-c003')
    const scenes = doc.frontmatter.scenes ?? []
    const prose = sceneProse(doc.body, scenes, 0)
    expect(prose.length).toBeGreaterThan(0)
    expect(prose).not.toContain('<!-- scene:')
  })

  it('builds chapter scenes with per-scene prose', () => {
    const doc = readChapterDocument(SAMPLE, 'v01-c003')
    const scenes = chapterScenes(doc)
    expect(scenes).toHaveLength(3)
    expect(scenes.map((s) => s.plan.id)).toEqual(['s01', 's02', 's03'])
    for (const scene of scenes) {
      expect(scene.prose.length).toBeGreaterThan(0)
    }
  })

  it('counts words and Han characters, excluding scene markers', () => {
    const doc = readChapterDocument(SAMPLE, 'v01-c003')
    const unit = doc.frontmatter.countUnit ?? 'words'
    expect(unit).toBe('words')
    const count = countProse(doc.body, unit)
    // The reference runtime measured 585 words for this chapter.
    expect(count).toBe(585)
    // Markers must not contribute to the count.
    const withMarker = `<!-- scene:s99 -->\n${doc.body}`
    expect(countProse(withMarker, unit)).toBe(count)
  })

  it('throws on missing or out-of-order scene markers', () => {
    const body = '正文 s01 部分\n\n正文 s02 部分'
    const scenes = [
      { id: 's01', type: 'dialogue' },
      { id: 's02', type: 'psychology' }
    ]
    expect(() => sceneProse(body, scenes, 0)).toThrow('must contain ordered')
    const reversed = '<!-- scene:s02 -->\n\n<!-- scene:s01 -->'
    expect(() => sceneProse(reversed, scenes, 0)).toThrow('not in frontmatter order')
  })
})

describe('novel state reads', () => {
  it('reads the world bible', () => {
    const world = worldState(SAMPLE)
    expect(world.name).toContain('Lighthouse Keeper')
    expect(world.era).toBe('Post-Blackout, year 7')
    expect(world.rules?.length).toBeGreaterThan(0)
  })

  it('reads current character state as the latest history snapshot', () => {
    const states = characterStates(SAMPLE)
    expect(states.map((s) => s.id).sort()).toEqual(['keeper', 'stranger'])
    const corra = states.find((s) => s.id === 'stranger')
    expect(corra?.name).toBe('Corra')
    expect(corra?.asOfChapter).toBe(3)
    // The satchel that was restored with the sample integrity fix is present.
    expect(corra?.current.inventory).toContain('waterlogged satchel')
  })

  it('reads character state as of an earlier chapter', () => {
    const corra = characterStateAt(SAMPLE, 'stranger', 2)
    expect(corra?.asOfChapter).toBe(2)
    // Chapter 2 predates the fever break and the name reveal.
    expect(corra?.current.status).toBe('injured')
    expect(corra?.current.psychology).toContain('Weak but urgent')
    expect(corra?.current.inventory).toContain("sealed paper note (Mira's handwriting)")
  })

  it('returns null for an unknown character', () => {
    expect(characterStateAt(SAMPLE, 'missing', 0)).toBeNull()
  })

  it('lists only foreshadow entries open as of a chapter', () => {
    const now = foreshadowAt(SAMPLE)
    expect(now.map((f) => f.id).sort()).toEqual(['fs-storms', 'fs-whymira'])
    const at3 = foreshadowAt(SAMPLE, 3)
    expect(at3.map((f) => f.id).sort()).toEqual(['fs-storms', 'fs-whymira'])
    const at1 = foreshadowAt(SAMPLE, 1)
    // fs-note and fs-watch are planted in chapter 1 and still open there.
    expect(at1.map((f) => f.id).sort()).toEqual(['fs-note', 'fs-watch'])
  })

  it('filters timeline events by chapter', () => {
    const all = timelineAt(SAMPLE)
    expect(all.length).toBeGreaterThanOrEqual(5)
    const at2 = timelineAt(SAMPLE, 2)
    expect(at2.every((e) => /c(?:001|002)$/.test(e.chapter))).toBe(true)
    expect(at2.some((e) => e.chapter === 'v01-c002')).toBe(true)
    const limited = timelineAt(SAMPLE, 0, 2)
    expect(limited).toHaveLength(2)
  })

  it('reads the POV register', () => {
    const pov = povState(SAMPLE)
    expect(pov?.viewpoint).toContain('Aren')
    expect(pov?.tense).toBe('past')
  })

  it('builds a full as-of-chapter state view', () => {
    const state = readNovelState(SAMPLE, 2)
    expect(state.world.era).toBe('Post-Blackout, year 7')
    expect(state.characters.map((c) => c.id).sort()).toEqual(['keeper', 'stranger'])
    expect(state.foreshadow.every((f) => f.status === 'planted' || /c(?:001|002)$/.test(f.planted_at ?? ''))).toBe(true)
    expect(state.timeline.every((e) => /c(?:001|002)$/.test(e.chapter))).toBe(true)
    expect(state.pov?.viewpoint).toBeDefined()
  })
})
