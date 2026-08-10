import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { NovelEngineClient } from '../engineClient'

/**
 * Integration tests against the real reasonix-novel engine binary (same
 * machine-specific path convention as parser.test.ts's SAMPLE). Exercises the
 * full NDJSON protocol: initialize handshake, tools/call, error propagation.
 * The engine's record_review writes to the workspace, so each test runs on a
 * private copy of the sample novel.
 */
const ENGINE_BIN = 'D:/Github_Open/reasonix-novel/reasonix-novel.exe'
const SAMPLE = 'D:/Github_Open/novel-spec/examples/sample-novel'

function sampleCopy(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'novel-engine-test-'))
  const target = path.join(dir, 'sample-novel')
  cpSync(SAMPLE, target, { recursive: true })
  return target
}

describe('NovelEngineClient (real engine)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('handshakes and calls tools over stdio', async () => {
    const engine = new NovelEngineClient(ENGINE_BIN, sampleCopy())
    try {
      await engine.start()
      const listed = await engine.callTool('check_consistency', { chapter_id: 'v01-c003' })
      expect(listed.isError).toBe(false)
      const parsed = JSON.parse(listed.text) as { chapter_id?: string; status?: string }
      expect(parsed.chapter_id).toBe('v01-c003')
      expect(parsed.status).toBe('clean')
    } finally {
      engine.stop()
    }
  })

  it('records a review through the append-only ledger', async () => {
    const engine = new NovelEngineClient(ENGINE_BIN, sampleCopy())
    try {
      await engine.start()
      const result = await engine.callTool('record_review', {
        chapter_id: 'v01-c003',
        status: 'passed',
        reviewers: [
          { name: 'novel-consistency-reviewer', status: 'completed' },
          { name: 'novel-foreshadow-reviewer', status: 'completed' },
          { name: 'novel-style-reviewer', status: 'completed' }
        ],
        findings: [
          {
            id: 'sty-test-1',
            reviewer: 'novel-style-reviewer',
            severity: 'low',
            summary: 'test finding',
            resolution: 'fixed'
          }
        ]
      })
      expect(result.isError).toBe(false)
      const parsed = JSON.parse(result.text) as { file?: string; status?: string }
      expect(parsed.file).toMatch(/v01-c003-\d{3}\.json$/)
      expect(parsed.status).toBe('passed')
    } finally {
      engine.stop()
    }
  })

  it('surfaces engine errors with isError', async () => {
    const engine = new NovelEngineClient(ENGINE_BIN, sampleCopy())
    try {
      await engine.start()
      const result = await engine.callTool('record_review', {
        chapter_id: 'v01-c003',
        status: 'failed',
        reviewers: [],
        findings: []
      })
      expect(result.isError).toBe(true)
      expect(result.text).toContain('review record rejected')
    } finally {
      engine.stop()
    }
  })
})
