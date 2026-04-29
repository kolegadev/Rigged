import { Redis } from 'ioredis';

// Redis client for the prediction marketplace
let redis_client: Redis | null = null;
let redis_available = false;

export interface RedisConfig {
  host: string;
  port: number;
  db: number;
  password?: string;
  retryDelayOnFailover: number;
  maxRetriesPerRequest: number;
}

function get_redis_connection_options(): { host: string; port: number; db: number; username?: string; password?: string; retryDelayOnFailover: number; maxRetriesPerRequest: number; enableReadyCheck: boolean; lazyConnect: boolean; retryStrategy: () => null } {
  const redis_api = process.env.REDIS_API;
  const redis_db_name = process.env.REDIS_DATABASE_NAME;
  const redis_account_key = process.env.REDIS_API_ACCOUNT_KEY;

  const base_options = {
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy: () => null as null, // Disable auto-reconnect on failure
  };

  // Parse host:port from REDIS_API (e.g. redis-19972.c80.us-east-1-2.ec2.cloud.redislabs.com:19972)
  if (redis_api && !redis_api.includes(' ')) {
    let host = redis_api;
    let port = parseInt(process.env.REDIS_PORT || '6379');
    if (redis_api.includes(':')) {
      const parts = redis_api.split(':');
      host = parts[0];
      port = parseInt(parts[1]) || port;
    }
    return {
      ...base_options,
      host,
      port,
      db: parseInt(process.env.REDIS_DB || '0'),
      // Redis Cloud: REDIS_DATABASE_NAME is the username, REDIS_API_ACCOUNT_KEY is the password
      username: redis_db_name || undefined,
      password: redis_account_key || process.env.REDIS_PASSWORD || undefined,
    };
  }

  // Fallback to individual env vars
  return {
    ...base_options,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    db: parseInt(process.env.REDIS_DB || '0'),
    username: redis_db_name || undefined,
    password: redis_account_key || process.env.REDIS_PASSWORD || undefined,
  };
}

export function create_redis_client(): Redis {
  return new Redis(get_redis_connection_options());
}

export async function connect_to_redis(): Promise<boolean> {
  if (redis_available && redis_client) {
    try {
      await redis_client.ping();
      return true;
    } catch {
      redis_available = false;
      redis_client = null;
    }
  }

  try {
    redis_client = create_redis_client();
    await redis_client.connect();

    const pong = await redis_client.ping();
    if (pong !== 'PONG') {
      throw new Error('Redis ping failed');
    }

    redis_available = true;
    const info = redis_client.options;
    console.log(`✅ Connected to Redis at ${info.host || 'url'}:${info.port || ''}`);
    return true;
  } catch (error) {
    console.warn('⚠️ Redis connection failed, using in-memory fallback:', (error as Error).message);
    redis_client = null;
    redis_available = false;
    return false;
  }
}

export function get_redis(): Redis {
  if (!redis_client || !redis_available) {
    throw new Error('Redis not connected. Call connect_to_redis first.');
  }
  return redis_client;
}

export function is_redis_available(): boolean {
  return redis_available;
}

export async function close_redis_connection(): Promise<void> {
  if (redis_client) {
    await redis_client.quit();
    redis_client = null;
    redis_available = false;
    console.log('🔌 Redis connection closed');
  }
}

// Fallback in-memory cache for when Redis is unavailable
class InMemoryFallback {
  private data = new Map<string, { value: string; expires?: number }>();

  get(key: string): string | null {
    const item = this.data.get(key);
    if (!item) return null;
    if (item.expires && Date.now() > item.expires) {
      this.data.delete(key);
      return null;
    }
    return item.value;
  }

  set(key: string, value: string, ttl?: number): void {
    const expires = ttl ? Date.now() + (ttl * 1000) : undefined;
    this.data.set(key, { value, expires });
  }

  delete(key: string): void {
    this.data.delete(key);
  }

  keys(pattern: string): string[] {
    // Simple pattern matching (exact prefix or *)
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return Array.from(this.data.keys()).filter(k => k.startsWith(prefix));
    }
    return Array.from(this.data.keys()).filter(k => k === pattern);
  }
}

// Cache utilities for the prediction marketplace
export class CacheService {
  private redis: Redis | null = null;
  private fallback: InMemoryFallback;

  constructor(redis_instance?: Redis) {
    this.redis = redis_instance || redis_client;
    this.fallback = new InMemoryFallback();
  }

