// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { OutputFor } from '@shared/ipc/types'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  selectFolder: vi.fn(),
  confirm: vi.fn(() => true)
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => mocks.request(...args) }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: vi.fn() }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const status: OutputFor<'novel.get_status'> = {
  path: 'D:/repo/sample-novel',
  chapterCount: 3,
  specVersion: '0.1'
}

const chapters: OutputFor<'novel.list_chapters'> = [
  {
    id: 'v01-c001',
    title: 'The Shipwreck',
    volume: 1,
    chapter: 1,
    status: 'final',
    countUnit: 'words',
    targetChars: 585,
    proseCount: 585,
    sceneCount: 1,
    sceneMarkers: ['s01']
  },
  {
    id: 'v01-c002',
    title: 'The Note',
    volume: 1,
    chapter: 2,
    status: 'final',
    countUnit: 'words',
    targetChars: 585,
    proseCount: 585,
    sceneCount: 1,
    sceneMarkers: ['s01']
  },
  {
    id: 'v01-c003',
    title: 'The Fever',
    volume: 1,
    chapter: 3,
    status: 'reviewed',
    countUnit: 'words',
    targetChars: 585,
    proseCount: 585,
    sceneCount: 3,
    sceneMarkers: ['s01', 's02', 's03']
  }
]

const novelState: OutputFor<'novel.state_read'> = {
  world: { name: 'The Lighthouse Keeper world', era: 'Post-Blackout, year 7', premise: 'premise', rules: ['rule 1'] },
  characters: [
    {
      id: 'keeper',
      name: 'Aren',
      current: {
        location: "Lighthouse island, keeper's quarters",
        psychology: 'Hope and duty in open conflict',
        knowledge: ['Mira left for the mainland 4 years ago.'],
        inventory: ['brass key to the archive', 'tide chart'],
        relationships: { stranger: 'Half-convinced, half-unsettled' },
        status: 'alive'
      },
      asOfChapter: 3
    }
  ],
  foreshadow: [
    {
      id: 'fs-storms',
      planted_at: 'v01-c002',
      status: 'planted',
      description: 'The winter storms will seal the island.'
    }
  ],
  timeline: [
    {
      id: 'ev-shipwreck',
      chapter: 'v01-c001',
      absolute_time: 'autumn equinox, dawn',
      description: 'A stranger washes ashore.',
      participants: ['keeper', 'stranger']
    }
  ],
  pov: { chapter: 'v01-c003', viewpoint: 'close-third, Aren', tense: 'past' }
}

const repoStatus: OutputFor<'novel.repo_status'> = {
  branch: 'main',
  shortSha: 'abc1234',
  commitMessage: 'feat: first draft',
  dirty: true,
  modified: ['chapters/v01-c003.md'],
  deleted: [],
  untracked: ['reviews/v01-c003-004.json'],
  ahead: 1,
  behind: 0,
  isGitRepo: true
}

import NovelPage from '../NovelPage'

