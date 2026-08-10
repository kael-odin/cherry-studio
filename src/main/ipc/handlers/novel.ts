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
  'novel.open_workspace': (input) => application.get('NovelService').openWorkspace(input.root),
  'novel.close_workspace': () => {
    application.get('NovelService').closeWorkspace()
  },
  'novel.list_chapters': () => application.get('NovelService').listChapters(),
  'novel.read_chapter': (input) => application.get('NovelService').readChapter(input.chapterId),
  'novel.scene_context': (input) => application.get('NovelService').sceneContext(input.chapterId),
  'novel.list_reviews': (input) => application.get('NovelService').listReviews(input.chapterId)
}