  private async safe_redis_call<T>(operation: (redis: Redis) => Promise<T>, fallback_value: T): Promise<T> {
    if (!this.redis || !redis_available) return fallback_value;
    try {
      return await operation(this.redis);
    } catch (error) {
      console.warn('Redis operation failed, using fallback:', (error as Error).message);
      return fallback_value;
    }
  }

  // Low-level cache operations
  async get(key: string): Promise<string | null> {
    return this.safe_redis_call(async (redis) => redis.get(key), this.fallback.get(key));
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    return this.safe_redis_call(async (redis) => {
      if (ttl) {
        await redis.setex(key, ttl, value);
      } else {
        await redis.set(key, value);
      }
    }, this.fallback.set(key, value, ttl));
  }

  async delete(key: string): Promise<void> {
    return this.safe_redis_call(async (redis) => {
      await redis.del(key);
    }, this.fallback.delete(key));
  }

  // Market data caching
  async cache_market_data(market_id: string, data: any, ttl: number = 60): Promise<void> {
    const key = `market:${market_id}`;
    await this.set(key, JSON.stringify(data), ttl);
  }

  async get_cached_market_data(market_id: string): Promise<any | null> {
    const key = `market:${market_id}`;
    const data = await this.get(key);
    return data ? JSON.parse(data) : null;
  }

  // Order book caching for real-time updates
  async cache_order_book(market_id: string, outcome_id: string, order_book: any, ttl: number = 30): Promise<void> {
    const key = `orderbook:${market_id}:${outcome_id}`;
    await this.set(key, JSON.stringify(order_book), ttl);
  }

  async get_cached_order_book(market_id: string, outcome_id: string): Promise<any | null> {
    const key = `orderbook:${market_id}:${outcome_id}`;
    const data = await this.get(key);
    return data ? JSON.parse(data) : null;
  }

  // Order book snapshot versioning for historical snapshots
  async save_order_book_snapshot(market_id: string, outcome_id: string, snapshot: any): Promise<void> {
    const key = `orderbook_snapshot:${market_id}:${outcome_id}:${Date.now()}`;
    await this.set(key, JSON.stringify(snapshot), 300); // 5 minute TTL for snapshots
  }

  async get_latest_order_book_snapshot(market_id: string, outcome_id: string): Promise<any | null> {
    // For Redis, we could use a sorted set; for now, just use the regular cache key
    return this.get_cached_order_book(market_id, outcome_id);
  }

  // User session caching
  async cache_user_session(user_id: string, session_data: any, ttl: number = 3600): Promise<void> {
    const key = `session:${user_id}`;
    await this.set(key, JSON.stringify(session_data), ttl);
  }

  async get_cached_user_session(user_id: string): Promise<any | null> {
    const key = `session:${user_id}`;
    const data = await this.get(key);
    return data ? JSON.parse(data) : null;
  }

  async invalidate_user_session(user_id: string): Promise<void> {
    const key = `session:${user_id}`;
    await this.delete(key);
  }

  // Rate limiting using Redis sorted sets (or in-memory fallback)
  async check_rate_limit(
    identifier: string,
    window_seconds: number,
    max_requests: number
  ): Promise<{ allowed: boolean; remaining: number; reset_time: number }> {
    const key = `rate_limit:${identifier}`;
    const current_time = Math.floor(Date.now() / 1000);
    const window_start = current_time - window_seconds;

    return this.safe_redis_call(async (redis) => {
      // Remove expired entries
      await redis.zremrangebyscore(key, 0, window_start);
      // Count current requests
      const current_count = await redis.zcard(key);

      if (current_count >= max_requests) {
        const oldest_request = await redis.zrange(key, 0, 0, 'WITHSCORES');
        const reset_time = oldest_request.length > 0 ? parseInt(oldest_request[1]) + window_seconds : current_time + window_seconds;
        return { allowed: false, remaining: 0, reset_time };
      }

      // Add current request
      await redis.zadd(key, current_time, `${current_time}_${Math.random()}`);
      await redis.expire(key, window_seconds);

      return {
        allowed: true,
        remaining: max_requests - current_count - 1,
        reset_time: current_time + window_seconds
      };
    }, this.fallback_check_rate_limit(identifier, window_seconds, max_requests));
  }

