import { Badge, Button, Skeleton } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { OutputFor } from '@shared/ipc/types'
import { BookOpen, Flag, FolderOpen, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('NovelPage')

type ChapterRead = OutputFor<'novel.read_chapter'>
type SceneContext = OutputFor<'novel.scene_context'>
type WorkspaceStatus = OutputFor<'novel.get_status'>
type ChapterSummary = OutputFor<'novel.list_chapters'>[number]

/** Read-only novel-spec workspace viewer. P1 panel: open a repo, list
 * chapters/scenes/reviews, preview a chapter. State writes stay behind the
 * engine (see VISION.md). */
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
      setError(null)
    } catch (err) {
      logger.error('Failed to close novel workspace', err as Error)
      toast.error(t('novel.close_failed'))
    }
  }, [t])

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
          <main className="min-w-0 flex-1 overflow-y-auto">
            {!selectedSummary || !chapterRead ? (
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
                            {review.reviewerCount} {t('novel.reviewers')} · {review.findingCount} {t('novel.findings')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </section>
                )}
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  )
}

export default NovelPage
