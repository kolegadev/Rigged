import { get_database } from '../database/connection.js';
import { ObjectId } from 'mongodb';
import { COLLECTIONS, Market } from '../database/schemas.js';
import { cache_service } from './redis.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('MarketStatus');

// In-memory cache of last known statuses for transition detection
const status_cache = new Map<string, string>();

export interface MarketStatusTransition {
  market_id: string;
  previous_status: string;
  new_status: string;
  timestamp: Date;
  reason: string;
}

/**
 * Broadcast a market status change via WebSocket and Redis
 */
export async function broadcast_market_status_change(
  transition: MarketStatusTransition
): Promise<void> {
  logger.info(
    `Broadcasting status change for ${transition.market_id}: ${transition.previous_status} -> ${transition.new_status}`
  );

  // Update local cache
  status_cache.set(transition.market_id, transition.new_status);

  // Publish to Redis for cross-service communication
  await cache_service.publish_market_update(transition.market_id, {
    type: 'market_status_change',
    ...transition,
    timestamp: transition.timestamp.getTime()
  });

  // Broadcast directly via WebSocket if available
  try {
    const { get_websocket_service } = await import('./websocket.js');
    const ws = get_websocket_service();
    await ws.notify_market_update(transition.market_id, {
      market_id: transition.market_id,
      type: 'market_status_change',
      data: transition,
      timestamp: transition.timestamp.getTime()
    });
  } catch {
    // WebSocket may not be initialized in tests
  }
}

/**
 * Check for time-based market status transitions and apply them
 */
export async function check_and_transition_markets(): Promise<MarketStatusTransition[]> {
  const db = get_database();
  const transitions: MarketStatusTransition[] = [];
  const now = new Date();

  try {
    // Find published markets that should transition to trading
    const markets_to_activate = await db
      .collection<Market>(COLLECTIONS.markets)
      .find({
        status: 'published',
        trading_starts_at: { $lte: now }
      })
      .toArray();

    for (const market of markets_to_activate) {
      const market_id = market._id!.toString();
      const previous_status = market.status;

      await db.collection<Market>(COLLECTIONS.markets).updateOne(
        { _id: market._id },
        { $set: { status: 'trading', updated_at: now } }
      );

      const transition: MarketStatusTransition = {
        market_id,
        previous_status,
        new_status: 'trading',
        timestamp: now,
        reason: 'trading_period_started'
      };

      await broadcast_market_status_change(transition);
      transitions.push(transition);
      logger.info(`Auto-transitioned market ${market_id} to trading`);
    }

    // Find trading markets that should transition to resolved (trading ended)
    // Note: In production, this would transition to 'awaiting_resolution' or similar
    // For MVP, we auto-resolve to demonstrate the status pipeline
    const markets_to_resolve = await db
      .collection<Market>(COLLECTIONS.markets)
      .find({
        status: 'trading',
        trading_ends_at: { $lte: now }
      })
      .toArray();

    for (const market of markets_to_resolve) {
      const market_id = market._id!.toString();
      const previous_status = market.status;

      await db.collection<Market>(COLLECTIONS.markets).updateOne(
        { _id: market._id },
        { $set: { status: 'resolved', updated_at: now } }
      );

      const transition: MarketStatusTransition = {
        market_id,
        previous_status,
        new_status: 'resolved',
        timestamp: now,
        reason: 'trading_period_ended'
      };

      await broadcast_market_status_change(transition);
      transitions.push(transition);
      logger.info(`Auto-transitioned market ${market_id} to resolved`);
    }

    // Detect external/manual status changes by comparing cache to DB
    const active_market_ids = Array.from(status_cache.keys());
    if (active_market_ids.length > 0) {
      const cached_markets = await db
        .collection<Market>(COLLECTIONS.markets)
        .find({
          _id: { $in: active_market_ids.map(id => new ObjectId(id)) }
        })
        .toArray();

      for (const market of cached_markets) {
        const market_id = market._id!.toString();
        const cached_status = status_cache.get(market_id);
        if (cached_status && cached_status !== market.status) {
          const transition: MarketStatusTransition = {
            market_id,
            previous_status: cached_status,
            new_status: market.status,
            timestamp: now,
            reason: 'manual_status_change'
          };
          await broadcast_market_status_change(transition);
          transitions.push(transition);
          logger.info(`Detected manual status change for ${market_id}: ${cached_status} -> ${market.status}`);
        }
      }
    }
  } catch (error) {
    logger.error('Error checking market transitions:', error);
  }

  return transitions;
}

/**
 * Initialize the status cache with current market statuses
 */
export async function initialize_status_cache(): Promise<void> {
  const db = get_database();
  const markets = await db
    .collection<Market>(COLLECTIONS.markets)
    .find({}, { projection: { status: 1 } })
    .toArray();

  for (const market of markets) {
    status_cache.set(market._id!.toString(), market.status);
  }

  logger.info(`Initialized status cache with ${status_cache.size} markets`);
}

let status_check_interval: NodeJS.Timeout | null = null;

/**
 * Start the periodic market status checker
 */
export function start_market_status_checker(interval_ms: number = 30000): void {
  if (status_check_interval) {
    logger.warn('Market status checker already running');
    return;
  }

  logger.info(`Starting market status checker (interval: ${interval_ms}ms)`);

  // Run immediately
  check_and_transition_markets().catch(err => logger.error('Initial status check failed:', err));

  status_check_interval = setInterval(() => {
    check_and_transition_markets().catch(err => logger.error('Periodic status check failed:', err));
  }, interval_ms);
}

/**
 * Stop the periodic market status checker
 */
export function stop_market_status_checker(): void {
  if (status_check_interval) {
    clearInterval(status_check_interval);
    status_check_interval = null;
    logger.info('Market status checker stopped');
  }
}

/**
 * Manually set market status and broadcast (for admin actions)
 */
export async function set_market_status(
  market_id: string,
  new_status: Market['status'],
  reason: string
): Promise<MarketStatusTransition> {
  const db = get_database();

  const market = await db.collection<Market>(COLLECTIONS.markets).findOne({
    _id: new ObjectId(market_id)
  });

  if (!market) {
    throw new Error(`Market not found: ${market_id}`);
  }

  const previous_status = market.status;

  await db.collection<Market>(COLLECTIONS.markets).updateOne(
    { _id: market._id },
    { $set: { status: new_status, updated_at: new Date() } }
  );

  const transition: MarketStatusTransition = {
    market_id,
    previous_status,
    new_status,
    timestamp: new Date(),
    reason
  };

  await broadcast_market_status_change(transition);
  return transition;
}
