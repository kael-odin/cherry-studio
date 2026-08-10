import { application } from '@application'
import type { novelRequestSchemas } from '@shared/ipc/schemas/novel'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const novelHandlers: IpcHandlersFor<typeof novelRequestSchemas> = {
  'novel.get_status': async () => {
    const service = application.get('NovelService')
    const workspace = service.getWorkspace()
    if (!workspace) {
      return null
    }
    return service.workspaceStatus()
  },
  'novel.open_workspace': async (input) => application.get('NovelService').openWorkspace(input.root),
  'novel.close_workspace': async () => {
    application.get('NovelService').closeWorkspace()
  },
  'novel.list_chapters': async () => application.get('NovelService').listChapters(),
  'novel.read_chapter': async (input) => application.get('NovelService').readChapter(input.chapterId),
  'novel.scene_context': async (input) => application.get('NovelService').sceneContext(input.chapterId),
  'novel.list_reviews': async (input) => application.get('NovelService').listReviews(input.chapterId),
  'novel.state_read': async (input) => application.get('NovelService').stateRead(input.asOfChapter ?? 0),
  'novel.run_review': async (input) => application.get('NovelService').runReview(input.chapterId, input.modelId),
  'novel.finalize': async (input) => application.get('NovelService').finalizeChapter(input.chapterId, input.status),
  'novel.repo_status': async () => application.get('NovelService').repoStatus(),
  'novel.git_commit': async (input) => application.get('NovelService').commitChanges(input.message),
  'novel.git_rollback': async (input) => application.get('NovelService').rollback(input.target)
}
