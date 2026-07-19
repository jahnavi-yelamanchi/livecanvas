import { useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import type { Shape, Tool } from './types'
import { useCollaborativeBoard } from './collab'

const palette = ['#A8D8FF', '#FFBF9D', '#B8F1D3', '#C7B8FF']
const initialShapes: Shape[] = [
  { id: 'note-1', type: 'note', x: 140, y: 138, width: 172, height: 116, color: '#A8D8FF', text: 'Launch canvas\nroom workflow' },
  { id: 'note-2', type: 'note', x: 580, y: 298, width: 170, height: 114, color: '#FFBF9D', text: 'Review together\non Friday' },
  { id: 'rect-1', type: 'rectangle', x: 358, y: 174, width: 178, height: 92, color: '#6C5CE7', text: 'Realtime sync' },
  { id: 'ellipse-1', type: 'ellipse', x: 350, y: 396, width: 160, height: 94, color: '#42D392', text: 'Ship it' },
  { id: 'text-1', type: 'text', x: 160, y: 428, color: '#283548', text: 'Project Nebula' }
]

const tools: { id: Tool; label: string; icon: string }[] = [
  { id: 'select', label: 'Select', icon: '↖' }, { id: 'hand', label: 'Pan', icon: '✋' },
  { id: 'pen', label: 'Draw', icon: '✎' }, { id: 'note', label: 'Sticky note', icon: '▣' },
  { id: 'shape', label: 'Shape', icon: '◇' }, { id: 'text', label: 'Text', icon: 'T' }
]

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }

