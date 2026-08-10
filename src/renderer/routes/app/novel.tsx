import NovelPage from '@renderer/pages/novel/NovelPage'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/app/novel')({
  component: NovelPage
})
