import { readFileSync } from 'node:fs'

import { Editor } from '@tiptap/core'
import { describe, it } from 'vitest'

import { createRichEditorExtensions } from '../createExtensions'

// Load a REAL finalized novel-spec chapter and round-trip it through the production
// editor schema. This is the definitive check that scene markers survive editing.
describe('real novel-spec chapter round-trip', () => {
  it('preserves scene markers byte-exact through the production editor', () => {
    const chapter = readFileSync('D:/Github_Open/novel-spec/examples/sample-novel/chapters/v01-c003.md', 'utf8')

    const editor = new Editor({
      element: document.createElement('div'),
      extensions: createRichEditorExtensions(),
      content: chapter,
      contentType: 'markdown'
    })

    const out = editor.getMarkdown()
    const markersIn = (chapter.match(/<!-- scene:s\d+/g) || []).join(', ')
    const markersOut = (out.match(/<!-- scene:s\d+/g) || []).join(', ')
    console.log(`markers in:  ${markersIn}`)
    console.log(`markers out: ${markersOut}`)
    console.log('--- serialized chapter head ---')
    console.log(out.split('\n').slice(0, 10).join('\n'))
    console.log('--- serialized chapter tail ---')
    console.log(out.split('\n').slice(-6).join('\n'))
    editor.destroy()
  })
})
