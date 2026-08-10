import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'

import { loggerService } from '@logger'

const logger = loggerService.withContext('NovelEngineClient')

/** One JSON-RPC response received from the engine. */
interface RpcResponse {
  id: number
  result?: unknown
  error?: { code?: number; message?: string }
}

export interface ToolCallResult {
  /** Tool result text — a JSON document for structured tools, an error message for failures. */
  text: string
  isError: boolean
}

interface PendingCall {
  resolve: (value: RpcResponse) => void
  reject: (reason: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Minimal JSON-RPC 2.0 / NDJSON client over the reasonix-novel engine's `mcp`
 * stdio channel (VISION §7.1/§7.2). The engine is a separate process that owns
 * every working-tree write; this host-side client only issues tool calls.
 * Lazily spawned per workspace; killed on dispose.
 */
export class NovelEngineClient {
  private proc: ChildProcessWithoutNullStreams | null = null
  private reader: Interface | null = null
  private nextId = 1
  private pending = new Map<number, PendingCall>()

  constructor(
    private readonly binary: string,
    private readonly root: string
  ) {}

  get running(): boolean {
    return this.proc !== null
  }

  /** Spawn the engine and complete the initialize handshake. */
  async start(): Promise<void> {
    if (this.proc) return
    const proc = spawn(this.binary, ['mcp', '--root', this.root], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.proc = proc
    proc.stderr.on('data', (chunk: Buffer) => logger.debug(`engine: ${chunk.toString().trimEnd()}`))
    proc.on('error', (err) => {
      logger.error('Novel engine failed to start', err)
      this.failAllPending(new Error(`novel engine failed to start: ${err.message}`))
    })
    proc.on('exit', (code) => {
      logger.info(`Novel engine exited (code ${code})`)
      this.failAllPending(new Error(`novel engine exited (code ${code})`))
      this.teardown()
    })
    this.reader = createInterface({ input: proc.stdout })
    this.reader.on('line', (line) => this.onLine(line))
    await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {} })
    logger.info(`Novel engine ready (${this.binary})`)
  }

  /** Call a named engine tool with the given arguments; resolves with the tool's text output. */
  async callTool(name: string, args: Record<string, unknown>, timeoutMs = 120_000): Promise<ToolCallResult> {
    if (!this.proc) {
      await this.start()
    }
    const response = await this.request('tools/call', { name, arguments: args }, timeoutMs)
    const result = response.result as
      | { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
      | undefined
    const text = result?.content?.find((part) => part.type === 'text')?.text ?? ''
    return { text, isError: result?.isError ?? false }
  }

  /** Terminate the engine process and clear all state. */
  stop(): void {
    this.failAllPending(new Error('novel engine stopped'))
    this.teardown()
    if (this.proc) {
      this.proc.kill()
      this.proc = null
    }
  }

  private teardown(): void {
    this.reader?.close()
    this.reader = null
  }

  private request(method: string, params: unknown, timeoutMs = 30_000): Promise<RpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.proc || !this.proc.stdin.writable) {
        reject(new Error('novel engine not running'))
        return
      }
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`novel engine request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  private onLine(line: string): void {
    let message: RpcResponse
    try {
      message = JSON.parse(line) as RpcResponse
    } catch {
      logger.warn(`Ignoring non-JSON engine line: ${line.slice(0, 200)}`)
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (message.error) {
      pending.reject(new Error(message.error.message ?? `engine error ${message.error.code}`))
    } else {
      pending.resolve(message)
    }
  }

  private failAllPending(reason: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(reason)
    }
    this.pending.clear()
  }
}
