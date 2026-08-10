// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { OutputFor } from '@shared/ipc/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  selectFolder: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => mocks.request(...args) }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const projectStatus: OutputFor<'novel.get_status'> = {
  name: '测试项目',
  language: 'zh',
  languageExplicit: true,
  model: 'noop-model',
  provider: 'openai'
}

const books: OutputFor<'novel.list_books'> = [
  {
    id: 'demo',
    title: '灯塔守夜人',
    status: 'active',
    platform: 'other',
    genre: '都市',
    targetChapters: 100,
    chapters: 3,
    chapterCount: 3,
    lastChapterNumber: 3,
    totalWords: 6200,
    approvedChapters: 2,
    pendingReview: 1,
    pendingReviewChapters: 1,
    failedReview: 0,
    failedChapters: 0,
    updatedAt: '2026-08-10T00:00:00Z',
    chaptersWritten: 3
  }
]

const chapters: OutputFor<'novel.list_chapters'>['chapters'] = [
  {
    number: 1,
    title: '第一章 风暴',
    status: 'approved',
    wordCount: 2100,
    auditIssueCount: 0,
    updatedAt: '2026-08-01T00:00:00Z',
    fileName: '1_风暴.md',
    createdAt: '2026-08-01T00:00:00Z'
  },
  {
    number: 2,
    title: '第二章 灯',
    status: 'approved',
    wordCount: 1900,
    auditIssueCount: 0,
    updatedAt: '2026-08-02T00:00:00Z',
    fileName: '2_灯.md',
    createdAt: '2026-08-02T00:00:00Z'
  },
  {
    number: 3,
    title: '第三章 潮汐',
    status: 'ready-for-review',
    wordCount: 2200,
    auditIssueCount: 1,
    updatedAt: '2026-08-03T00:00:00Z',
    fileName: '3_潮汐.md',
    createdAt: '2026-08-03T00:00:00Z'
  }
]

const chapterDetail: OutputFor<'novel.get_chapter'> = {
  chapterNumber: 3,
  filename: '3_潮汐.md',
  content: '潮水退去，露出礁石下的铁锚。\n\n他站在灯塔顶端，望向海平面。'
}

import NovelPage from '../NovelPage'

beforeEach(() => {
  Object.assign(window.api, { file: { selectFolder: mocks.selectFolder } })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NovelPage', () => {
  it('shows the shelf with books and opens a book', async () => {
    mocks.request.mockImplementation(async (route: string, input?: any) => {
      if (route === 'novel.get_status') return projectStatus
      if (route === 'novel.list_books') return books
      if (route === 'novel.get_book') return books.find((b) => b.id === input.bookId) ?? null
      if (route === 'novel.list_chapters') return { chapters, chapterCount: 3 }
      if (route === 'novel.get_chapter') return chapterDetail
      return null
    })

    render(<NovelPage />)

    // Shelf with book card.
    expect(await screen.findByText('novel.shelf_heading')).toBeInTheDocument()
    expect(screen.getByText('灯塔守夜人')).toBeInTheDocument()

    // Open the book.
    fireEvent.click(screen.getByText('灯塔守夜人'))
    expect(await screen.findByText('novel.toc_heading')).toBeInTheDocument()
    expect(screen.getByText('第一章 风暴')).toBeInTheDocument()

    // Select a chapter and read it.
    fireEvent.click(screen.getByText('第三章 潮汐'))
    expect(await screen.findByText(/潮水退去/)).toBeInTheDocument()
  })

  it('creates a book via the wizard, waits for ready, and opens it', async () => {
    mocks.request.mockImplementation(async (route: string, input?: any) => {
      if (route === 'novel.get_status') return projectStatus
      if (route === 'novel.list_books') return books
      if (route === 'novel.create_book') return { id: 'new-book' }
      if (route === 'novel.create_status') return { status: 'ready' }
      if (route === 'novel.get_book') return books.find((b) => b.id === input.bookId) ?? books[0]
      if (route === 'novel.list_chapters') return { chapters, chapterCount: 3 }
      return null
    })

    render(<NovelPage />)
    await screen.findByText('novel.shelf_heading')

    fireEvent.change(screen.getByPlaceholderText('novel.create_title_placeholder'), {
      target: { value: '新书' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'novel.create_button' }))

    await waitFor(() => {
      const calls = mocks.request.mock.calls.filter(([route]) => route === 'novel.create_book')
      expect(calls).toHaveLength(1)
      expect(calls[0][1]).toMatchObject({ title: '新书', language: 'zh' })
    })
    await waitFor(() => {
      const calls = mocks.request.mock.calls.filter(([route]) => route === 'novel.create_status')
      expect(calls).toHaveLength(1)
      expect(calls[0][1]).toEqual({ bookId: 'new-book' })
    })
  })

  it('triggers write-next and refreshes the chapter list', async () => {
    mocks.request.mockImplementation(async (route: string, input?: any) => {
      if (route === 'novel.get_status') return projectStatus
      if (route === 'novel.list_books') return books
      if (route === 'novel.get_book') return books.find((b) => b.id === input.bookId) ?? null
      if (route === 'novel.list_chapters') return { chapters, chapterCount: 3 }
      return null
    })

    render(<NovelPage />)
    await screen.findByText('novel.shelf_heading')
    fireEvent.click(screen.getByText('灯塔守夜人'))
    await screen.findByText('novel.toc_heading')

    // Two write-next buttons (header + toc) — use the header one.
    fireEvent.click(screen.getAllByRole('button', { name: 'novel.write_next' })[0])

    await waitFor(() => {
      const calls = mocks.request.mock.calls.filter(([route]) => route === 'novel.write_next')
      expect(calls).toHaveLength(1)
      expect(calls[0][1]).toEqual({ bookId: 'demo' })
    })
  })

  it('opens a workspace via folder picker when no workspace is open', async () => {
    mocks.request.mockImplementation(async (route: string, input?: any) => {
      if (route === 'novel.get_status') return null
      if (route === 'novel.open_workspace') return input.root
      if (route === 'novel.list_books') return []
      return null
    })
    mocks.selectFolder.mockResolvedValue('D:/novel/我的小说')

    render(<NovelPage />)

    // Empty state first.
    expect(await screen.findByText('novel.empty_heading')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'novel.open_workspace' }))

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith('novel.open_workspace', { root: 'D:/novel/我的小说' })
    })
    expect(await screen.findByText('novel.shelf_heading')).toBeInTheDocument()
  })
})
