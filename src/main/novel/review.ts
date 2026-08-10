import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import type { AiGenerateRequest } from '@main/ai/AiService'
import { parseUniqueModelId, type UniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import { isExternalCliProvider } from '@shared/utils/provider'

import type { NovelEngineClient } from './engineClient'
import { readChapterDocument } from './parser'

const logger = loggerService.withContext('NovelReview')

/**
 * Reviewer definitions mirror the engine repo's `agents/*.md` subagents
 * (clean-room transcription of the review doctrine; the reviewer prompts are
 * prompt text, not engine source). Each pass is one `AiService.generateText`
 * call whose output must be a single JSON object of the form
 * `{ reviewer, status, findings: [...] }`.
 */
export interface ReviewerDefinition {
  id: string
  label: string
  system: string
  user: string
}

export interface ReviewFinding {
  id: string
  reviewer: string
  severity: 'high' | 'medium' | 'low'
  summary: string
  resolution: 'fixed' | 'rejected' | 'deferred' | string
  rationale?: string
}

export interface ReviewPass {
  reviewer: string
  status: 'completed' | 'failed'
  error?: string
  findings: ReviewFinding[]
}

export interface ReviewOutcome {
  chapterId: string
  passes: ReviewPass[]
  /** True when every pass completed and the merged record satisfies the gate. */
  gatePassed: boolean
  gateError?: string
  /** Path of the appended ledger record (relative), when recorded. */
  recordFile?: string
  consistency: string
}

const REVIEW_OUTPUT_CONTRACT = `Return ONE JSON object and no prose outside it:
{
  "reviewer": "<your reviewer id>",
  "status": "completed",
  "findings": [
    {
      "id": "<reviewer-prefix>-NNN",
      "reviewer": "<your reviewer id>",
      "severity": "high | medium | low",
      "summary": "one or two sentences",
      "resolution": "fixed | rejected | deferred",
      "rationale": "required when resolution is rejected"
    }
  ]
}`

function reviewerPrompt(id: string, doctrine: string, context: Record<string, string>): ReviewerDefinition {
  const chapterId = context.chapterId
  return {
    id,
    label: id,
    system: `You are a ${id} for a novel-spec repository. Review only; never edit files.\n\n${doctrine}`,
    user: `Review chapter ${chapterId} of the novel-spec repository at ${context.root}.\n\n${Object.entries(context)
      .filter(([key]) => key !== 'chapterId' && key !== 'root')
      .map(([key, value]) => `## ${key}\n${value}`)
      .join('\n\n')}\n\n${REVIEW_OUTPUT_CONTRACT}`
  }
}

function buildReviewers(root: string, chapterId: string): ReviewerDefinition[] {
  const document = readChapterDocument(root, chapterId)
  const frontmatter = document.frontmatter
  const context: Record<string, string> = {
    chapterId,
    root,
    chapter: document.body,
    chapterFrontmatter: JSON.stringify(frontmatter, null, 2)
  }
  const definitions: Array<[string, string]> = [
    [
      'novel-consistency-reviewer',
      "Continuity editor. Reconstruct each involved character's state at the chapter boundary from .novel/state history[].as_of_chapter — never current for an earlier chapter. Check contradictions in character knowledge, location, injury/status, inventory, relationships, chronology, world rules, POV access, and state linkage. Distinguish a contradiction from an intentional mystery, unreliable narration, omission, or plausible unstated transition. Do not critique prose style."
    ],
    [
      'novel-foreshadow-reviewer',
      'Setup/payoff editor. Check every foreshadow_planted and foreshadow_resolved declaration against what the prose actually does; planted_at must be the first real on-page setup chapter, resolved_at the real payoff chapter. Detect promises resolved too early, payoffs without setup, repeated setup without escalation, accidental reveals, terminal threads presented as active, and important on-page setup missing from state. Preserve deliberate ambiguity; an open mystery is not a defect merely because it remains open.'
    ],
    [
      'novel-style-reviewer',
      'Line editor. Judge the chapter against the declared project voice (style/voice.md, style/anti-ai-rules.md, and scene benchmarks) rather than personal taste. Flag concrete AI-like patterns: generic emotional explanation, canned transitions, empty intensifiers, redundant interpretation after dialogue or image, repetitive sentence templates, fake profundity, unearned rhetorical questions, mechanical triplets, excessive dialogue tags, benchmark mimicry. Quote only the shortest fragment needed. Do not report plot or continuity issues.'
    ]
  ]
  return definitions.map(([id, doctrine]) => reviewerPrompt(id, doctrine, context))
}

/** Append a review record to the ledger via the engine; never overwrites history. */
export async function recordReviewViaEngine(
  engine: NovelEngineClient,
  chapterId: string,
  passes: ReviewPass[]
): Promise<string> {
  const result = await engine.callTool('record_review', {
    chapter_id: chapterId,
    status: 'passed',
    reviewers: passes.map((pass) => ({ name: pass.reviewer, status: 'completed' })),
    findings: passes.flatMap((pass) => pass.findings)
  })
  if (result.isError) {
    throw new Error(`record_review: ${result.text}`)
  }
  const parsed = JSON.parse(result.text) as { file?: string }
  return parsed.file ?? ''
}

/**
 * Run the three reviewer passes for a chapter. Each pass is a deterministic
 * single-shot generation — no agent loop. The merged result is appended to the
 * reviews ledger only when every reviewer completed and the record passes the
 * engine's finalize gate; otherwise the passes are returned so the panel can
 * show what blocked the gate.
 */
export async function runChapterReview(
  engine: NovelEngineClient,
  root: string,
  chapterId: string,
  uniqueModelId: UniqueModelId
): Promise<ReviewOutcome> {
  const reviewers = buildReviewers(root, chapterId)
  const passes: ReviewPass[] = []
  for (const reviewer of reviewers) {
    try {
      const result = await runReviewerPass(reviewer, uniqueModelId)
      const parsed = JSON.parse(result) as {
        reviewer?: string
        status?: string
        findings?: ReviewFinding[]
      }
      if (parsed.status !== 'completed' || !Array.isArray(parsed.findings)) {
        throw new Error(`reviewer returned malformed output: ${result.slice(0, 200)}`)
      }
      passes.push({ reviewer: reviewer.id, status: 'completed', findings: parsed.findings })
    } catch (error) {
      logger.error(`Reviewer pass failed: ${reviewer.id}`, error as Error)
      passes.push({ reviewer: reviewer.id, status: 'failed', error: String(error), findings: [] })
    }
  }

  const allCompleted = passes.every((pass) => pass.status === 'completed')
  const outcome: ReviewOutcome = {
    chapterId,
    passes,
    gatePassed: false,
    consistency: ''
  }
  if (!allCompleted) {
    outcome.gateError = 'one or more reviewer passes failed'
    return outcome
  }

  // Gate: the engine validates the record shape (three completed reviewers,
  // severities/resolutions, fixed highs). A rejected attempt records nothing
  // and surfaces the engine's message.
  try {
    outcome.recordFile = await recordReviewViaEngine(engine, chapterId, passes)
    outcome.gatePassed = true
  } catch (error) {
    outcome.gateError = String(error)
    return outcome
  }

  // Consistency is advisory here — a pass with findings still records (the
  // ledger is append-only history, not a pass/fail gate); finalize enforces it.
  try {
    const report = await engine.callTool('check_consistency', { chapter_id: chapterId })
    outcome.consistency = report.text
  } catch (error) {
    outcome.consistency = `consistency check failed: ${String(error)}`
  }
  return outcome
}

async function runReviewerPass(reviewer: ReviewerDefinition, uniqueModelId: UniqueModelId): Promise<string> {
  const request: AiGenerateRequest = {
    uniqueModelId,
    system: reviewer.system,
    prompt: reviewer.user,
    reasoningEffort: 'high'
  }
  const { text } = await application.get('AiService').generateText(request)
  return text
}

/** Validate a candidate model id the same way TopicNamingService does. */
export function toUsableModelId(candidate: string | null | undefined): UniqueModelId | null {
  const parsed = UniqueModelIdSchema.safeParse(candidate)
  if (!parsed.success) return null
  const { providerId, modelId } = parseUniqueModelId(parsed.data)
  try {
    const provider = providerService.getByProviderId(providerId)
    if (isExternalCliProvider(provider)) return null
    modelService.getByKey(providerId, modelId)
    return parsed.data
  } catch {
    return null
  }
}