beforeEach(() => {
  // window.api is the preload bridge; `file.selectFolder` is used by openWorkspace.
  Object.assign(window.api, { file: { selectFolder: mocks.selectFolder } })
  mocks.confirm.mockReset()
  mocks.confirm.mockReturnValue(true)
  window.confirm = mocks.confirm
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NovelPage', () => {
  it('opens a workspace and shows the state tab with as-of-chapter selector', async () => {
    mocks.request.mockImplementation(async (route: string, input?: any) => {
      if (route === 'novel.get_status') return status
      if (route === 'novel.open_workspace') return input.root
      if (route === 'novel.list_chapters') return chapters
      if (route === 'novel.state_read') return novelState
      return null
    })
    mocks.selectFolder.mockResolvedValue('D:/repo/sample-novel')

    render(<NovelPage />)

    // Empty state first (two open buttons: header + empty state).
    expect(screen.getByText('novel.empty_description')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'novel.open_workspace' })[0])
    })

    expect(await screen.findByText('novel.tab_chapter')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'novel.tab_state' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'novel.tab_state' }))

    // State view with characters, foreshadow, timeline, POV.
    expect(await screen.findByText('novel.state_heading')).toBeInTheDocument()
    expect(screen.getByText('Aren')).toBeInTheDocument()
    expect(screen.getByText(/The Lighthouse Keeper world/)).toBeInTheDocument()
    expect(screen.getByText('fs-storms')).toBeInTheDocument()
    expect(screen.getByText('A stranger washes ashore.')).toBeInTheDocument()
    expect(screen.getByText('close-third, Aren')).toBeInTheDocument()
  })

  it('reloads state when the as-of-chapter selector changes', async () => {
    mocks.request.mockImplementation(async (route: string, input?: any) => {
      if (route === 'novel.get_status') return status
      if (route === 'novel.open_workspace') return input.root
      if (route === 'novel.list_chapters') return chapters
      if (route === 'novel.state_read') return novelState
      return null
    })
    mocks.selectFolder.mockResolvedValue('D:/repo/sample-novel')

    render(<NovelPage />)

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'novel.open_workspace' })[0])
    })
    fireEvent.click(screen.getByRole('button', { name: 'novel.tab_state' }))
    await screen.findByText('novel.state_heading')

    const calls = mocks.request.mock.calls.filter(([route]) => route === 'novel.state_read')
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toEqual({ asOfChapter: 0 })

    fireEvent.click(screen.getByRole('button', { name: 'c001' }))

    await waitFor(() => {
      const stateCalls = mocks.request.mock.calls.filter(([route]) => route === 'novel.state_read')
      expect(stateCalls).toHaveLength(2)
      expect(stateCalls[1][1]).toEqual({ asOfChapter: 1 })
    })
  })

  it('shows repo status and commits the workspace from the review tab', async () => {
    mocks.request.mockImplementation(async (route: string, input?: any) => {
      if (route === 'novel.get_status') return status
      if (route === 'novel.open_workspace') return input.root
      if (route === 'novel.list_chapters') return chapters
      if (route === 'novel.repo_status') return repoStatus
      if (route === 'novel.git_commit') return { shortSha: 'def5678', commit: 'deadbeef' }
      return null
    })
    mocks.selectFolder.mockResolvedValue('D:/repo/sample-novel')

    render(<NovelPage />)

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'novel.open_workspace' })[0])
    })

    // Repo bar shows the git state.
    expect(await screen.findByText('main')).toBeInTheDocument()
    expect(screen.getByText('@abc1234')).toBeInTheDocument()
    expect(screen.getByText('novel.repo_dirty')).toBeInTheDocument()

    // Select a chapter, then open the review tab to find the repository section.
    fireEvent.click(screen.getByRole('button', { name: /The Fever/ }))
    await screen.findByText('novel.tab_review')
    fireEvent.click(screen.getByRole('button', { name: 'novel.tab_review' }))
    await screen.findByText('novel.review_heading')
    expect(screen.getByText('novel.repo_heading')).toBeInTheDocument()
    expect(screen.getByText('feat: first draft')).toBeInTheDocument()
    expect(screen.getByText(/novel.repo_ahead/)).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('novel.commit_placeholder'), {
      target: { value: 'feat: first draft' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'novel.commit_button' }))

    await waitFor(() => {
      const commitCalls = mocks.request.mock.calls.filter(([route]) => route === 'novel.git_commit')
      expect(commitCalls).toHaveLength(1)
      expect(commitCalls[0][1]).toEqual({ message: 'feat: first draft' })
    })
  })

  it('rolls back to a target commit after confirmation', async () => {
    mocks.request.mockImplementation(async (route: string, input?: any) => {
      if (route === 'novel.get_status') return status
      if (route === 'novel.open_workspace') return input.root
      if (route === 'novel.list_chapters') return chapters
      if (route === 'novel.repo_status') return repoStatus
      if (route === 'novel.git_rollback') return { target: 'abc1234', shortSha: 'abc1234', commit: 'aabbcc' }
      return null
    })
    mocks.selectFolder.mockResolvedValue('D:/repo/sample-novel')

    render(<NovelPage />)

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'novel.open_workspace' })[0])
    })
    fireEvent.click(screen.getByRole('button', { name: /The Fever/ }))
    await screen.findByText('novel.tab_review')
    fireEvent.click(screen.getByRole('button', { name: 'novel.tab_review' }))
    await screen.findByText('novel.repo_heading')

    fireEvent.change(screen.getByPlaceholderText('novel.rollback_placeholder'), { target: { value: 'abc1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'novel.rollback_button' }))

    await waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalledWith('novel.rollback_confirm')
      const rollbackCalls = mocks.request.mock.calls.filter(([route]) => route === 'novel.git_rollback')
      expect(rollbackCalls).toHaveLength(1)
      expect(rollbackCalls[0][1]).toEqual({ target: 'abc1234' })
    })
  })
})
