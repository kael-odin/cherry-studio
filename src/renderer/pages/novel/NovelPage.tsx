import { Badge, Button, Input, Skeleton, Textarea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { EventPayload, OutputFor } from '@shared/ipc/types'
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  FolderOpen,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Wand2
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('NovelPage')

type BookSummary = OutputFor<'novel.list_books'>[number]
type ChapterSummary = OutputFor<'novel.list_chapters'>['chapters'][number]
type ChapterDetail = OutputFor<'novel.get_chapter'>

/** IpcError code（主进程映射的引擎错误码）→ i18n key。 */
const KNOWN_ERROR_KEYS: Record<string, string> = {
  'novel.error_llm_config': 'novel.error_llm_config'
}

/** 章节目录状态 → 中文徽章/颜色映射. */
type BadgeTone = 'default' | 'secondary' | 'destructive' | 'outline'
const STATUS_STYLE: Record<string, { label: string; tone: BadgeTone }> = {
  outlining: { label: 'novel.status_outlining', tone: 'secondary' },
  planned: { label: 'novel.status_planned', tone: 'secondary' },
  drafting: { label: 'novel.status_drafting', tone: 'default' },
  draft: { label: 'novel.status_draft', tone: 'default' },
  drafted: { label: 'novel.status_draft', tone: 'default' },
  auditing: { label: 'novel.status_reviewing', tone: 'default' },
  'audit-passed': { label: 'novel.status_audit_passed', tone: 'default' },
  'audit-failed': { label: 'novel.status_audit_failed', tone: 'destructive' },
  revising: { label: 'novel.status_reviewing_revision', tone: 'default' },
  'ready-for-review': { label: 'novel.status_pending_review', tone: 'default' },
  approved: { label: 'novel.status_approved', tone: 'default' },
  rejected: { label: 'novel.status_rejected', tone: 'destructive' },
  published: { label: 'novel.status_published', tone: 'default' }
}

function statusOf(status: string | undefined): { label: string; tone: BadgeTone } {
  return (status && STATUS_STYLE[status]) || { label: status ?? 'novel.status_unknown', tone: 'secondary' }
}

/** 运行中的动作 → 进度文案 i18n key。 */
const RUNNING_LABELS: Record<string, string> = {
  write: 'novel.action_running_write',
  draft: 'novel.action_running_draft',
  audit: 'novel.action_running_audit',
  revise: 'novel.action_running_revise',
  rewrite: 'novel.action_running_rewrite'
}

/**
 * 中文友好的小说工作台：书架 → 书详情 → 章节读写 → AI 写作/审稿。
 * 数据来自 InkOS 引擎（经主进程 NovelService 转发）。
 */
function NovelPage() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  /** 已知引擎错误码 → 中文提示；未知错误回退原文。 */
  const tError = useCallback(
    (err: unknown): string => {
      if (err instanceof IpcError && KNOWN_ERROR_KEYS[err.code]) {
        return t(KNOWN_ERROR_KEYS[err.code])
      }
      return err instanceof Error ? err.message : String(err)
    },
    [t]
  )

  // ── 书架 ──
  const [books, setBooks] = useState<BookSummary[]>([])
  const [booksLoading, setBooksLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createGenre, setCreateGenre] = useState('')
  const [createTargetChapters, setCreateTargetChapters] = useState('200')
  const [createWordCount, setCreateWordCount] = useState('2000')

  // ── 书详情 ──
  const [book, setBook] = useState<BookSummary | null>(null)
  const [chapters, setChapters] = useState<ChapterSummary[]>([])
  const [chapterDetail, setChapterDetail] = useState<ChapterDetail | null>(null)
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null)

  // ── 引擎实时进度（SSE 事件驱动：bookId → 运行中的动作） ──
  const [activeRuns, setActiveRuns] = useState<Record<string, string>>({})
  const busy = book ? activeRuns[book.id] !== undefined : false
  const actionLabel = book ? (activeRuns[book.id] ?? '') : ''

  // ── 手写编辑 ──
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)

  // ── 引擎错误横幅 ──
  const [engineError, setEngineError] = useState<{ code: string; message: string } | null>(null)

  // ── 项目状态（新手引导：LLM 是否可用） ──
  const [project, setProject] = useState<OutputFor<'novel.get_status'>>(null)
  const llmUnconfigured = project !== null && (project.model === '' || project.model === 'noop-model')

  const refreshBooks = useCallback(async () => {
    setBooksLoading(true)
    try {
      setBooks(await ipcApi.request('novel.list_books'))
    } catch (err) {
      logger.error('Failed to list books', err as Error)
      toast.error(tError(err))
    } finally {
      setBooksLoading(false)
    }
  }, [tError])

  const refreshChapters = useCallback(
    async (bookId: string) => {
      try {
        const { chapters: list } = await ipcApi.request('novel.list_chapters', { bookId })
        setChapters(list)
      } catch (err) {
        logger.error('Failed to list chapters', err as Error)
        toast.error(tError(err))
      }
    },
    [tError]
  )

  const openBook = useCallback(
    async (id: string) => {
      setLoading(true)
      try {
        const detail = await ipcApi.request('novel.get_book', { bookId: id })
        if (!detail) {
          toast.error(t('novel.book_missing'))
          return
        }
        setBook(detail)
        await refreshChapters(id)
      } catch (err) {
        logger.error('Failed to open book', err as Error)
        toast.error(tError(err))
      } finally {
        setLoading(false)
      }
    },
    [refreshChapters, t, tError]
  )

  const selectChapter = useCallback(
    async (bookId: string, number: number) => {
      setSelectedChapter(number)
      setChapterDetail(null)
      setEditing(false)
      setEditContent('')
      try {
        setChapterDetail(await ipcApi.request('novel.get_chapter', { bookId, chapterNumber: number }))
      } catch (err) {
        logger.error('Failed to read chapter', err as Error)
        toast.error(tError(err))
      }
    },
    [tError]
  )

  const backToShelf = useCallback(() => {
    setBook(null)
    setChapters([])
    setChapterDetail(null)
    setSelectedChapter(null)
    setEditing(false)
    setEditContent('')
    void refreshBooks()
  }, [refreshBooks])

  // ── 引擎 SSE 事件 → 实时进度/完成刷新 ──
  useIpcOn('novel.engine_event', (payload: EventPayload<'novel.engine_event'>) => {
    const data = payload.data as { bookId?: string } | null
    if (!data?.bookId) return
    const bookId = data.bookId
    const event = payload.event

    // 动作开始 → 进入进行中状态（write/draft 是 fire-and-forget，这是可靠进度源）
    const startMatch = /^(write|draft|audit|revise|rewrite):start$/.exec(event)
    if (startMatch) {
      setActiveRuns((prev) => ({ ...prev, [bookId]: startMatch[1] }))
      return
    }

    // 动作结束 → 清除进行中状态；若当前正在看这本书则刷新目录
    const endMatch = /^(write|draft|audit|revise|rewrite|book):(complete|error)$/.exec(event)
    if (endMatch) {
      const kind = endMatch[1]
      setActiveRuns((prev) => {
        const next = { ...prev }
        delete next[bookId]
        return next
      })
      if (book && book.id === bookId) {
        void refreshChapters(bookId)
      }
      if (kind === 'write' && event === 'write:complete') {
        toast.success(t('novel.action_succeeded'))
      } else if (event === 'book:error') {
        toast.error((data as { error?: string }).error ?? t('novel.action_failed'))
      } else if (event.endsWith(':error')) {
        toast.error(t('novel.action_failed'))
      }
      void refreshBooks()
      return
    }
  })

  // ── AI 动作（write-next fire-and-forget；audit/revise 阻塞至完成） ──
  const runAction = useCallback(
    async (kind: 'write_next' | 'audit' | 'revise', chapterNumber?: number) => {
      if (!book) return
      try {
        if (kind === 'write_next') {
          await ipcApi.request('novel.write_next', { bookId: book.id })
        } else if (kind === 'audit') {
          const result = await ipcApi.request('novel.audit_chapter', {
            bookId: book.id,
            chapterNumber: chapterNumber ?? 1
          })
          if (result.passed === false) {
            toast.error(t('novel.run_failed'))
          } else if (result.passed === true) {
            toast.success(t('novel.run_succeeded'))
          }
          await refreshChapters(book.id)
        } else {
          await ipcApi.request('novel.revise_chapter', {
            bookId: book.id,
            chapterNumber: chapterNumber ?? 1
          })
          await refreshChapters(book.id)
        }
      } catch (err) {
        logger.error('AI run failed', err as Error)
        toast.error(tError(err))
      }
    },
    [book, refreshChapters, t, tError]
  )

  const approveChapter = useCallback(
    async (number: number) => {
      if (!book) return
      try {
        await ipcApi.request('novel.approve_chapter', { bookId: book.id, chapterNumber: number })
        toast.success(t('novel.run_succeeded'))
        await refreshChapters(book.id)
      } catch (err) {
        logger.error('Failed to approve chapter', err as Error)
        toast.error(tError(err))
      }
    },
    [book, refreshChapters, t, tError]
  )

  const rejectChapter = useCallback(
    async (number: number) => {
      if (!book) return
      try {
        await ipcApi.request('novel.reject_chapter', { bookId: book.id, chapterNumber: number })
        toast.success(t('novel.run_succeeded'))
        await refreshChapters(book.id)
      } catch (err) {
        logger.error('Failed to reject chapter', err as Error)
        toast.error(tError(err))
      }
    },
    [book, refreshChapters, t, tError]
  )

  // ── 手写编辑 ──
  const startEditing = useCallback((detail: ChapterDetail) => {
    setEditContent(detail.content)
    setEditing(true)
  }, [])

  const cancelEditing = useCallback(() => {
    setEditing(false)
    setEditContent('')
  }, [])

  const saveEdit = useCallback(async () => {
    if (!book || selectedChapter === null) return
    setSaving(true)
    try {
      await ipcApi.request('novel.save_chapter', {
        bookId: book.id,
        chapterNumber: selectedChapter,
        content: editContent
      })
      toast.success(t('novel.save_succeeded'))
      setEditing(false)
      setEditContent('')
      // 引擎跑 edit transaction + 版本；刷新目录与正文
      await refreshChapters(book.id)
      setChapterDetail(await ipcApi.request('novel.get_chapter', { bookId: book.id, chapterNumber: selectedChapter }))
    } catch (err) {
      logger.error('Failed to save chapter', err as Error)
      toast.error(t('novel.save_failed'))
    } finally {
      setSaving(false)
    }
  }, [book, selectedChapter, editContent, refreshChapters, t])

  // ── 初始化：打开工作区 ──
  const openWorkspace = useCallback(async () => {
    try {
      const folder = await window.api.file.selectFolder()
      if (!folder) return
      setLoading(true)
      try {
        await ipcApi.request('novel.open_workspace', { root: folder })
        setOpen(true)
        await refreshBooks()
      } finally {
        setLoading(false)
      }
    } catch (err) {
      logger.error('Failed to open workspace', err as Error)
      toast.error(tError(err))
    }
  }, [refreshBooks, tError])

  // ── 初始化：一键生成示例工作区（首次使用） ──
  const initWorkspace = useCallback(async () => {
    setLoading(true)
    try {
      await ipcApi.request('novel.init_workspace')
      setOpen(true)
      await refreshBooks()
    } catch (err) {
      logger.error('Failed to init workspace', err as Error)
      toast.error(tError(err))
    } finally {
      setLoading(false)
    }
  }, [refreshBooks, tError])

  // ── 首次挂载：自动打开上次工作区 ──
  useEffect(() => {
    void (async () => {
      try {
        const status = await ipcApi.request('novel.get_status')
        if (status) {
          setOpen(true)
          setProject(status)
          await refreshBooks()
        }
      } catch {
        // 未打开工作区 — 显示空状态
      }
    })()
  }, [refreshBooks])

  // ── 引擎错误横幅（主进程记录的最后一次引擎错误） ──
  useEffect(() => {
    let disposed = false
    const poll = async () => {
      if (disposed) return
      try {
        setEngineError(await ipcApi.request('novel.engine_error'))
      } catch {
        // 引擎错误查询失败 — 忽略
      }
    }
    const timer = setInterval(() => void poll(), 5_000)
    void poll()
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [])

  // ── 创建书（引擎异步构建设定，轮询 create-status） ──
  const createBook = useCallback(async () => {
    if (!createTitle.trim()) {
      toast.error(t('novel.create_title_required'))
      return
    }
    setCreating(true)
    try {
      const result = await ipcApi.request('novel.create_book', {
        title: createTitle.trim(),
        genre: createGenre.trim() || '都市',
        language: 'zh',
        targetChapters: Math.max(1, Number(createTargetChapters) || 200),
        chapterWordCount: Math.max(100, Number(createWordCount) || 2000)
      })
      toast.success(t('novel.create_succeeded'))
      setCreateTitle('')
      setCreateGenre('')
      await refreshBooks()
      // 引擎的建书跑在后台（AI architect）；轮询直至 ready 再打开
      const deadline = Date.now() + 120_000
      let status = await ipcApi.request('novel.create_status', { bookId: result.id })
      while (status.status === 'creating' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3_000))
        status = await ipcApi.request('novel.create_status', { bookId: result.id })
      }
      if (status.status === 'error' || status.status === 'missing') {
        toast.error(status.error ?? t('novel.create_failed'))
      } else {
        await refreshBooks()
        await openBook(result.id)
      }
    } catch (err) {
      logger.error('Failed to create book', err as Error)
      toast.error(tError(err))
    } finally {
      setCreating(false)
    }
  }, [createTitle, createGenre, createTargetChapters, createWordCount, refreshBooks, openBook, t, tError])

  const renderShelf = useMemo(
    () => (
      <div className="flex flex-col gap-4">
        {engineError ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-2 text-destructive text-sm">
            <span>
              {t('novel.engine_error_title')}（{engineError.code}）
            </span>
            <Button variant="outline" size="sm" onClick={() => void refreshBooks()}>
              {t('novel.engine_error_retry')}
            </Button>
          </div>
        ) : null}
        <div className="flex items-center justify-between">
          <h1 className="font-semibold text-xl">{t('novel.shelf_heading')}</h1>
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" onClick={() => void refreshBooks()} aria-label={t('novel.refresh')}>
              <RefreshCw className="size-4" />
            </Button>
            <Button onClick={openWorkspace}>
              <FolderOpen className="size-4" /> {t('novel.open_workspace')}
            </Button>
          </div>
        </div>

        {/* 新手引导：LLM 未配置时提示 */}
        {llmUnconfigured ? (
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <Sparkles className="size-4 text-primary" /> {t('novel.llm_hint_title')}
            </div>
            <p className="text-muted-foreground text-sm">{t('novel.llm_hint_description')}</p>
          </div>
        ) : null}

        {booksLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : books.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed py-16 text-center">
            <BookOpen className="size-12 text-muted-foreground" />
            <div className="text-muted-foreground">{t('novel.shelf_empty')}</div>
            <div className="flex gap-2">
              <Button onClick={() => void initWorkspace()}>
                <Sparkles className="size-4" /> {t('novel.init_workspace')}
              </Button>
              <Button variant="outline" onClick={openWorkspace}>
                <FolderOpen className="size-4" /> {t('novel.open_workspace')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {books.map((b) => (
              <button
                key={b.id}
                type="button"
                className="group flex cursor-pointer flex-col gap-2 rounded-2xl border p-4 text-left transition hover:border-primary hover:shadow-sm"
                onClick={() => void openBook(b.id)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="line-clamp-2 font-semibold">{b.title}</div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition group-hover:text-primary" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary">{b.platform || b.genre}</Badge>
                  <Badge variant="secondary">{b.genre}</Badge>
                  <Badge variant="secondary">{b.chaptersWritten} 章</Badge>
                </div>
                <div className="text-muted-foreground text-xs">
                  {t('novel.chapter_progress', {
                    written: b.chaptersWritten,
                    target: b.targetChapters
                  })}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* 新建小说向导 */}
        <div className="rounded-2xl border p-4">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <Wand2 className="size-4" /> {t('novel.create_heading')}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-muted-foreground text-xs">{t('novel.create_title')}</label>
              <Input
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder={t('novel.create_title_placeholder')}
              />
            </div>
            <div>
              <label className="mb-1 block text-muted-foreground text-xs">{t('novel.create_genre')}</label>
              <Input
                value={createGenre}
                onChange={(e) => setCreateGenre(e.target.value)}
                placeholder={t('novel.create_genre_placeholder')}
              />
            </div>
            <div>
              <label className="mb-1 block text-muted-foreground text-xs">{t('novel.create_chapters')}</label>
              <Input
                type="number"
                value={createTargetChapters}
                onChange={(e) => setCreateTargetChapters(e.target.value)}
                min={1}
              />
            </div>
            <div>
              <label className="mb-1 block text-muted-foreground text-xs">{t('novel.create_wordcount')}</label>
              <Input
                type="number"
                value={createWordCount}
                onChange={(e) => setCreateWordCount(e.target.value)}
                min={100}
              />
            </div>
          </div>
          <Button className="mt-3" onClick={() => void createBook()} disabled={creating}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {t('novel.create_button')}
          </Button>
          <p className="mt-2 text-muted-foreground text-xs">{t('novel.create_hint')}</p>
        </div>
      </div>
    ),
    [
      books,
      booksLoading,
      engineError,
      llmUnconfigured,
      openWorkspace,
      initWorkspace,
      refreshBooks,
      openBook,
      creating,
      createBook,
      createTitle,
      createGenre,
      createTargetChapters,
      createWordCount,
      t
    ]
  )

  const renderBook = useMemo(() => {
    if (!book) return null
    const selectedMeta = chapters.find((c) => c.number === selectedChapter) ?? null
    return (
      <div className="flex flex-col gap-4">
        {engineError ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-2 text-destructive text-sm">
            <span>
              {t('novel.engine_error_title')}（{engineError.code}）
            </span>
            <Button variant="outline" size="sm" onClick={() => void refreshChapters(book.id)} disabled={busy}>
              {t('novel.engine_error_retry')}
            </Button>
          </div>
        ) : null}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={backToShelf} aria-label={t('novel.back')}>
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex-1">
            <h1 className="font-semibold text-xl">{book.title}</h1>
            <div className="flex flex-wrap gap-1.5 text-muted-foreground text-xs">
              <Badge variant="secondary">{book.platform || book.genre}</Badge>
              <Badge variant="secondary">{book.genre}</Badge>
              <Badge variant="secondary">
                {t('novel.chapter_progress', {
                  written: book.chaptersWritten,
                  target: book.targetChapters
                })}
              </Badge>
            </div>
          </div>
          <Button onClick={() => void runAction('write_next')} disabled={busy}>
            {busy && actionLabel === 'write' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {busy && actionLabel === 'write' ? t(RUNNING_LABELS[actionLabel]) : t('novel.write_next')}
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          {/* 目录 */}
          <div className="rounded-2xl border p-2">
            <div className="mb-1 flex items-center justify-between px-2 py-1 text-muted-foreground text-xs">
              <span>{t('novel.toc_heading')}</span>
              <span>{chapters.length} 章</span>
            </div>
            {chapters.length === 0 ? (
              <div className="px-2 py-6 text-center text-muted-foreground text-sm">{t('novel.toc_empty')}</div>
            ) : (
              chapters.map((c) => {
                const st = statusOf(c.status)
                return (
                  <button
                    key={c.number}
                    type="button"
                    className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-accent ${
                      selectedChapter === c.number ? 'bg-accent' : ''
                    }`}
                    onClick={() => void selectChapter(book.id, c.number)}>
                    <span className="truncate">
                      <span className="text-muted-foreground">#{c.number}</span>{' '}
                      <span className="font-medium">{c.title}</span>
                    </span>
                    <Badge variant={st.tone} className="shrink-0">
                      {t(st.label)}
                    </Badge>
                  </button>
                )
              })
            )}
            <div className="mt-2 border-t pt-2">
              <Button variant="outline" className="w-full" onClick={() => void runAction('write_next')} disabled={busy}>
                {busy && actionLabel === 'write' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <PenLine className="size-4" />
                )}{' '}
                {busy && actionLabel === 'write' ? t(RUNNING_LABELS[actionLabel]) : t('novel.write_next')}
              </Button>
            </div>
          </div>

          {/* 章节阅读 */}
          <div className="rounded-2xl border p-6">
            {!chapterDetail || !selectedMeta ? (
              <div className="py-16 text-center text-muted-foreground">{t('novel.select_chapter_hint')}</div>
            ) : (
              <div className="prose prose-sm max-w-none">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h2 className="font-semibold text-lg">
                    #{selectedMeta.number} {selectedMeta.title}
                  </h2>
                  <Badge variant={statusOf(selectedMeta.status).tone}>{t(statusOf(selectedMeta.status).label)}</Badge>
                </div>
                <div className="mb-3 flex flex-wrap gap-2">
                  {editing ? (
                    <>
                      <Button variant="default" size="sm" onClick={() => void saveEdit()} disabled={saving || busy}>
                        {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                        {t('novel.save')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={cancelEditing} disabled={saving}>
                        {t('novel.cancel')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" size="sm" onClick={() => startEditing(chapterDetail)} disabled={busy}>
                        <PenLine className="size-4" /> {t('novel.edit')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void runAction('audit', selectedMeta.number)}
                        disabled={busy}>
                        {busy && actionLabel === 'audit' ? <Loader2 className="size-4 animate-spin" /> : null}
                        {busy && actionLabel === 'audit' ? t(RUNNING_LABELS[actionLabel]) : t('novel.run_audit')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void runAction('revise', selectedMeta.number)}
                        disabled={busy}>
                        {busy && actionLabel === 'revise' ? <Loader2 className="size-4 animate-spin" /> : null}
                        {busy && actionLabel === 'revise' ? t(RUNNING_LABELS[actionLabel]) : t('novel.run_revise')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void approveChapter(selectedMeta.number)}
                        disabled={busy}>
                        {t('novel.approve')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void rejectChapter(selectedMeta.number)}
                        disabled={busy}>
                        {t('novel.reject')}
                      </Button>
                    </>
                  )}
                </div>
                {editing ? (
                  <Textarea.Input
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="min-h-[480px] w-full font-serif text-[15px] leading-7"
                    aria-label={t('novel.edit')}
                  />
                ) : (
                  <div className="whitespace-pre-wrap font-serif text-[15px] leading-7">{chapterDetail.content}</div>
                )}
                {/* 审稿反馈：auditIssues / reviewNote / lengthWarnings */}
                {!editing && (
                  <div className="mt-6 flex flex-col gap-2 border-t pt-4">
                    {selectedMeta.reviewNote ? (
                      <div className="rounded-lg bg-accent/50 px-3 py-2 text-sm">
                        <span className="font-medium text-muted-foreground">{t('novel.review_note')}：</span>
                        {selectedMeta.reviewNote}
                      </div>
                    ) : null}
                    {selectedMeta.auditIssues && selectedMeta.auditIssues.length > 0 ? (
                      <div className="flex flex-col gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm">
                        <span className="font-medium">{t('novel.audit_issues')}</span>
                        <ul className="list-inside list-disc">
                          {selectedMeta.auditIssues.map((issue, i) => (
                            <li key={i}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {selectedMeta.lengthWarnings && selectedMeta.lengthWarnings.length > 0 ? (
                      <div className="flex flex-col gap-1 rounded-lg bg-accent/50 px-3 py-2 text-sm">
                        <span className="font-medium text-muted-foreground">{t('novel.length_warnings')}</span>
                        <ul className="list-inside list-disc">
                          {selectedMeta.lengthWarnings.map((warn, i) => (
                            <li key={i}>{warn}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }, [
    book,
    chapters,
    chapterDetail,
    selectedChapter,
    busy,
    actionLabel,
    engineError,
    editing,
    editContent,
    saving,
    runAction,
    approveChapter,
    rejectChapter,
    backToShelf,
    selectChapter,
    refreshChapters,
    saveEdit,
    startEditing,
    cancelEditing,
    t
  ])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!open) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <BookOpen className="size-12 text-muted-foreground" />
        <div className="font-medium text-lg">{t('novel.empty_heading')}</div>
        <div className="max-w-md text-center text-muted-foreground text-sm">{t('novel.empty_description')}</div>
        <Button onClick={() => void initWorkspace()}>
          <Sparkles className="size-4" /> {t('novel.init_workspace')}
        </Button>
        <Button variant="outline" onClick={openWorkspace}>
          <FolderOpen className="size-4" /> {t('novel.open_workspace')}
        </Button>
      </div>
    )
  }

  return <div className="h-full overflow-y-auto p-6">{book ? renderBook : renderShelf}</div>
}

export default NovelPage
