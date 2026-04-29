// import { Redis } from 'ioredis';
import { Redis } from './redis_stub.js';

// Redis client for the prediction marketplace
let redis_client: Redis | null = null;

export interface RedisConfig {
  host: string;
  port: number;
  db: number;
  password?: string;
  retryDelayOnFailover: number;
  maxRetriesPerRequest: number;
}

const DEFAULT_CONFIG: RedisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  db: parseInt(process.env.REDIS_DB || '0'),
  password: process.env.REDIS_PASSWORD,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3
};

export function create_redis_client(config: Partial<RedisConfig> = {}): Redis {
  const final_config = { ...DEFAULT_CONFIG, ...config };
  
  return new Redis();
}

export async function connect_to_redis(): Promise<Redis> {
  if (redis_client && redis_client.status === 'ready') {
    return redis_client;
  }

  redis_client = create_redis_client();

  try {
    await redis_client.connect();
    console.log(`✅ Connected to Redis at ${DEFAULT_CONFIG.host}:${DEFAULT_CONFIG.port}`);
    
    // Test the connection
    const pong = await redis_client.ping();
    if (pong !== 'PONG') {
      throw new Error('Redis ping failed');
    }

    return redis_client;
  } catch (error) {
    console.error('❌ Failed to connect to Redis:', error);
    redis_client = null;
    throw error;
  }
}

export function get_redis(): Redis {
  if (!redis_client || redis_client.status !== 'ready') {
    throw new Error('Redis not connected. Call connect_to_redis first.');
  }
  return redis_client;
}

export async function close_redis_connection(): Promise<void> {
  if (redis_client) {
    await redis_client.quit();
    redis_client = null;
    console.log('🔌 Redis connection closed');
  }
}

// Cache utilities for the prediction marketplace
export class CacheService {
  private redis: Redis;

  constructor(redis_instance?: Redis) {
    this.redis = redis_instance || get_redis();
  }

  // Market data caching
  async cache_market_data(market_id: string, data: any, ttl: number = 60): Promise<void> {
    const key = `market:${market_id}`;
    await this.redis.setex(key, ttl, JSON.stringify(data));
  }

  async get_cached_market_data(market_id: string): Promise<any | null> {
    const key = `market:${market_id}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  // Order book caching for real-time updates
  async cache_order_book(market_id: string, outcome_id: string, order_book: any): Promise<void> {
    const key = `orderbook:${market_id}:${outcome_id}`;
    await this.redis.setex(key, 30, JSON.stringify(order_book));
  }

  async get_cached_order_book(market_id: string, outcome_id: string): Promise<any | null> {
    const key = `orderbook:${market_id}:${outcome_id}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  // User session caching
  async cache_user_session(user_id: string, session_data: any, ttl: number = 3600): Promise<void> {
    const key = `session:${user_id}`;
    await this.redis.setex(key, ttl, JSON.stringify(session_data));
  }

  async get_cached_user_session(user_id: string): Promise<any | null> {
    const key = `session:${user_id}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async invalidate_user_session(user_id: string): Promise<void> {
    const key = `session:${user_id}`;
    await this.redis.del(key);
  }

  // Rate limiting
  async check_rate_limit(identifier: string, window_seconds: number, max_requests: number): Promise<{ allowed: boolean; remaining: number; reset_time: number }> {
    const key = `rate_limit:${identifier}`;
    const current_time = Math.floor(Date.now() / 1000);
    const window_start = current_time - window_seconds;

    // Remove expired entries
    await this.redis.zremrangebyscore(key, 0, window_start);
    
    // Count current requests
    const current_count = await this.redis.zcard(key);
    
    if (current_count >= max_requests) {
      const oldest_request = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
      const reset_time = oldest_request.length > 0 ? parseInt(oldest_request[1]) + window_seconds : current_time + window_seconds;
      
      return {
        allowed: false,
        remaining: 0,
        reset_time
      };
    }

    // Add current request
    await this.redis.zadd(key, current_time, `${current_time}_${Math.random()}`);
    await this.redis.expire(key, window_seconds);

    return {
      allowed: true,
      remaining: max_requests - current_count - 1,
      reset_time: current_time + window_seconds
    };
  }

  // Real-time market updates via pub/sub
  async publish_market_update(market_id: string, update: any): Promise<void> {
    const channel = `market_updates:${market_id}`;
    await this.redis.publish(channel, JSON.stringify({
      market_id,
      timestamp: Date.now(),
      ...update
    }));
  }

  async publish_trade_execution(market_id: string, outcome_id: string, trade: any): Promise<void> {
    const channel = `trades:${market_id}:${outcome_id}`;
    await this.redis.publish(channel, JSON.stringify({
      market_id,
      outcome_id,
      timestamp: Date.now(),
      ...trade
    }));
  }

  // Leaderboard using sorted sets
  async update_user_score(leaderboard: string, user_id: string, score: number): Promise<void> {
    const key = `leaderboard:${leaderboard}`;
    await this.redis.zadd(key, score, user_id);
    
    // Keep only top 1000 users
    await this.redis.zremrangebyrank(key, 0, -1001);
  }

  async get_leaderboard(leaderboard: string, start: number = 0, end: number = 9): Promise<Array<{ user_id: string; score: number; rank: number }>> {
    const key = `leaderboard:${leaderboard}`;
    const results = await this.redis.zrevrange(key, start, end, 'WITHSCORES');
    
    const leaderboard_data = [];
    for (let i = 0; i < results.length; i += 2) {
      leaderboard_data.push({
        user_id: results[i],
        score: parseFloat(results[i + 1]),
        rank: start + (i / 2) + 1
      });
    }
    
    return leaderboard_data;
  }

  async get_user_rank(leaderboard: string, user_id: string): Promise<{ rank: number; score: number } | null> {
    const key = `leaderboard:${leaderboard}`;
    const score = await this.redis.zscore(key, user_id);
    
    if (score === null) {
      return null;
    }

    const rank = await this.redis.zrevrank(key, user_id);
    return {
      rank: rank !== null ? rank + 1 : 0,
      score: parseFloat(score)
    };
  }

  // Health check
  async health_check(): Promise<{ status: string; latency_ms: number; memory_usage?: string }> {
    const start = Date.now();
    
    try {
      const pong = await this.redis.ping();
      const latency = Date.now() - start;
      
      if (pong !== 'PONG') {
        return { status: 'unhealthy', latency_ms: latency };
      }

      // Get memory info if available
      try {
        const info = await this.redis.memory('usage', 'used_memory');
        const memory_mb = Math.round(info / 1024 / 1024);
        
        return {
          status: 'healthy',
          latency_ms: latency,
          memory_usage: `${memory_mb}MB`
        };
      } catch {
        return {
          status: 'healthy',
          latency_ms: latency
        };
      }
    } catch (error) {
      return {
        status: 'error',
        latency_ms: Date.now() - start
      };
    }
  }
}

// Export global cache service instance
export const cache_service = new CacheService();

// Add missing methods to CacheService
cache_service.get = async (key: string): Promise<string | null> => {
  return await cache_service['redis'].get(key);
};

cache_service.set = async (key: string, value: string, ttl?: number): Promise<void> => {
  if (ttl) {
    await cache_service['redis'].setex(key, ttl, value);
  } else {
    await cache_service['redis'].set(key, value);
  }
};

cache_service.delete = async (key: string): Promise<void> => {
  await cache_service['redis'].del(key);
};