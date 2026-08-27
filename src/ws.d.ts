declare module 'ws' {
  import { EventEmitter } from 'node:events';
  import { IncomingMessage } from 'node:http';
  import type { Server } from 'node:http';

  class WebSocket extends EventEmitter {
    constructor(address: string | URL, options?: Record<string, unknown>);
    send(data: string | Buffer): void;
    close(code?: number, reason?: string): void;
    ping(data?: Buffer): void;
    readyState: number;
    static CONNECTING: 0;
    static OPEN: 1;
    static CLOSING: 2;
    static CLOSED: 3;
  }

  class WebSocketServer extends EventEmitter {
    constructor(options: { server: Server; path?: string });
    on(event: 'connection', handler: (ws: WebSocket, req: IncomingMessage) => void): this;
    on(event: string, handler: (...args: unknown[]) => void): this;
    clients: Set<WebSocket>;
    close(): void;
  }

  export { WebSocket, WebSocketServer };
  export default WebSocket;
}
