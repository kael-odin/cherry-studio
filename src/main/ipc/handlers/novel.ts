import { application } from '@application'
import { EngineApiError } from '@main/novel/inkEngineClient'
import { IpcError } from '@shared/ipc/errors/IpcError'
import type { novelRequestSchemas } from '@shared/ipc/schemas/novel'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * 引擎错误码 → 中文引导文案（渲染器以 IpcError.code 分支）。
 * 未映射的错误原样透传。
 */
const ENGINE_ERROR_HINTS: Record<string, string> = {
  LLM_CONFIG_ERROR: 'novel.error_llm_config'
}

/** 包装一次引擎调用：把引擎错误码映射成带中文提示的 IpcError。 */
async function withEngineError<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (err) {
    if (err instanceof EngineApiError && ENGINE_ERROR_HINTS[err.code]) {
      throw new IpcError(ENGINE_ERROR_HINTS[err.code], err.message)
    }
    throw err
  }
}

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
  'novel.list_books': async () => withEngineError(() => application.get('NovelService').listBooks()),
  'novel.create_book': async (input) => withEngineError(() => application.get('NovelService').createBook(input)),
  'novel.create_status': async (input) =>
    withEngineError(() => application.get('NovelService').createStatus(input.bookId)),
  'novel.get_book': async (input) => withEngineError(() => application.get('NovelService').getBook(input.bookId)),
  'novel.list_chapters': async (input) =>
    withEngineError(() => application.get('NovelService').listChapters(input.bookId)),
  'novel.get_chapter': async (input) =>
    withEngineError(() => application.get('NovelService').getChapter(input.bookId, input.chapterNumber)),
  'novel.save_chapter': async (input) =>
    withEngineError(() =>
      application.get('NovelService').saveChapter(input.bookId, input.chapterNumber, input.content)
    ),
  'novel.write_next': async (input) => withEngineError(() => application.get('NovelService').writeNext(input.bookId)),
  'novel.audit_chapter': async (input) =>
    withEngineError(() => application.get('NovelService').auditChapter(input.bookId, input.chapterNumber)),
  'novel.revise_chapter': async (input) =>
    withEngineError(() =>
      application.get('NovelService').reviseChapter(input.bookId, input.chapterNumber, input.mode, input.brief)
    ),
  'novel.approve_chapter': async (input) =>
    withEngineError(() =>
      application.get('NovelService').approveChapter(input.bookId, input.chapterNumber, input.reason)
    ),
  'novel.reject_chapter': async (input) =>
    withEngineError(() =>
      application.get('NovelService').rejectChapter(input.bookId, input.chapterNumber, input.reason)
    ),
  'novel.engine_error': async () => {
    const service = application.get('NovelService')
    const error = service.lastEngineError()
    return error ? { code: error.code, message: error.message } : null
  }
}
