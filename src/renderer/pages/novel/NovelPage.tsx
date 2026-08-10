import { Badge, Button, Input, Skeleton } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { OutputFor } from '@shared/ipc/types'
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  FolderOpen,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Sparkles,
  Wand2
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('NovelPage')

type BookSummary = OutputFor<'novel.list_books'>[number]
type ChapterSummary = OutputFor<'novel.list_chapters'>['chapters'][number]
type ChapterDetail = OutputFor<'novel.get_chapter'>

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

/**
 * 中文友好的小说工作台：书架 → 书详情 → 章节读写 → AI 写作/审稿。
 * 数据来自 InkOS 引擎（经主进程 NovelService 转发）。
 */
function NovelPage() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

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
  const [actionBusy, setActionBusy] = useState(false)
  const [actionLabel, setActionLabel] = useState('')

  const refreshBooks = useCallback(async () => {
    setBooksLoading(true)
    try {
      setBooks(await ipcApi.request('novel.list_books'))
    } catch (err) {
      logger.error('Failed to list books', err as Error)
      toast.error(String(err))
    } finally {
      setBooksLoading(false)
    }
  }, [])

  const refreshChapters = useCallback(async (bookId: string) => {
    try {
      const { chapters: list } = await ipcApi.request('novel.list_chapters', { bookId })
      setChapters(list)
    } catch (err) {
      logger.error('Failed to list chapters', err as Error)
      toast.error(String(err))
    }
  }, [])

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
        toast.error(String(err))
      } finally {
        setLoading(false)
      }
    },
    [refreshChapters, t]
  )

  const selectChapter = useCallback(async (bookId: string, number: number) => {
    setSelectedChapter(number)
    setChapterDetail(null)
    try {
      setChapterDetail(await ipcApi.request('novel.get_chapter', { bookId, chapterNumber: number }))
    } catch (err) {
      logger.error('Failed to read chapter', err as Error)
      toast.error(String(err))
    }
  }, [])

  const backToShelf = useCallback(() => {
    setBook(null)
    setChapters([])
    setChapterDetail(null)
    setSelectedChapter(null)
    setActionBusy(false)
    setActionLabel('')
    void refreshBooks()
  }, [refreshBooks])

  // ── AI 动作（引擎 fire-and-forget；完成后刷新目录） ──
  const runAction = useCallback(
    async (kind: 'write_next' | 'audit' | 'revise', chapterNumber?: number) => {
      if (!book) return
      setActionBusy(true)
      setActionLabel(kind)
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
        } else {
          await ipcApi.request('novel.revise_chapter', {
            bookId: book.id,
            chapterNumber: chapterNumber ?? 1
          })
        }
        // 引擎异步写作/修订完成后刷新目录与章节
        await refreshChapters(book.id)
        if (book) void openBook(book.id)
      } catch (err) {
        logger.error('AI run failed', err as Error)
        toast.error(String(err))
      } finally {
        setActionBusy(false)
        setActionLabel('')
      }
    },
    [book, refreshChapters, openBook, t]
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
        toast.error(String(err))
      }
    },
    [book, refreshChapters, t]
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
        toast.error(String(err))
      }
    },
    [book, refreshChapters, t]
  )

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
      toast.error(String(err))
    }
  }, [refreshBooks])

  // ── 初始化：一键生成示例工作区（首次使用） ──
  const initWorkspace = useCallback(async () => {
    setLoading(true)
    try {
      await ipcApi.request('novel.init_workspace')
      setOpen(true)
      await refreshBooks()
    } catch (err) {
      logger.error('Failed to init workspace', err as Error)
      toast.error(String(err))
    } finally {
      setLoading(false)
    }
  }, [refreshBooks])

  // ── 首次挂载：自动打开上次工作区 ──
  useEffect(() => {
    void (async () => {
      try {
        const status = await ipcApi.request('novel.get_status')
        if (status) {
          setOpen(true)
          await refreshBooks()
        }
      } catch {
        // 未打开工作区 — 显示空状态
      }
    })()
  }, [refreshBooks])

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
      toast.error(String(err))
    } finally {
      setCreating(false)
    }
  }, [createTitle, createGenre, createTargetChapters, createWordCount, refreshBooks, openBook, t])

  const renderShelf = useMemo(
    () => (
      <div className="flex flex-col gap-4">
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
          <Button onClick={() => void runAction('write_next')} disabled={actionBusy}>
            {actionBusy && actionLabel === 'write_next' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {t('novel.write_next')}
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
              <Button
                variant="outline"
                className="w-full"
                onClick={() => void runAction('write_next')}
                disabled={actionBusy}>
                <PenLine className="size-4" /> {t('novel.write_next')}
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void runAction('audit', selectedMeta.number)}
                    disabled={actionBusy}>
                    {t('novel.run_audit')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void runAction('revise', selectedMeta.number)}
                    disabled={actionBusy}>
                    {t('novel.run_revise')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void approveChapter(selectedMeta.number)}
                    disabled={actionBusy}>
                    {t('novel.approve')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void rejectChapter(selectedMeta.number)}
                    disabled={actionBusy}>
                    {t('novel.reject')}
                  </Button>
                </div>
                <div className="whitespace-pre-wrap font-serif text-[15px] leading-7">{chapterDetail.content}</div>
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
    actionBusy,
    actionLabel,
    runAction,
    approveChapter,
    rejectChapter,
    backToShelf,
    selectChapter,
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
