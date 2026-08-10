/**
 * Review orchestration tests. The three reviewer passes run through
 * AiService.generateText (mocked); the engine (NovelEngineClient) is stubbed
 * so the append/consistency path is exercised without spawning a process.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  engine: {
    callTool: vi.fn(),
    start: vi.fn()
  }
}))

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory({
    AiService: { generateText: mocks.generateText },
    NovelService: {}
  } as never)
})

vi.mock('../engineClient', () => ({
  NovelEngineClient: vi.fn(() => mocks.engine)
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: vi.fn() }
}))
vi.mock('@data/services/ProviderService', () => ({
  providerService: { getByProviderId: vi.fn(() => ({ id: 'p1' })) }
}))
vi.mock('@shared/utils/provider', () => ({
  isExternalCliProvider: vi.fn(() => false)
}))

import { runChapterReview, toUsableModelId } from '../review'

const SAMPLE = 'D:/Github_Open/novel-spec/examples/sample-novel'
const MODEL_ID = 'p1::m1'

beforeEach(() => {
  mocks.generateText.mockReset()
  mocks.engine.callTool.mockReset()
  mocks.engine.start.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('runChapterReview', () => {
  it('runs three passes, records the record, and checks consistency', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        reviewer: 'novel-consistency-reviewer',
        status: 'completed',
        findings: [
          {
            id: 'con-1',
            reviewer: 'novel-consistency-reviewer',
            severity: 'low',
            summary: 'minor',
            resolution: 'fixed'
          }
        ]
      })
    })
    mocks.engine.callTool.mockImplementation(async (name: string) => {
      if (name === 'record_review') {
        return { isError: false, text: JSON.stringify({ file: 'reviews/v01-c003-003.json', status: 'passed' }) }
      }
      if (name === 'check_consistency') {
        return { isError: false, text: JSON.stringify({ status: 'clean', findings: [] }) }
      }
      return { isError: false, text: '' }
    })

    const outcome = await runChapterReview(mocks.engine as never, SAMPLE, 'v01-c003', MODEL_ID as never)

    expect(mocks.generateText).toHaveBeenCalledTimes(3)
    expect(outcome.gatePassed).toBe(true)
    expect(outcome.recordFile).toBe('reviews/v01-c003-003.json')
    expect(outcome.passes).toHaveLength(3)
    expect(outcome.passes.every((pass) => pass.status === 'completed')).toBe(true)
    expect(outcome.consistency).toContain('"status":"clean"')

    const recordArgs = mocks.engine.callTool.mock.calls.find(([name]) => name === 'record_review')
    expect(recordArgs).toBeDefined()
    const record = (recordArgs as [string, Record<string, unknown>])[1]
    expect(record.chapter_id).toBe('v01-c003')
    expect((record.reviewers as Array<{ name: string }>).map((r) => r.name)).toEqual([
      'novel-consistency-reviewer',
      'novel-foreshadow-reviewer',
      'novel-style-reviewer'
    ])
  })

  it('reports gate failure when a reviewer pass fails', async () => {
    mocks.generateText.mockRejectedValue(new Error('provider down'))
    const outcome = await runChapterReview(mocks.engine as never, SAMPLE, 'v01-c003', MODEL_ID as never)
    expect(outcome.gatePassed).toBe(false)
    expect(outcome.gateError).toContain('reviewer pass')
    expect(outcome.recordFile).toBeUndefined()
    // No record write when a pass fails.
    expect(mocks.engine.callTool).not.toHaveBeenCalledWith('record_review', expect.anything())
  })

  it('surfaces engine gate rejections without recording', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        reviewer: 'novel-consistency-reviewer',
        status: 'completed',
        findings: []
      })
    })
    mocks.engine.callTool.mockResolvedValue({
      isError: true,
      text: 'review record rejected: high finding con-1 is not fixed'
    })
    const outcome = await runChapterReview(mocks.engine as never, SAMPLE, 'v01-c003', MODEL_ID as never)
    expect(outcome.gatePassed).toBe(false)
    expect(outcome.gateError).toContain('high finding con-1 is not fixed')
  })
})

describe('toUsableModelId', () => {
  it('returns null for unusable candidates', () => {
    expect(toUsableModelId(null)).toBeNull()
    expect(toUsableModelId('garbage')).toBeNull()
    expect(toUsableModelId('')).toBeNull()
  })

  it('accepts provider::model ids backed by a real provider/model', () => {
    expect(toUsableModelId(MODEL_ID)).toBe(MODEL_ID)
  })
})
