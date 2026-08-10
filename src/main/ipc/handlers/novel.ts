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
  'novel.list_reviews': async (input) => application.get('NovelService').listReviews(input.chapterId)
}
