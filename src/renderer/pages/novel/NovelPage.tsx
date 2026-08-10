import { Badge, Button, Skeleton } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { OutputFor } from '@shared/ipc/types'
import { BookOpen, Flag, FolderOpen, Play, ShieldCheck, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('NovelPage')

type ChapterRead = OutputFor<'novel.read_chapter'>
type SceneContext = OutputFor<'novel.scene_context'>
type WorkspaceStatus = OutputFor<'novel.get_status'>
type ChapterSummary = OutputFor<'novel.list_chapters'>[number]
type NovelState = OutputFor<'novel.state_read'>
type ReviewOutcome = OutputFor<'novel.run_review'>

/** Read-only novel-spec workspace viewer. P1 panel: open a repo, list
 * chapters/scenes/reviews, preview a chapter and its durable state. State
 * writes stay behind the engine (see VISION.md). */
function NovelPage() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<WorkspaceStatus | null>(null)
  const [chapters, setChapters] = useState<ChapterSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [chapterRead, setChapterRead] = useState<ChapterRead | null>(null)
  const [sceneContext, setSceneContext] = useState<SceneContext | null>(null)
  const [reviews, setReviews] = useState<OutputFor<'novel.list_reviews'>>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'chapter' | 'state' | 'review'>('chapter')
  const [asOfChapter, setAsOfChapter] = useState(0)
  const [novelState, setNovelState] = useState<NovelState | null>(null)
  const [stateLoading, setStateLoading] = useState(false)
  const [reviewOutcome, setReviewOutcome] = useState<ReviewOutcome | null>(null)
  const [reviewRunning, setReviewRunning] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeResult, setFinalizeResult] = useState<string | null>(null)
  const [quickAssistantModelId] = usePreference('feature.quick_assistant.model_id')
  const [chatDefaultModelId] = usePreference('chat.default_model_id')
  const reviewModelId = quickAssistantModelId ?? chatDefaultModelId

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await ipcApi.request('novel.get_status'))
    } catch (err) {
      logger.error('Failed to read novel workspace status', err as Error)
      setError(String(err))
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const openWorkspace = useCallback(async () => {
    try {
      const folder = await window.api.file.selectFolder()
      if (!folder) return
      setBusy(true)
      setError(null)
      try {
        await ipcApi.request('novel.open_workspace', { root: folder })
        await refreshStatus()
        setChapters(await ipcApi.request('novel.list_chapters'))
        setSelectedId(null)
        setChapterRead(null)
        setSceneContext(null)
        setReviews([])
        setNovelState(null)
        setReviewOutcome(null)
        setFinalizeResult(null)
        setAsOfChapter(0)
        setTab('chapter')
      } finally {
        setBusy(false)
      }
    } catch (err) {
      logger.error('Failed to open novel workspace', err as Error)
      toast.error(t('novel.open_failed'))
      setError(String(err))
    }
  }, [refreshStatus, t])

  const closeWorkspace = useCallback(async () => {
    try {
      await ipcApi.request('novel.close_workspace')
      setStatus(null)
      setChapters([])
      setSelectedId(null)
      setChapterRead(null)
      setSceneContext(null)
      setReviews([])
      setNovelState(null)
      setReviewOutcome(null)
      setFinalizeResult(null)
      setAsOfChapter(0)
      setTab('chapter')
      setError(null)
    } catch (err) {
      logger.error('Failed to close novel workspace', err as Error)
      toast.error(t('novel.close_failed'))
    }
  }, [t])

  // Load the read-only state view when the state tab is active.
  useEffect(() => {
    if (!status || tab !== 'state') return
    let cancelled = false
    setStateLoading(true)
    ipcApi
      .request('novel.state_read', { asOfChapter })
      .then((state) => {
        if (!cancelled) setNovelState(state)
      })
      .catch((err) => {
        logger.error('Failed to read novel state', err as Error)
        if (!cancelled) setError(String(err))
      })
      .finally(() => {
        if (!cancelled) setStateLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [status, tab, asOfChapter])

  const selectChapter = useCallback(async (chapterId: string) => {
    setSelectedId(chapterId)
    setError(null)
    setChapterRead(null)
    setSceneContext(null)
    setReviews([])
    try {
      const [read, scenes, reviewList] = await Promise.all([
        ipcApi.request('novel.read_chapter', { chapterId }),
        ipcApi.request('novel.scene_context', { chapterId }),
        ipcApi.request('novel.list_reviews', { chapterId })
      ])
      setChapterRead(read)
      setSceneContext(scenes)
      setReviews(reviewList)
    } catch (err) {
      logger.error('Failed to read chapter', err as Error, { chapterId })
      setError(String(err))
    }
  }, [])

  // Refresh the open workspace's chapters when the tab gains focus, so edits
  // made by the CLI/host (engine runs, review gates) show up on return.
  useEffect(() => {
    const onFocus = () => {
      if (!status) return
      void ipcApi
        .request('novel.list_chapters')
        .then(setChapters)
        .catch((err) => logger.warn('Failed to refresh chapter list on focus', err as Error))
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [status])

  const runReview = useCallback(async () => {
    if (!selectedId || !reviewModelId) return
    setReviewRunning(true)
    setFinalizeResult(null)
    setError(null)
    try {
      const outcome = await ipcApi.request('novel.run_review', {
        chapterId: selectedId,
        modelId: reviewModelId
      })
      setReviewOutcome(outcome)
      setReviews(await ipcApi.request('novel.list_reviews', { chapterId: selectedId }))
    } catch (err) {
      logger.error('Failed to run novel review', err as Error)
      toast.error(t('novel.review_run'))
      setError(String(err))
    } finally {
      setReviewRunning(false)
    }
  }, [selectedId, reviewModelId, t])

  const finalize = useCallback(
    async (status: 'reviewed' | 'final') => {
      if (!selectedId) return
      setFinalizing(true)
      setError(null)
      try {
        const result = await ipcApi.request('novel.finalize', { chapterId: selectedId, status })
        setFinalizeResult(t('novel.review_finalized', { status: String(result.status) }))
        await refreshStatus()
        setChapters(await ipcApi.request('novel.list_chapters'))
      } catch (err) {
        logger.error('Failed to finalize novel chapter', err as Error)
        toast.error(t('novel.review_finalize'))
        setError(String(err))
      } finally {
        setFinalizing(false)
      }
    },
    [selectedId, refreshStatus, t]
  )

  const renderReviewView = () => {
    if (!selectedId) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
          <ShieldCheck className="size-8 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">{t('novel.review_none_selected')}</p>
        </div>
      )
    }
    const passLabels: Record<string, string> = {
      'novel-consistency-reviewer': 'Consistency',
      'novel-foreshadow-reviewer': 'Foreshadow',
      'novel-style-reviewer': 'Style'
    }
    return (
      <div className="mx-auto max-w-3xl px-6 py-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="font-semibold text-lg">{t('novel.review_heading')}</h1>
          <span className="font-mono text-muted-foreground text-xs">{selectedId}</span>
          <div className="ml-auto flex items-center gap-2">
            {reviewModelId && (
              <span className="max-w-48 truncate font-mono text-muted-foreground text-xs" title={reviewModelId}>
                {t('novel.review_model')}: {reviewModelId}
              </span>
            )}
            <Button size="sm" onClick={() => void runReview()} disabled={reviewRunning || !reviewModelId}>
              <Play className="size-3.5" />
              {reviewRunning ? t('novel.review_running') : t('novel.review_run')}
            </Button>
          </div>
        </div>

        {reviewRunning && (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {!reviewRunning && reviewOutcome && (
          <div className="space-y-5">
            <section>
              <h2 className="mb-1.5 font-semibold text-sm">{t('novel.review_passes')}</h2>
              <div className="space-y-1.5">
                {reviewOutcome.passes.map((pass) => (
                  <div key={pass.reviewer} className="flex items-center gap-2 rounded-md border p-2.5 text-sm">
                    <span className="font-medium">{passLabels[pass.reviewer] ?? pass.reviewer}</span>
                    {pass.status === 'completed' ? (
                      <Badge variant="secondary">{t('novel.review_completed')}</Badge>
                    ) : (
                      <Badge variant="destructive">{t('novel.review_failed')}</Badge>
                    )}
                    <span className="text-muted-foreground text-xs">
                      {pass.findings.length} {t('novel.findings')}
                    </span>
                    {pass.error && <span className="ml-auto truncate text-error-foreground text-xs">{pass.error}</span>}
                  </div>
                ))}
              </div>
            </section>

            {reviewOutcome.gatePassed && reviewOutcome.recordFile && (
              <p className="text-primary text-xs">
                {t('novel.review_gate_passed')} — {reviewOutcome.recordFile}
              </p>
            )}
            {!reviewOutcome.gatePassed && reviewOutcome.gateError && (
              <p className="text-error-foreground text-xs">
                {t('novel.review_gate_failed')}: {reviewOutcome.gateError}
              </p>
            )}

            {reviewOutcome.passes.some((pass) => pass.findings.length > 0) && (
              <section>
                <h2 className="mb-1.5 font-semibold text-sm">{t('novel.review_findings')}</h2>
                <div className="space-y-1.5">
                  {reviewOutcome.passes
                    .flatMap((pass) => pass.findings)
                    .map((finding) => (
                      <div key={finding.id} className="rounded-md border p-2.5 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-muted-foreground">{finding.id}</span>
                          <Badge variant="outline">{finding.severity}</Badge>
                          <Badge variant="secondary">{finding.resolution}</Badge>
                          <span className="text-muted-foreground">{finding.reviewer}</span>
                        </div>
                        <p className="mt-1">{finding.summary}</p>
                        {finding.rationale && (
                          <p className="mt-1 text-muted-foreground/70 italic">{finding.rationale}</p>
                        )}
                      </div>
                    ))}
                </div>
              </section>
            )}

            {reviewOutcome.consistency && (
              <p className="text-muted-foreground text-xs">
                {t('novel.review_consistency')}: {reviewOutcome.consistency.slice(0, 120)}
              </p>
            )}
          </div>
        )}

        {!reviewRunning && !reviewOutcome && (
          <p className="text-muted-foreground text-sm">{t('novel.review_none_selected')}</p>
        )}

        <div className="mt-6 flex items-center gap-3 border-t pt-4">
          {finalizeResult && <span className="text-primary text-xs">{finalizeResult}</span>}
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void finalize('reviewed')}
              disabled={finalizing || reviewRunning}>
              {finalizing ? t('novel.review_finalizing') : t('novel.review_finalize')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void finalize('final')}
              disabled={finalizing || reviewRunning}>
              {finalizing ? t('novel.review_finalizing') : 'final'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const selectedSummary = useMemo(() => chapters.find((c) => c.id === selectedId) ?? null, [chapters, selectedId])
  const frontmatter = chapterRead?.frontmatter
  const proseUnit = frontmatter?.countUnit ?? 'words'
  const proseCount = chapterRead?.proseCount ?? sceneContext?.proseCount
  const targetChars = frontmatter?.targetChars
  const progress = useMemo(() => {
    if (proseCount === undefined || !targetChars) return null
    return Math.min(100, Math.round((proseCount / targetChars) * 100))
  }, [proseCount, targetChars])

  const renderSceneProse = (prose: string) =>
    prose.split('\n').map((line, i) => (
      <div key={i} className={line.trim() ? '' : 'h-2'}>
        {line}
      </div>
    ))

  /** Read-only state view: characters/world/foreshadow/timeline/pov as of a chapter. */
  const renderStateView = () => {
    const state = novelState
    return (
      <div className="mx-auto max-w-3xl px-6 py-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h1 className="font-semibold text-lg">{t('novel.state_heading')}</h1>
          {chapters.length > 1 && (
            <div className="ml-auto flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">{t('novel.state_as_of')}</span>
              <button
                type="button"
                onClick={() => setAsOfChapter(0)}
                className={`rounded border px-2 py-0.5 transition-colors ${
                  asOfChapter === 0 ? 'bg-accent font-medium' : 'hover:bg-accent'
                }`}>
                {t('novel.state_current')}
              </button>
              {chapters.map((chapter) => (
                <button
                  key={chapter.id}
                  type="button"
                  onClick={() => setAsOfChapter(chapter.chapter ?? 0)}
                  className={`rounded border px-2 py-0.5 font-mono transition-colors ${
                    asOfChapter === chapter.chapter ? 'bg-accent font-medium' : 'hover:bg-accent'
                  }`}>
                  c{String(chapter.chapter ?? 0).padStart(3, '0')}
                </button>
              ))}
            </div>
          )}
        </div>

        {stateLoading && !state ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : state && (state.characters.length > 0 || state.foreshadow.length > 0) ? (
          <div className="space-y-5">
            {state.world.name && (
              <section>
                <h2 className="mb-1.5 font-semibold text-sm">{t('novel.state_world')}</h2>
                <div className="rounded-md border p-3 text-sm">
                  <p className="font-medium">
                    {state.world.name}
                    {state.world.era ? ` (${state.world.era})` : ''}
                  </p>
                  {state.world.premise && <p className="mt-1 text-muted-foreground text-xs">{state.world.premise}</p>}
                  {state.world.rules && state.world.rules.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-4 text-muted-foreground text-xs">
                      {state.world.rules.map((rule, i) => (
                        <li key={i}>{rule}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            )}

            {state.characters.length > 0 && (
              <section>
                <h2 className="mb-1.5 font-semibold text-sm">{t('novel.state_characters')}</h2>
                <div className="space-y-2">
                  {state.characters.map((character) => (
                    <details
                      key={character.id}
                      className="rounded-md border p-3 text-sm"
                      open={state.characters.length <= 2}>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2 font-medium">
                        <span>{character.name}</span>
                        <span className="font-mono text-muted-foreground text-xs">{character.id}</span>
                        {character.current.status && <Badge variant="secondary">{character.current.status}</Badge>}
                      </summary>
                      <div className="mt-2 space-y-1.5 text-muted-foreground text-xs">
                        {character.current.location && <p>📍 {character.current.location}</p>}
                        {character.current.psychology && <p>{character.current.psychology}</p>}
                        {character.current.knowledge && character.current.knowledge.length > 0 && (
                          <ul className="list-disc space-y-0.5 pl-4">
                            {character.current.knowledge.map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                        )}
                        {character.current.inventory && character.current.inventory.length > 0 && (
                          <p>
                            <span className="font-medium">🎒</span> {character.current.inventory.join(' · ')}
                          </p>
                        )}
                        {character.current.relationships && Object.keys(character.current.relationships).length > 0 && (
                          <div>
                            <span className="font-medium">↔</span>{' '}
                            {Object.entries(character.current.relationships)
                              .map(([id, value]) => `${id}: ${value}`)
                              .join(' · ')}
                          </div>
                        )}
                        {character.current.notes && (
                          <p className="text-muted-foreground/70 italic">{character.current.notes}</p>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            )}

            {state.foreshadow.length > 0 && (
              <section>
                <h2 className="mb-1.5 font-semibold text-sm">{t('novel.state_foreshadow')}</h2>
                <div className="space-y-1.5">
                  {state.foreshadow.map((entry) => (
                    <div key={entry.id} className="rounded-md border p-3 text-xs">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          {entry.id}
                        </Badge>
                        {entry.planted_at && (
                          <span className="font-mono text-muted-foreground">planted {entry.planted_at}</span>
                        )}
                      </div>
                      {entry.description && <p className="mt-1.5">{entry.description}</p>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {state.timeline.length > 0 && (
              <section>
                <h2 className="mb-1.5 font-semibold text-sm">{t('novel.state_timeline')}</h2>
                <ul className="space-y-1 rounded-md border p-3 text-xs">
                  {state.timeline.map((event) => (
                    <li key={event.id} className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 font-mono text-muted-foreground">{event.chapter}</span>
                      <span>{event.description}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {state.pov && state.pov.viewpoint && (
              <section>
                <h2 className="mb-1.5 font-semibold text-sm">{t('novel.state_pov')}</h2>
                <div className="rounded-md border p-3 text-xs">
                  <p>
                    <span className="font-medium">{state.pov.viewpoint}</span>
                    {state.pov.tense ? ` · ${state.pov.tense}` : ''}
                  </p>
                  {state.pov.notes && <p className="mt-1 text-muted-foreground">{state.pov.notes}</p>}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
            <Flag className="size-8 text-muted-foreground" />
            <p className="max-w-md text-muted-foreground text-sm">{t('novel.state_none')}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div data-ui="novel.view" className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      {/* Workspace header */}
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <BookOpen className="size-4 shrink-0 text-primary" />
        <span className="truncate font-medium text-sm">{status ? status.path : t('novel.no_workspace')}</span>
        {status && status.specVersion && (
          <Badge variant="outline" className="shrink-0">
            spec v{status.specVersion}
          </Badge>
        )}
        <span className="flex-1" />
        {status ? (
          <Button variant="outline" size="sm" onClick={() => void closeWorkspace()}>
            <X className="size-3.5" />
            {t('novel.close_workspace')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => void openWorkspace()}>
            <FolderOpen className="size-3.5" />
            {t('novel.open_workspace')}
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="shrink-0 border-error-border border-b bg-error-subtle px-4 py-2 text-error-subtle-foreground text-xs">
          {error}
        </div>
      )}

      {!status ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <BookOpen className="size-10 text-muted-foreground" />
          <p className="max-w-md text-muted-foreground text-sm">{t('novel.empty_description')}</p>
          <Button onClick={() => void openWorkspace()}>
            <FolderOpen className="size-3.5" />
            {t('novel.open_workspace')}
          </Button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
          {/* Chapter list */}
          <aside className="w-64 shrink-0 overflow-y-auto border-r">
            {chapters.length === 0 && busy && (
              <div className="space-y-2 p-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            )}
            {chapters.map((chapter) => (
              <button
                key={chapter.id}
                type="button"
                onClick={() => void selectChapter(chapter.id)}
                className={`flex w-full flex-col gap-0.5 border-b px-3 py-2.5 text-left transition-colors hover:bg-accent ${
                  chapter.id === selectedId ? 'bg-accent' : ''
                }`}>
                <span className="flex items-center gap-2 font-medium text-sm">
                  <span className="font-mono text-muted-foreground text-xs">{chapter.id}</span>
                  {chapter.title && <span className="min-w-0 truncate">{chapter.title}</span>}
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
                  {chapter.status && <Badge variant="secondary">{chapter.status}</Badge>}
                  <span>
                    {chapter.proseCount ?? '–'}/{chapter.targetChars ?? '–'}
                  </span>
                  <span>
                    {chapter.sceneCount} {t('novel.scenes')}
                  </span>
                </span>
              </button>
            ))}
          </aside>

          {/* Detail */}
          <main className="flex min-w-0 flex-1 flex-col">
            {/* Tab bar */}
            <div className="flex shrink-0 items-center gap-1 border-b px-4 py-1.5 text-xs">
              <button
                type="button"
                onClick={() => setTab('chapter')}
                className={`rounded px-2 py-1 transition-colors ${tab === 'chapter' ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent'}`}>
                {t('novel.tab_chapter')}
              </button>
              <button
                type="button"
                onClick={() => setTab('state')}
                className={`rounded px-2 py-1 transition-colors ${tab === 'state' ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent'}`}>
                {t('novel.tab_state')}
              </button>
              <button
                type="button"
                onClick={() => setTab('review')}
                className={`rounded px-2 py-1 transition-colors ${tab === 'review' ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent'}`}>
                {t('novel.tab_review')}
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === 'state' ? (
                renderStateView()
              ) : tab === 'review' ? (
                renderReviewView()
              ) : !selectedSummary || !chapterRead ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                  <Flag className="size-8 text-muted-foreground" />
                  <p className="text-muted-foreground text-sm">{t('novel.select_chapter')}</p>
                </div>
              ) : (
                <div className="mx-auto max-w-3xl px-6 py-5">
                  {/* Chapter header */}
                  <div className="mb-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-muted-foreground text-xs">{selectedSummary.id}</span>
                      {frontmatter?.title && <h1 className="font-semibold text-lg">{frontmatter.title}</h1>}
                      {frontmatter?.status && <Badge variant="secondary">{frontmatter.status}</Badge>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs">
                      {proseCount !== undefined && (
                        <span>
                          {proseCount} {proseUnit === 'han_chars' ? t('novel.han_chars') : t('novel.words')}
                        </span>
                      )}
                      {targetChars !== undefined && (
                        <span>
                          {t('novel.target')} {targetChars}
                        </span>
                      )}
                      {progress !== null && (
                        <span>
                          {t('novel.progress')}: {progress}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Scene outline */}
                  {sceneContext && sceneContext.scenes.length > 0 && (
                    <div className="mb-5 space-y-2 rounded-md border bg-muted/30 p-3">
                      {sceneContext.scenes.map((scene) => (
                        <div key={scene.plan.id} className="flex items-start gap-2 text-sm">
                          <Badge variant="outline" className="mt-0.5 shrink-0 font-mono">
                            {scene.marker}
                          </Badge>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{scene.plan.type}</span>
                              {scene.plan.pov && (
                                <span className="text-muted-foreground text-xs">POV {scene.plan.pov}</span>
                              )}
                              {scene.plan.status && <Badge variant="secondary">{scene.plan.status}</Badge>}
                            </div>
                            {scene.plan.goal && <p className="text-muted-foreground text-xs">{scene.plan.goal}</p>}
                            <details className="mt-1">
                              <summary className="cursor-pointer text-primary text-xs">
                                {t('novel.scene_prose')} ({scene.prose.length})
                              </summary>
                              <div className="mt-1.5 rounded-md border bg-background p-3 font-mono text-xs leading-relaxed">
                                {renderSceneProse(scene.prose)}
                              </div>
                            </details>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Chapter body (read-only) */}
                  <article className="whitespace-pre-wrap text-sm leading-relaxed">{chapterRead.body}</article>

                  {/* Reviews */}
                  {reviews.length > 0 && (
                    <section className="mt-8 space-y-2 border-t pt-4">
                      <h2 className="font-semibold text-sm">{t('novel.reviews')}</h2>
                      {reviews.map((review) => (
                        <div key={review.file} className="rounded-md border p-3 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-muted-foreground">{review.file}</span>
                            {review.status && <Badge variant="outline">{review.status}</Badge>}
                            <span className="text-muted-foreground">
                              {review.reviewerCount} {t('novel.reviewers')} · {review.findingCount}{' '}
                              {t('novel.findings')}
                            </span>
                          </div>
                        </div>
                      ))}
                    </section>
                  )}
                </div>
              )}
            </div>
          </main>
        </div>
      )}
    </div>
  )
}

export default NovelPage
