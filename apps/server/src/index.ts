import { createServer } from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { createClient } from 'redis'
import WebSocket, { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'

const port = Number(process.env.PORT ?? 3001)
const databaseUrl = process.env.DATABASE_URL
const redisUrl = process.env.REDIS_URL
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null
const instanceId = randomUUID()
const redis = redisUrl ? { publisher: createClient({ url: redisUrl }), subscriber: createClient({ url: redisUrl }) } : null
const rooms = new Map<string, Room>()
const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist')
const messageSync = 0
const messageAwareness = 1
const REDIS_ORIGIN = Symbol('redis')
const metrics = { connections: 0, updates: 0, redisUpdates: 0, snapshots: 0, snapshotMs: 0, lastRedisLatencyMs: 0 }

type Room = { name: string; doc: Y.Doc; awareness: Awareness; sockets: Set<WebSocket>; socketClients: Map<WebSocket, Set<number>>; saveTimer?: NodeJS.Timeout }

function log(event: string, fields: Record<string, unknown> = {}) { console.log(JSON.stringify({ event, instanceId, at: new Date().toISOString(), ...fields })) }

async function database() {
  if (!pool) return
  await pool.query(`CREATE TABLE IF NOT EXISTS canvas_snapshots (
    room_name text PRIMARY KEY,
    state bytea NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`)
}

async function connectRedis() {
  if (!redis) return
  redis.publisher.on('error', error => log('redis_error', { message: error.message }))
  redis.subscriber.on('error', error => log('redis_error', { message: error.message }))
  await Promise.all([redis.publisher.connect(), redis.subscriber.connect()])
  await redis.subscriber.subscribe('livecanvas:updates', message => {
    try {
      const event = JSON.parse(message) as { sender: string; room: string; update: string; sentAt: number }
      if (event.sender === instanceId) return
      const room = rooms.get(event.room)
      if (!room) return
      Y.applyUpdate(room.doc, Buffer.from(event.update, 'base64'), REDIS_ORIGIN)
      metrics.redisUpdates++
      metrics.lastRedisLatencyMs = Date.now() - event.sentAt
    } catch (error) { log('redis_message_error', { message: error instanceof Error ? error.message : String(error) }) }
  })
  log('redis_connected')
}

function publishUpdate(room: Room, update: Uint8Array) {
  if (!redis?.publisher.isOpen) return
  void redis.publisher.publish('livecanvas:updates', JSON.stringify({ sender: instanceId, room: room.name, update: Buffer.from(update).toString('base64'), sentAt: Date.now() }))
}

async function getRoom(name: string) {
  const existing = rooms.get(name)
  if (existing) return existing
  const doc = new Y.Doc()
  if (pool) {
    const result = await pool.query<{ state: Buffer }>('SELECT state FROM canvas_snapshots WHERE room_name = $1', [name])
    if (result.rowCount) Y.applyUpdate(doc, new Uint8Array(result.rows[0].state))
  }
  const room: Room = { name, doc, awareness: new Awareness(doc), sockets: new Set(), socketClients: new Map() }
  doc.on('update', (update, origin) => {
    metrics.updates++
    scheduleSnapshot(room)
    broadcast(room, syncMessage(encoder => syncProtocol.writeUpdate(encoder, update)), origin as WebSocket | null)
    if (origin !== REDIS_ORIGIN) publishUpdate(room, update)
  })
  room.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    const changed = added.concat(updated, removed)
    if (origin instanceof WebSocket) {
      const ids = room.socketClients.get(origin) ?? new Set<number>()
      changed.forEach(id => ids.add(id))
      room.socketClients.set(origin, ids)
    }
    const update = encodeAwarenessUpdate(room.awareness, changed)
    broadcast(room, awarenessMessage(update), origin as WebSocket | null)
  })
  rooms.set(name, room)
  return room
}

function scheduleSnapshot(room: Room) {
  if (!pool || room.saveTimer) return
  room.saveTimer = setTimeout(async () => {
    room.saveTimer = undefined
    const started = performance.now()
    try {
      await pool!.query(
        `INSERT INTO canvas_snapshots (room_name, state) VALUES ($1, $2)
         ON CONFLICT (room_name) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
        [room.name, Buffer.from(Y.encodeStateAsUpdate(room.doc))]
      )
      metrics.snapshots++
      metrics.snapshotMs = Math.round(performance.now() - started)
      log('snapshot_saved', { room: room.name, durationMs: metrics.snapshotMs })
    } catch (error) { log('snapshot_error', { room: room.name, message: error instanceof Error ? error.message : String(error) }) }
  }, 800)
}

function broadcast(room: Room, message: Uint8Array, except: WebSocket | null = null) {
  for (const socket of room.sockets) if (socket !== except && socket.readyState === WebSocket.OPEN) socket.send(message)
}

function syncMessage(write: (encoder: encoding.Encoder) => void) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageSync)
  write(encoder)
  return encoding.toUint8Array(encoder)
}

function awarenessMessage(update: Uint8Array) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, messageAwareness)
  encoding.writeVarUint8Array(encoder, update)
  return encoding.toUint8Array(encoder)
}

function connect(room: Room, socket: WebSocket) {
  room.sockets.add(socket)
  metrics.connections++
  log('client_connected', { room: room.name, connections: metrics.connections })
  socket.send(syncMessage(encoder => syncProtocol.writeSyncStep1(encoder, room.doc)))
  const awareness = encodeAwarenessUpdate(room.awareness, Array.from(room.awareness.getStates().keys()))
  if (awareness.length) socket.send(awarenessMessage(awareness))

  socket.on('message', data => {
    const decoder = decoding.createDecoder(new Uint8Array(data as Buffer))
    const type = decoding.readVarUint(decoder)
    if (type === messageSync) {
      const reply = syncMessage(encoder => syncProtocol.readSyncMessage(decoder, encoder, room.doc, socket))
      if (reply.length > 1) socket.send(reply)
    }
    if (type === messageAwareness) applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), socket)
  })
  socket.on('close', () => {
    room.sockets.delete(socket)
    metrics.connections--
    const ids = Array.from(room.socketClients.get(socket) ?? [])
    room.socketClients.delete(socket)
    if (ids.length) removeAwarenessStates(room.awareness, ids, socket)
    scheduleSnapshot(room)
    log('client_disconnected', { room: room.name, connections: metrics.connections })
  })
  socket.on('error', error => log('socket_error', { room: room.name, message: error.message }))
}

const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(request.url?.split('?')[0] ?? '/')
  if (pathname === '/healthz') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ ok: true, instanceId, rooms: rooms.size, redis: Boolean(redis?.publisher.isOpen), metrics }))
    return
  }
  const candidate = resolve(publicDir, pathname === '/' ? 'index.html' : pathname.slice(1))
  const file = candidate.startsWith(publicDir) && existsSync(candidate) ? candidate : resolve(publicDir, 'index.html')
  if (!existsSync(file)) { response.writeHead(200); response.end('LiveCanvas sync server'); return }
  response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(response)
})
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', async (request, socket, head) => {
  const match = request.url?.match(/^\/ws\/([\w-]+)$/)
  if (!match) return socket.destroy()
  try {
    const room = await getRoom(match[1])
    wss.handleUpgrade(request, socket, head, connection => connect(room, connection))
  } catch (error) { console.error(error); socket.destroy() }
})

await Promise.all([database(), connectRedis()])
server.listen(port, () => log('server_started', { port }))
