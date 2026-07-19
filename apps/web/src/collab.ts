import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import type { Shape } from './types'

const endpoint = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

export function useCollaborativeBoard(seed: Shape[]) {
  const session = useRef<ReturnType<typeof createSession> | null>(null)
  const [shapes, setShapes] = useState(seed)
  const [connected, setConnected] = useState(false)
  const [people, setPeople] = useState<{ name: string; color: string }[]>([])

  if (!session.current) session.current = createSession()

  useEffect(() => {
    const { doc, provider, shapes: board, undoManager, origin } = session.current!
    const sync = () => setShapes(board.toArray())
    const presence = () => setPeople(Array.from(provider.awareness.getStates().entries())
      .filter(([id]) => id !== doc.clientID)
      .map(([, state]) => state.user as { name: string; color: string })
      .filter(Boolean))
    board.observe(sync)
    provider.awareness.on('change', presence)
    provider.on('status', ({ status }: { status: string }) => setConnected(status === 'connected'))
    provider.on('sync', (synced: boolean) => {
      if (synced && board.length === 0) doc.transact(() => board.push(seed), origin)
      sync()
    })
    provider.awareness.setLocalStateField('user', { name: `Guest ${doc.clientID.toString(36).slice(-3)}`, color: '#6C5CE7' })
    return () => { board.unobserve(sync); provider.awareness.off('change', presence); undoManager.destroy(); provider.destroy(); doc.destroy() }
  }, [seed])

  return {
    shapes,
    connected,
    people,
    replace(next: Shape[]) {
      const { doc, shapes: board, origin } = session.current!
      doc.transact(() => { board.delete(0, board.length); board.insert(0, next) }, origin)
    },
    undo() { session.current!.undoManager.undo() },
    redo() { session.current!.undoManager.redo() },
    moveCursor(cursor: { x: number; y: number } | null) { session.current!.provider.awareness.setLocalStateField('cursor', cursor) }
  }
}

function createSession() {
  const doc = new Y.Doc()
  const shapes = doc.getArray<Shape>('shapes')
  const provider = new WebsocketProvider(endpoint, 'project-nebula', doc)
  const origin = {}
  return { doc, shapes, provider, origin, undoManager: new Y.UndoManager(shapes, { trackedOrigins: new Set([origin]) }) }
}