export function App() {
  const [tool, setTool] = useState<Tool>('select')
  const { shapes, connected, people, cursors, add, update, undo, redo, beginChange, finishChange, moveCursor } = useCollaborativeBoard(initialShapes)
  const [selected, setSelected] = useState<string | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ id: string; x: number; y: number } | null>(null)
  const stroke = useRef<number[]>([])
  const strokeId = useRef<string | null>(null)

  const canvasPoint = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }

  const addAt = (event: PointerEvent<HTMLDivElement>) => {
    const { x, y } = canvasPoint(event)
    if (tool === 'note') add({ id: uid(), type: 'note', x, y, width: 160, height: 108, color: palette[shapes.length % palette.length], text: 'New idea' })
    if (tool === 'shape') add({ id: uid(), type: 'rectangle', x, y, width: 150, height: 86, color: '#6C5CE7', text: 'New shape' })
    if (tool === 'text') add({ id: uid(), type: 'text', x, y, color: '#283548', text: 'Type something' })
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const point = canvasPoint(event)
    if (tool === 'pen') {
      beginChange()
      stroke.current = [point.x, point.y]
      strokeId.current = uid()
      add({ id: strokeId.current, type: 'path', x: 0, y: 0, color: '#283548', points: stroke.current })
      return
    }
    if (tool !== 'select') { addAt(event); return }
    setSelected(null)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const point = canvasPoint(event)
    setCursor(point)
    moveCursor(point)
    if (tool === 'pen' && strokeId.current) {
      stroke.current.push(point.x, point.y)
      update(strokeId.current, { points: [...stroke.current] })
    }
    if (drag.current) {
      const { id, x, y } = drag.current
      update(id, { x: point.x - x, y: point.y - y })
    }
  }

  const onPointerUp = () => {
    if (tool === 'pen' && strokeId.current) finishChange()
    stroke.current = []
    strokeId.current = null
    drag.current = null
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">✦</span> LiveCanvas</div>
      <div className="board-name">Project Nebula <span className={connected ? 'saved-dot' : 'saved-dot offline'} /> <span className="saved-label">{connected ? 'Live' : 'Connecting'}</span></div>
      <div className="top-actions">
        <div className="avatars" aria-label={`${people.length} collaborators`}>{people.slice(0, 3).map(person => <span key={person.name} title={person.name} style={{ background: person.color }}>{person.name[0]}</span>)}</div>
        <button className="share">Share</button>
      </div>
    </header>

    <aside className="tools" aria-label="Canvas tools">
      {tools.map(item => <button key={item.id} className={tool === item.id ? 'tool active' : 'tool'} onClick={() => setTool(item.id)} title={item.label}>{item.icon}</button>)}
      <div className="tool-divider" />
      <button className="tool" onClick={() => { undo(); setSelected(null) }} title="Undo">↶</button>
      <button className="tool" onClick={redo} title="Redo">↷</button>
    </aside>

    <section className="workspace">
      <div className="canvas-frame">
        <div className={`canvas tool-${tool}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
          <svg className="paths" aria-hidden="true">{shapes.filter(shape => shape.type === 'path').map(shape => <polyline key={shape.id} points={pairPoints(shape.points!)} fill="none" stroke={shape.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />)}</svg>
          <svg className="connectors" aria-hidden="true" viewBox="0 0 1000 700"><path d="M312 196 C330 196 336 220 358 220" /><path d="M448 266 C448 310 432 342 432 395" /><path d="M536 220 C575 220 586 260 596 298" /></svg>
          {shapes.filter(shape => shape.type !== 'path').map(shape => <CanvasShape key={shape.id} shape={shape} selected={selected === shape.id} onPointerDown={event => {
            if (tool !== 'select') return
            event.stopPropagation()
            const point = canvasPoint(event)
            drag.current = { id: shape.id, x: point.x - shape.x, y: point.y - shape.y }
            setSelected(shape.id)
          }} />)}
          {cursors.map(cursor => <RemoteCursor key={cursor.name} {...cursor} />)}
          {cursor && <span className="local-cursor" style={{ left: cursor.x, top: cursor.y }} />}
        </div>
      </div>
      <div className="save-status"><span>✓</span> {connected ? 'All changes synced' : 'Working offline'}</div>
      <div className="zoom"><button>−</button><span>100%</span><button>+</button></div>
    </section>

    <aside className="sidebar">
      <section><h2>Collaborators</h2>{people.length ? people.map(person => <div className="person" key={person.name}><span className="person-avatar" style={{ background: person.color }}>{person.name[0]}</span><div><strong>{person.name}</strong><small>Editing now</small></div><span className="online" /></div>) : <p className="empty-presence">Open this board in another window to collaborate.</p>}</section>
      <section className="layers"><div className="section-heading"><h2>Layers</h2><button>＋</button></div>{shapes.filter(shape => shape.type !== 'path').slice().reverse().map(shape => <button key={shape.id} className={selected === shape.id ? 'layer selected-layer' : 'layer'} onClick={() => setSelected(shape.id)}><span className={`layer-icon ${shape.type}`} />{shape.text?.split('\n')[0] || 'Drawing'}</button>)}</section>
    </aside>
  </main>
}

function CanvasShape({ shape, selected, onPointerDown }: { shape: Shape; selected: boolean; onPointerDown: (event: PointerEvent<HTMLDivElement>) => void }) {
  const style = { left: shape.x, top: shape.y, width: shape.width, height: shape.height }
  const className = `shape ${shape.type} ${selected ? 'selected' : ''}`
  return <div className={className} style={{ ...style, '--shape-color': shape.color } as CSSProperties} onPointerDown={onPointerDown}>
    {shape.type === 'text' ? shape.text : <span>{shape.text?.split('\n').map((line, index) => <span key={index}>{line}<br /></span>)}</span>}
  </div>
}

function RemoteCursor({ name, color, x, y }: { name: string; color: string; x: number; y: number }) {
  return <div className="remote-cursor" style={{ left: x, top: y, '--cursor-color': color } as CSSProperties}><i>↖</i><span>{name}</span></div>
}

function pairPoints(points: number[]) { return points.reduce<string[]>((result, value, index) => index % 2 ? [...result.slice(0, -1), `${result.at(-1)},${value}`] : [...result, String(value)], []).join(' ') }
