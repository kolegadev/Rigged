import { MiddlewareHandler } from 'hono';
import { cache_service } from '../services/redis.js';
import { Logger } from '../utils/logger.js';

export interface RateLimitConfig {
  window_seconds: number;
  max_requests: number;
  key_prefix?: string;
}

const logger = new Logger('RateLimit');

/**
 * Create a Hono middleware that applies Redis-backed rate limiting.
 * Falls back to in-memory counters if Redis is unavailable.
 */
export function create_rate_limit_middleware(config: RateLimitConfig): MiddlewareHandler {
  return async (c, next) => {
    // Build identifier from IP + optional user ID
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    const user_id = c.get('user_id') || 'anonymous';
    const identifier = `${config.key_prefix || 'api'}:${ip}:${user_id}`;

    try {
      const result = await cache_service.check_rate_limit(
        identifier,
        config.window_seconds,
        config.max_requests
      );

      // Add rate limit headers
      c.header('X-RateLimit-Limit', String(config.max_requests));
      c.header('X-RateLimit-Remaining', String(result.remaining));
      c.header('X-RateLimit-Reset', String(result.reset_time));

      if (!result.allowed) {
        logger.warn(`Rate limit exceeded for ${identifier}`);
        c.header('Retry-After', String(result.reset_time - Math.floor(Date.now() / 1000)));
        return c.json({
          success: false,
          error: 'Rate limit exceeded. Please try again later.'
        }, 429);
      }

      await next();
    } catch (error) {
      logger.error(`Rate limit check failed: ${error}`);
      // Allow request through if rate limiting itself fails
      await next();
    }
  };
}

// Pre-configured rate limiters for common use cases
export const rate_limiters = {
  // Strict limit for order placement (10 orders per minute)
  order_placement: create_rate_limit_middleware({
    window_seconds: 60,
    max_requests: 10,
    key_prefix: 'order'
  }),

  // Moderate limit for authentication endpoints (5 attempts per minute)
  auth: create_rate_limit_middleware({
    window_seconds: 60,
    max_requests: 5,
    key_prefix: 'auth'
  }),

  // Standard API limit (100 requests per minute)
  standard: create_rate_limit_middleware({
    window_seconds: 60,
    max_requests: 100,
    key_prefix: 'api'
  }),

  // Relaxed limit for read-only market data (300 requests per minute)
  market_data: create_rate_limit_middleware({
    window_seconds: 60,
    max_requests: 300,
    key_prefix: 'market'
  }),

  // Admin trigger limit (5 triggers per minute)
  admin_trigger: create_rate_limit_middleware({
    window_seconds: 60,
    max_requests: 5,
    key_prefix: 'admin'
  })
};
