export type Tool = 'select' | 'hand' | 'pen' | 'note' | 'shape' | 'text'

export type Shape = {
  id: string
  type: 'note' | 'rectangle' | 'ellipse' | 'text' | 'path'
  x: number
  y: number
  width?: number
  height?: number
  color: string
  text?: string
  points?: number[]
}

export type Collaborator = { name: string; color: string }
