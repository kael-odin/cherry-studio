import { application } from '@application'
import type { novelRequestSchemas } from '@shared/ipc/schemas/novel'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const novelHandlers: IpcHandlersFor<typeof novelRequestSchemas> = {
  'novel.open_workspace': async (input) => application.get('NovelService').openWorkspace(input.root),
  'novel.init_workspace': async () => application.get('NovelService').initWorkspace(),
  'novel.close_workspace': async () => {
    application.get('NovelService').closeWorkspace()
  },
  'novel.get_status': async () => {
    const service = application.get('NovelService')
    const workspace = service.getWorkspace()
    if (!workspace) {
      return null
    }
    return service.projectStatus()
  },
  'novel.list_books': async () => application.get('NovelService').listBooks(),
  'novel.create_book': async (input) => application.get('NovelService').createBook(input),
  'novel.create_status': async (input) => application.get('NovelService').createStatus(input.bookId),
  'novel.get_book': async (input) => application.get('NovelService').getBook(input.bookId),
  'novel.list_chapters': async (input) => application.get('NovelService').listChapters(input.bookId),
  'novel.get_chapter': async (input) => application.get('NovelService').getChapter(input.bookId, input.chapterNumber),
  'novel.save_chapter': async (input) =>
    application.get('NovelService').saveChapter(input.bookId, input.chapterNumber, input.content),
  'novel.write_next': async (input) => application.get('NovelService').writeNext(input.bookId),
  'novel.audit_chapter': async (input) =>
    application.get('NovelService').auditChapter(input.bookId, input.chapterNumber),
  'novel.revise_chapter': async (input) =>
    application.get('NovelService').reviseChapter(input.bookId, input.chapterNumber, input.mode, input.brief),
  'novel.approve_chapter': async (input) =>
    application.get('NovelService').approveChapter(input.bookId, input.chapterNumber, input.reason),
  'novel.reject_chapter': async (input) =>
    application.get('NovelService').rejectChapter(input.bookId, input.chapterNumber, input.reason),
  'novel.engine_error': async () => {
    const service = application.get('NovelService')
    const error = service.lastEngineError()
    return error ? { code: error.code, message: error.message } : null
  }
}
