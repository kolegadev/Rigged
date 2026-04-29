// Stub implementation for Redis when ioredis is not available

export class Redis {
  public status: string = 'ready';

  constructor() {
    // No-op constructor
  }

  async connect(): Promise<void> {
    console.warn('Redis stub: CONNECT - no-op');
  }

  async get(key: string): Promise<string | null> {
    console.warn(`Redis stub: GET ${key} - returning null`);
    return null;
  }

  async set(key: string, value: string): Promise<void> {
    console.warn(`Redis stub: SET ${key} - no-op`);
  }

  async setex(key: string, ttl: number, value: string): Promise<void> {
    console.warn(`Redis stub: SETEX ${key} ${ttl} - no-op`);
  }

  async del(key: string): Promise<void> {
    console.warn(`Redis stub: DEL ${key} - no-op`);
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async quit(): Promise<void> {
    console.warn('Redis stub: QUIT - no-op');
  }

  async memory(usage: string, memory_type: string): Promise<number> {
    return 1024 * 1024; // 1MB
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    console.warn(`Redis stub: ZADD ${key} ${score} ${member} - no-op`);
  }

  async zremrangebyrank(key: string, start: number, stop: number): Promise<void> {
    console.warn(`Redis stub: ZREMRANGEBYRANK ${key} ${start} ${stop} - no-op`);
  }

  async zrevrange(key: string, start: number, stop: number, withScores?: string): Promise<string[]> {
    console.warn(`Redis stub: ZREVRANGE ${key} ${start} ${stop} - returning empty array`);
    return [];
  }

  async publish(channel: string, message: string): Promise<void> {
    console.warn(`Redis stub: PUBLISH ${channel} - no-op`);
  }

  async subscribe(channel: string): Promise<void> {
    console.warn(`Redis stub: SUBSCRIBE ${channel} - no-op`);
  }

  async punsubscribe(): Promise<void> {
    console.warn('Redis stub: PUNSUBSCRIBE - no-op');
  }

  on(event: string, callback: Function): void {
    console.warn(`Redis stub: ON ${event} - no-op`);
  }

  async expire(key: string, seconds: number): Promise<void> {
    console.warn(`Redis stub: EXPIRE ${key} ${seconds} - no-op`);
  }

  async zremrangebyscore(key: string, min: string, max: string): Promise<void> {
    console.warn(`Redis stub: ZREMRANGEBYSCORE ${key} ${min} ${max} - no-op`);
  }

  async zcard(key: string): Promise<number> {
    console.warn(`Redis stub: ZCARD ${key} - returning 0`);
    return 0;
  }

  async zrange(key: string, start: number, stop: number, withScores?: string): Promise<string[]> {
    console.warn(`Redis stub: ZRANGE ${key} ${start} ${stop} - returning empty array`);
    return [];
  }

  async zscore(key: string, member: string): Promise<string | null> {
    console.warn(`Redis stub: ZSCORE ${key} ${member} - returning null`);
    return null;
  }

  async zrevrank(key: string, member: string): Promise<number | null> {
    console.warn(`Redis stub: ZREVRANK ${key} ${member} - returning null`);
    return null;
  }

  duplicate(): Redis {
    console.warn('Redis stub: DUPLICATE - returning new instance');
    return new Redis();
  }
}