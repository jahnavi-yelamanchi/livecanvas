import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import type { Shape } from './types'

const endpoint = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

export function useCollaborativeBoard(seed: Shape[]) {
  const session = useRef<ReturnType<typeof createSession> | null>(null)
  const [shapes, setShapes] = useState(seed)
  const [connected, setConnected] = useState(false)
  const [people, setPeople] = useState<{ name: string; color: string }[]>([])
  const [cursors, setCursors] = useState<{ name: string; color: string; x: number; y: number }[]>([])

  if (!session.current) session.current = createSession()

  useEffect(() => {
    const { doc, provider, persistence, shapes: board, undoManager, origin } = session.current!
    let seeded = false
    const sync = () => setShapes(Array.from(board.values()))
    const presence = () => {
      const states = Array.from(provider.awareness.getStates().entries()).filter(([id]) => id !== doc.clientID)
      setPeople(states.map(([, state]) => state.user as { name: string; color: string }).filter(Boolean))
      setCursors(states.flatMap(([, state]) => state.cursor && state.user ? [{ ...state.user as { name: string; color: string }, ...state.cursor as { x: number; y: number } }] : []))
    }
    board.observe(sync)
    provider.awareness.on('change', presence)
    provider.on('status', ({ status }: { status: string }) => setConnected(status === 'connected'))
    const seedBoard = () => {
      if (seeded || !provider.synced || !persistence.synced) return
      seeded = true
      if (board.size === 0) doc.transact(() => seed.forEach(shape => board.set(shape.id, shape)), origin)
      sync()
    }
    provider.on('sync', seedBoard)
    persistence.on('synced', seedBoard)
    provider.awareness.setLocalStateField('user', { name: `Guest ${doc.clientID.toString(36).slice(-3)}`, color: '#6C5CE7' })
    return () => { board.unobserve(sync); provider.awareness.off('change', presence); persistence.off('synced', seedBoard); undoManager.destroy(); provider.destroy(); persistence.destroy(); doc.destroy() }
  }, [seed])

  return {
    shapes,
    connected,
    people,
    cursors,
    add(shape: Shape) {
      const { doc, shapes: board, origin } = session.current!
      doc.transact(() => board.set(shape.id, shape), origin)
    },
    update(id: string, patch: Partial<Shape>) {
      const { doc, shapes: board, origin } = session.current!
      const current = board.get(id)
      if (current) doc.transact(() => board.set(id, { ...current, ...patch }), origin)
    },
    undo() { session.current!.undoManager.undo() },
    redo() { session.current!.undoManager.redo() },
    beginChange() { session.current!.undoManager.stopCapturing() },
    finishChange() { session.current!.undoManager.stopCapturing() },
    moveCursor(cursor: { x: number; y: number } | null) { session.current!.provider.awareness.setLocalStateField('cursor', cursor) }
  }
}

function createSession() {
  const doc = new Y.Doc()
  const shapes = doc.getMap<Shape>('shapeMap')
  const persistence = new IndexeddbPersistence('livecanvas-project-nebula', doc)
  const provider = new WebsocketProvider(endpoint, 'project-nebula', doc)
  const origin = {}
  return { doc, shapes, provider, persistence, origin, undoManager: new Y.UndoManager(shapes, { trackedOrigins: new Set([origin]) }) }
}
