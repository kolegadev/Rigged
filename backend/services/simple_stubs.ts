// Simple stubs to get Sprint 4 matching engine working without Redis/Socket.IO

// Simple cache interface that your services can use
export interface SimpleCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

// In-memory cache implementation  
export class InMemoryCache implements SimpleCache {
  private data = new Map<string, { value: string; expires?: number }>();

  async get(key: string): Promise<string | null> {
    const item = this.data.get(key);
    if (!item) return null;
    if (item.expires && Date.now() > item.expires) {
      this.data.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    const expires = ttl ? Date.now() + (ttl * 1000) : undefined;
    this.data.set(key, { value, expires });
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

// Simple events interface
export interface SimpleEvents {
  emit(event: string, data: any): void;
}

// Console-based events implementation
export class ConsoleEvents implements SimpleEvents {
  emit(event: string, data: any): void {
    console.log(`📡 [${event}]`, JSON.stringify(data, null, 2));
  }
}

// Global instances
export const cache = new InMemoryCache();
export const events = new ConsoleEvents();