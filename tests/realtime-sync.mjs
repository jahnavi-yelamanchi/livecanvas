import assert from 'node:assert/strict'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const endpoint = process.env.LIVECANVAS_WS ?? 'ws://localhost:3001/ws'
const secondEndpoint = process.env.LIVECANVAS_WS_SECOND ?? endpoint
const room = `sync-test-${Date.now()}`
const first = new Y.Doc()
const second = new Y.Doc()
const one = new WebsocketProvider(endpoint, room, first, { WebSocketPolyfill: WebSocket })
const two = new WebsocketProvider(secondEndpoint, room, second, { WebSocketPolyfill: WebSocket })
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

await wait(300)
first.getMap('shapeMap').set('stroke', { id: 'stroke', type: 'path', points: [10, 10, 20, 20] })
await wait(300)
assert.deepEqual(second.getMap('shapeMap').get('stroke'), { id: 'stroke', type: 'path', points: [10, 10, 20, 20] })
one.destroy(); two.destroy(); first.destroy(); second.destroy()
console.log('realtime sync passed')