  private fallback_check_rate_limit(
    identifier: string,
    window_seconds: number,
    max_requests: number
  ): { allowed: boolean; remaining: number; reset_time: number } {
    const key = `rate_limit:${identifier}`;
    const current_time = Math.floor(Date.now() / 1000);
    const window_start = current_time - window_seconds;

    // In-memory fallback doesn't track timestamps per request precisely,
    // so we approximate with a simple counter that resets
    const counter_key = `${key}:count`;
    const reset_key = `${key}:reset`;

    const count_str = this.fallback.get(counter_key);
    const reset_str = this.fallback.get(reset_key);
    const reset_time = reset_str ? parseInt(reset_str) : 0;

    if (current_time > reset_time) {
      // Window has reset
      this.fallback.set(counter_key, '1', window_seconds);
      this.fallback.set(reset_key, String(current_time + window_seconds), window_seconds);
      return { allowed: true, remaining: max_requests - 1, reset_time: current_time + window_seconds };
    }

    const count = count_str ? parseInt(count_str) : 0;
    if (count >= max_requests) {
      return { allowed: false, remaining: 0, reset_time };
    }

    this.fallback.set(counter_key, String(count + 1), window_seconds);
    return { allowed: true, remaining: max_requests - count - 1, reset_time };
  }

  // Real-time market updates via pub/sub
  async publish_market_update(market_id: string, update: any): Promise<void> {
    return this.safe_redis_call(async (redis) => {
      const channel = `market_updates:${market_id}`;
      await redis.publish(channel, JSON.stringify({
        market_id,
        timestamp: Date.now(),
        ...update
      }));
    }, undefined);
  }

  async publish_trade_execution(market_id: string, outcome_id: string, trade: any): Promise<void> {
    return this.safe_redis_call(async (redis) => {
      const channel = `trades:${market_id}:${outcome_id}`;
      await redis.publish(channel, JSON.stringify({
        market_id,
        outcome_id,
        timestamp: Date.now(),
        ...trade
      }));
    }, undefined);
  }

  async publish_orderbook_update(market_id: string, outcome_id: string, order_book: any): Promise<void> {
    return this.safe_redis_call(async (redis) => {
      const channel = `orderbook_updates:${market_id}:${outcome_id}`;
      await redis.publish(channel, JSON.stringify({
        market_id,
        outcome_id,
        timestamp: Date.now(),
        ...order_book
      }));
    }, undefined);
  }

  // Leaderboard using sorted sets
  async update_user_score(leaderboard: string, user_id: string, score: number): Promise<void> {
    return this.safe_redis_call(async (redis) => {
      const key = `leaderboard:${leaderboard}`;
      await redis.zadd(key, score, user_id);
      await redis.zremrangebyrank(key, 0, -1001);
    }, undefined);
  }

  async get_leaderboard(leaderboard: string, start: number = 0, end: number = 9): Promise<Array<{ user_id: string; score: number; rank: number }>> {
    return this.safe_redis_call(async (redis) => {
      const key = `leaderboard:${leaderboard}`;
      const results = await redis.zrevrange(key, start, end, 'WITHSCORES');
      const leaderboard_data = [];
      for (let i = 0; i < results.length; i += 2) {
        leaderboard_data.push({
          user_id: results[i],
          score: parseFloat(results[i + 1]),
          rank: start + (i / 2) + 1
        });
      }
      return leaderboard_data;
    }, []);
  }

  async get_user_rank(leaderboard: string, user_id: string): Promise<{ rank: number; score: number } | null> {
    return this.safe_redis_call(async (redis) => {
      const key = `leaderboard:${leaderboard}`;
      const score = await redis.zscore(key, user_id);
      if (score === null) return null;
      const rank = await redis.zrevrank(key, user_id);
      return {
        rank: rank !== null ? rank + 1 : 0,
        score: parseFloat(score)
      };
    }, null);
  }

  // Health check
  async health_check(): Promise<{ status: string; latency_ms: number; memory_usage?: string }> {
    if (!redis_available || !this.redis) {
      return { status: 'fallback', latency_ms: 0 };
    }

    const start = Date.now();
    try {
      const pong = await this.redis.ping();
      const latency = Date.now() - start;

      if (pong !== 'PONG') {
        return { status: 'unhealthy', latency_ms: latency };
      }

      try {
        const info = await this.redis.memory('USAGE', 'used_memory');
        const memory_mb = Math.round(info / 1024 / 1024);
        return { status: 'healthy', latency_ms: latency, memory_usage: `${memory_mb}MB` };
      } catch {
        return { status: 'healthy', latency_ms: latency };
      }
    } catch (error) {
      return { status: 'error', latency_ms: Date.now() - start };
    }
  }
}

// Export global cache service instance
export const cache_service = new CacheService();
