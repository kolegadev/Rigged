// Stub implementation for Socket.IO when socket.io is not available

export interface Socket {
  id: string;
  user?: any;
  on(event: string, callback: Function): void;
  emit(event: string, data: any): void;
  join(room: string): void;
  leave(room: string): void;
  disconnect(): void;
}

export interface ServerIO {
  to(room: string): {
    emit(event: string, data: any): void;
  };
  emit(event: string, data: any): void;
  on(event: string, callback: (socket: Socket) => void): void;
  close(): void;
}

export class Server implements ServerIO {
  constructor(httpServer?: any, options?: any) {
    console.warn('Socket.IO stub: Server created - no real functionality');
  }

  to(room: string) {
    return {
      emit: (event: string, data: any) => {
        console.warn(`Socket.IO stub: TO ${room} EMIT ${event} - no-op`);
      }
    };
  }

  emit(event: string, data: any): void {
    console.warn(`Socket.IO stub: EMIT ${event} - no-op`);
  }

  on(event: string, callback: (socket: Socket) => void): void {
    console.warn(`Socket.IO stub: ON ${event} - no-op`);
  }

  close(): void {
    console.warn('Socket.IO stub: CLOSE - no-op');
  }
}