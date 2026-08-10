import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createInterface, type Interface } from 'node:readline'

import { loggerService } from '@logger'

const logger = loggerService.withContext('InkEngineClient')

/** HTTP 404 — the engine resource does not exist (used to map to null). */
export class NotFoundError extends Error {}

/** Engine error envelope — the code survives for the UI to branch on. */
export class EngineApiError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'EngineApiError'
    this.code = code
  }
}

/** Timeout for the engine's HTTP API becoming reachable after spawn. Cold boots on Windows can take ~40s. */
const READY_TIMEOUT_MS = 60_000

/** SSE reconnect delay after a transient connection drop. */
const EVENTS_RECONNECT_MS = 3_000

/** Receiver for engine SSE events (event name + parsed JSON payload). */
export type EngineEventHandler = (event: string, data: unknown) => void

/**
 * HTTP client over the InkOS API server process (VISION §7.1: the engine is a
 * separate process; the host never touches the working tree). The engine is
 * `packages/studio/dist/api/index.js` from the local inkos checkout, spawned
 * with `node dist/api/index.js <projectRoot>` — it serves the full `/api/v1/*`
 * REST surface plus SSE events. Lazily spawned per workspace; killed on dispose.
 */
export class InkEngineClient {
  private proc: ChildProcess | null = null
  private reader: Interface | null = null
  private baseUrl = ''
  private port: number
  private readonly binary: string
  private readonly entry: string
  private readonly root: string
  /** The engine spawn (once it started binding) + its ready-wait, if in flight. */
  private startPromise: Promise<void> | null = null
  /** SSE event subscriber (write:start/complete/error, audit:*, revise:*, …). */
  private eventHandler: EngineEventHandler | null = null
  private eventsAbort: AbortController | null = null
  private eventsRetryTimer: NodeJS.Timeout | null = null
  private eventsRunning = false

  constructor(binary: string, entry: string, root: string, port: number) {
    this.binary = binary
    this.entry = entry
    this.root = root
    this.port = port
  }

  get running(): boolean {
    return this.proc !== null
  }

  get url(): string {
    return this.baseUrl
  }

