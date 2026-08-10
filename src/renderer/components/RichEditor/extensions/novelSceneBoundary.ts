import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'

import NovelSceneBoundaryNodeView from '../components/NovelSceneBoundaryNodeView'

// Matches the novel-spec scene marker contract: `<!-- scene:sNN -->` on its own line.
// https://github.com/kael-odin/novel-spec SPEC.md "Scene-sized generation".
// Not `$`-anchored: marked passes the whole block src (which may continue after the
// marker), so end-of-line is asserted in tokenize by looking at the next character.
const SCENE_MARKER_RE = /^<!--\s*scene:(s[-\w]+)\s*-->/

/**
 * Novel scene boundary marker (`<!-- scene:sNN -->`), as defined by novel-spec.
 *
 * Without a dedicated node, @tiptap/markdown parses the comment as plain text and
 * serializes it HTML-escaped (`&lt;!-- scene:s01 --&gt;`), corrupting the marker in
 * the repository. This atom node captures the marker on parse and re-emits it
 * byte-exact on serialize, so scene markers round-trip losslessly through the
 * editor.
 */
export const NovelSceneBoundary = Node.create({
  name: 'novelSceneBoundary',
  group: 'block',
  atom: true,
  draggable: false,
  selectable: true,

  markdownTokenizer: {
    name: 'novelSceneBoundary',
    level: 'block',
    start(src: string) {
      return SCENE_MARKER_RE.test(src) ? 0 : -1
    },
    tokenize(src: string): { type: string; raw: string; text: string } | undefined {
      const match = SCENE_MARKER_RE.exec(src)
      if (!match) {
        return undefined
      }
      // The marker must be a complete line: the next character is a newline or EOF.
      // A comment-like prefix of a longer line (`<!-- scene:s01 --> and more`) is
      // ordinary text, not a scene boundary.
      if (match[0].length !== src.length && src[match[0].length] !== '\n') {
        return undefined
      }
      return {
        type: 'novelSceneBoundary',
        raw: match[0],
        text: match[0] // stored verbatim; sceneId is parsed from it in parseMarkdown
      }
    }
  },

  parseMarkdown(token, helpers) {
    const sceneId = typeof token.text === 'string' ? (SCENE_MARKER_RE.exec(token.text)?.[1] ?? null) : null
    return helpers.createNode('novelSceneBoundary', { sceneId })
  },

  renderMarkdown(node) {
    const sceneId = node.attrs?.sceneId
    if (!sceneId) {
      return ''
    }
    return `<!-- scene:${sceneId} -->`
  },

  addAttributes() {
    return {
      sceneId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-scene-id'),
        renderHTML: (attributes) => ({ 'data-scene-id': attributes.sceneId })
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="novelSceneBoundary"]',
        getAttrs: (element) => {
          if (typeof element === 'string') return false
          return { sceneId: element.getAttribute('data-scene-id') }
        }
      }
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const sceneId = node.attrs.sceneId
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'novelSceneBoundary',
        'data-scene-id': sceneId
      }),
      `<!-- scene:${sceneId} -->`
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(NovelSceneBoundaryNodeView)
  }
})
