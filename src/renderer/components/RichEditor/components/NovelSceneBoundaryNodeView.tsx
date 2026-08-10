import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { Flag } from 'lucide-react'
import React from 'react'

/**
 * Renders a novel-spec scene boundary (`<!-- scene:sNN -->`) as a non-editable
 * chip. The marker is structural metadata: clicking the node selects it (the
 * surrounding editor toolbar then offers delete), there is no in-place editing.
 */
const NovelSceneBoundaryNodeView: React.FC<NodeViewProps> = ({ node }) => {
  const sceneId = (node.attrs.sceneId as string | null) ?? null
  return (
    <NodeViewWrapper data-type="novelSceneBoundary" contentEditable={false}>
      <div className="novel-scene-boundary my-2 flex w-full select-none items-center gap-2 rounded-md border border-primary/40 border-dashed bg-primary/5 px-3 py-1.5">
        <Flag size={14} className="shrink-0 text-primary" />
        <span className="truncate font-mono text-primary text-xs">scene:{sceneId ?? 'unknown'}</span>
      </div>
    </NodeViewWrapper>
  )
}

export default NovelSceneBoundaryNodeView