  /**
   * Spawn the engine and wait for its HTTP API to become reachable.
   * Concurrent callers share one start (a second `start()` while the first is
   * still binding merely awaits the same promise) — without this, two IPC
   * requests racing in after a cold boot spawn TWO engine processes on the
   * same port, the loser dies with EADDRINUSE and everyone times out.
   * Retries with a fresh port when the previous one was taken.
   */
  async start(): Promise<void> {
    if (this.proc) return
    if (this.startPromise) return this.startPromise
    this.startPromise = this.doStart()
    try {
      await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  private async doStart(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) this.port = pickPort()
      this.baseUrl = `http://127.0.0.1:${this.port}`
      const proc = spawn(this.binary, [this.entry, this.root], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // `binary` is the Electron executable (process.execPath) inside the app;
        // ELECTRON_RUN_AS_NODE makes it behave like a plain node interpreter
        // for the engine entry script instead of launching a GUI window.
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          INKOS_STUDIO_PORT: String(this.port)
        }
      })
      try {
        await this.bind(proc)
        // Engine restarted (crash) while subscribed — resume the event stream.
        if (this.eventHandler && !this.eventsRunning) void this.connectEvents()
        return
      } catch (error) {
        // The attempt failed (e.g. the port was taken) — make sure the half-started
        // process does not linger before retrying with a fresh port.
        try {
          proc.kill('SIGKILL')
        } catch {
          // already gone
        }
        this.teardown()
        logger.warn(`InkOS engine attempt ${attempt + 1} failed: ${(error as Error).message}`)
      }
    }
    throw new Error(
      `inkos engine failed to start after 3 attempts. Check INKOS_ROOT (${this.entry}) and that the inkos dist build exists.`
    )
  }
  /**
   * Attach process plumbing and wait until the engine HTTP API answers.
   */
  private async bind(proc: ChildProcess): Promise<void> {
    this.proc = proc
    proc.stdout?.on('data', (chunk: Buffer) => logger.debug(`inkos: ${chunk.toString().trimEnd()}`))
    proc.stderr?.on('data', (chunk: Buffer) => logger.debug(`inkos:err: ${chunk.toString().trimEnd()}`))
    proc.on('error', (err) => {
      logger.error('InkOS engine failed to start', err)
      this.teardown()
    })
    proc.on('exit', (code) => {
      logger.info(`InkOS engine exited (code ${code})`)
      this.teardown()
    })
    if (proc.stdout) {
      this.reader = createInterface({ input: proc.stdout })
      this.reader.on('line', (line) => this.onLine(line))
    }
    await this.waitReady()
    logger.info(`InkOS engine ready at ${this.baseUrl} (${this.entry})`)
  }

  /** Issue a REST call against the engine API. */
  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    timeoutMs = 120_000
  ): Promise<T> {
    if (!this.proc) {
      await this.start()
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      })
      const text = await response.text()
      if (!response.ok) {
        if (response.status === 404) throw new NotFoundError(`InkOS 404: ${path}`)
        let message = `InkOS ${method} ${path} failed (${response.status})`
        try {
          const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } }
          if (parsed.error?.code && parsed.error?.message) {
            throw new EngineApiError(parsed.error.code, parsed.error.message)
          }
          if (parsed.error?.message) message = parsed.error.message
        } catch (error) {
          if (error instanceof EngineApiError) throw error
          // keep the generic message
        }
        throw new Error(message)
      }
      if (!text) return undefined as T
      return JSON.parse(text) as T
    } finally {
      clearTimeout(timer)
    }
  }

  /** One-shot SSE subscription — resolves with the first matching event name. */
  async waitForEvent(path: string, eventName: string, timeoutMs = 180_000): Promise<Record<string, unknown>> {
    if (!this.proc) {
      await this.start()
    }
    return new Promise((resolve, reject) => {
      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort()
        reject(new Error(`timeout waiting for engine event '${eventName}'`))
      }, timeoutMs)
      void fetch(`${this.baseUrl}${path}`, { signal: controller.signal }).then((response) => {
        const reader = response.body?.getReader()
        if (!reader) {
          clearTimeout(timer)
          reject(new Error('engine event stream unreadable'))
          return
        }
        const decoder = new TextDecoder()
        let buffer = ''
        const pump = (): void => {
          void reader.read().then(({ done, value }) => {
            if (done) {
              clearTimeout(timer)
              reject(new Error('engine event stream closed before event'))
              return
            }
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.startsWith('event:')) continue
              const name = line.slice(6).trim()
              if (name === eventName) {
                clearTimeout(timer)
                void controller.abort()
                resolve({ name })
                return
              }
            }
            pump()
          })
        }
        pump()
      })
    })
  }

  /**
   * Subscribe to engine events over `/api/v1/events` (SSE). The stream is
   * long-lived with automatic reconnect after drops — engine restarts,
   * workspace switches and transient network errors all self-heal.
   */
  subscribeEvents(handler: EngineEventHandler): void {
    this.eventHandler = handler
    if (this.proc && !this.eventsRunning) void this.connectEvents()
  }

  /** Replace the event handler without tearing down the SSE connection. */
  onEvent(handler: EngineEventHandler | null): void {
    this.eventHandler = handler
  }

  private async connectEvents(): Promise<void> {
    if (this.eventsRunning || !this.proc) return
    this.eventsRunning = true
    this.eventsAbort = new AbortController()
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/events`, { signal: this.eventsAbort.signal })
      if (!response.ok || !response.body) {
        throw new Error(`events endpoint answered ${response.status}`)
      }
      const decoder = new TextDecoder()
      let buffer = ''
      let pendingEvent: string | null = null
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('event:')) {
            pendingEvent = line.slice(6).trim()
          } else if (line.startsWith('data:')) {
            if (!pendingEvent) continue
            let data: unknown
            try {
              data = JSON.parse(line.slice(5).trim())
            } catch {
              data = line.slice(5).trim()
            }
            this.eventHandler?.(pendingEvent, data)
            pendingEvent = null
          }
        }
      }
    } catch (error) {
      if (!this.eventsAbort?.signal.aborted) {
        logger.debug(`InkOS events stream dropped: ${(error as Error).message}`)
      }
    } finally {
      this.eventsRunning = false
      this.eventsAbort = null
      // Reconnect unless the client was stopped or disposed.
      if (this.proc && this.eventHandler && this.eventsRetryTimer === null) {
        this.eventsRetryTimer = setTimeout(() => {
          this.eventsRetryTimer = null
          void this.connectEvents()
        }, EVENTS_RECONNECT_MS)
      }
    }
  }

  /** Terminate the engine process (SIGTERM, then SIGKILL on Windows). */
  stop(): void {
    if (this.eventsRetryTimer) {
      clearTimeout(this.eventsRetryTimer)
      this.eventsRetryTimer = null
    }
    if (this.eventsAbort) {
      this.eventsAbort.abort()
      this.eventsAbort = null
    }
    this.eventHandler = null
    if (!this.proc) return
    const proc = this.proc
    this.proc = null
    try {
      proc.kill('SIGTERM')
    } catch {
      // process already gone
    }
    // Windows: SIGTERM is a no-op for node — force-kill after a grace period.
    setTimeout(() => {
      try {
        if (!proc.killed) proc.kill('SIGKILL')
      } catch {
        // already gone
      }
    }, 1_500).unref()
  }

  /** True once the engine HTTP API answers a health probe. */
  private async waitReady(): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (!this.proc) {
        throw new Error('inkos engine exited before becoming ready')
      }
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/project`, {
          signal: AbortSignal.timeout(2_000)
        })
        if (response.ok) return
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(`inkos engine did not become ready within ${READY_TIMEOUT_MS}ms`)
  }

  private onLine(line: string): void {
    const match = /listening on .*:(\d+)/.exec(line)
    if (match) {
      const port = Number(match[1])
      if (port !== this.port) {
        logger.warn(`InkOS engine bound to port ${port} (expected ${this.port})`)
      }
    }
  }

  private teardown(): void {
    this.proc = null
    this.reader?.close()
    this.reader = null
  }
}

/** Pick a free localhost port for the engine. */
export function pickPort(): number {
  return 45_000 + (randomBytes(2).readUInt16BE(0) % 2_000)
}
