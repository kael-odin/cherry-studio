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
  provider: 'openai',
  baseUrl: 'https://example.invalid/v1'
}

const books: OutputFor<'novel.list_books'> = [
  {
    id: 'demo',
    title: '灯塔守夜人',
    status: 'active',
    platform: 'other',
    genre: '都市',
    targetChapters: 100,
    chapterWordCount: 2000,
    language: 'zh',
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    chaptersWritten: 3
  }
]

const chapters: OutputFor<'novel.list_chapters'>['chapters'] = [
  {
    number: 1,
    title: '第一章 风暴',
    status: 'approved',
    wordCount: 2100,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z'
  },
  {
    number: 2,
    title: '第二章 灯',
    status: 'approved',
    wordCount: 1900,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z'
  },
  {
    number: 3,
    title: '第三章 潮汐',
    status: 'ready-for-review',
    wordCount: 2200,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    auditIssues: ['时间线不一致'],
    reviewNote: '待修：退潮时间需与开头统一'
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

  it('edits and saves a chapter via the engine', async () => {
    mocks.request.mockImplementation(async (route: string, input?: any) => {
      if (route === 'novel.get_status') return projectStatus
      if (route === 'novel.list_books') return books
      if (route === 'novel.get_book') return books.find((b) => b.id === input.bookId) ?? null
      if (route === 'novel.list_chapters') return { chapters, chapterCount: 3 }
      if (route === 'novel.get_chapter') return chapterDetail
      if (route === 'novel.save_chapter') return undefined
      return null
    })

    render(<NovelPage />)
    await screen.findByText('novel.shelf_heading')
    fireEvent.click(screen.getByText('灯塔守夜人'))
    await screen.findByText('novel.toc_heading')
    fireEvent.click(screen.getByText('第三章 潮汐'))
    await screen.findByText(/潮水退去/)

    // Enter edit mode and change the content.
    fireEvent.click(screen.getByRole('button', { name: 'novel.edit' }))
    const editor = screen.getByRole('textbox', { name: 'novel.edit' })
    expect(editor).toHaveValue(chapterDetail.content)
    fireEvent.change(editor, { target: { value: '新的开头……' } })

    // Save goes through the engine.
    fireEvent.click(screen.getByRole('button', { name: 'novel.save' }))
    await waitFor(() => {
      const calls = mocks.request.mock.calls.filter(([route]) => route === 'novel.save_chapter')
      expect(calls).toHaveLength(1)
      expect(calls[0][1]).toMatchObject({ bookId: 'demo', chapterNumber: 3, content: '新的开头……' })
    })
    // Back to read mode with the refreshed content.
    expect(await screen.findByText(/潮水退去/)).toBeInTheDocument()
  })

  it('shows audit issues and review note for the selected chapter', async () => {
    mocks.request.mockImplementation(async (route: string, input?: any) => {
      if (route === 'novel.get_status') return projectStatus
      if (route === 'novel.list_books') return books
      if (route === 'novel.get_book') return books.find((b) => b.id === input.bookId) ?? null
      if (route === 'novel.list_chapters') return { chapters, chapterCount: 3 }
      if (route === 'novel.get_chapter') return chapterDetail
      return null
    })

    render(<NovelPage />)
    await screen.findByText('novel.shelf_heading')
    fireEvent.click(screen.getByText('灯塔守夜人'))
    await screen.findByText('novel.toc_heading')
    fireEvent.click(screen.getByText('第三章 潮汐'))

    expect(await screen.findByText('novel.audit_issues')).toBeInTheDocument()
    expect(screen.getByText('时间线不一致')).toBeInTheDocument()
    expect(screen.getByText(/待修：退潮时间需与开头统一/)).toBeInTheDocument()
  })

  it('shows the LLM guidance banner when no model is configured', async () => {
    mocks.request.mockImplementation(async (route: string, input?: any) => {
      if (route === 'novel.get_status') return projectStatus
      if (route === 'novel.list_books') return books
      if (route === 'novel.get_book') return books.find((b) => b.id === input.bookId) ?? null
      if (route === 'novel.list_chapters') return { chapters, chapterCount: 3 }
      return null
    })

    render(<NovelPage />)
    expect(await screen.findByText('novel.llm_hint_title')).toBeInTheDocument()
    expect(screen.getByText('novel.llm_hint_description')).toBeInTheDocument()
  })

  it('does not show the LLM guidance banner when a model is configured', async () => {
    mocks.request.mockImplementation(async (route: string, input?: any) => {
      if (route === 'novel.get_status') return { ...projectStatus, model: 'gpt-5.2' }
      if (route === 'novel.list_books') return books
      if (route === 'novel.get_book') return books.find((b) => b.id === input.bookId) ?? null
      if (route === 'novel.list_chapters') return { chapters, chapterCount: 3 }
      return null
    })

    render(<NovelPage />)
    expect(await screen.findByText('novel.shelf_heading')).toBeInTheDocument()
    expect(screen.queryByText('novel.llm_hint_title')).not.toBeInTheDocument()
  })

  it('initializes the sample workspace via one-click start', async () => {
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'novel.get_status') return null
      if (route === 'novel.init_workspace') return 'D:/novel'
      if (route === 'novel.list_books') return books
      return null
    })

    render(<NovelPage />)

    // Empty state shows the quick-start button.
    expect(await screen.findByText('novel.empty_heading')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'novel.init_workspace' }))

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith('novel.init_workspace')
    })
    // Seeded sample book appears on the shelf.
    expect(await screen.findByText('灯塔守夜人')).toBeInTheDocument()
  })
})
