import { describe, expect, it } from 'vitest'

import {
  bodySceneMarkers,
  chapterScenes,
  countProse,
  isNovelRepo,
  listChapters,
  readChapterDocument,
  sceneProse
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
