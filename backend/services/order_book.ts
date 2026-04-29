import { get_database } from '../database/connection.js';
import { ObjectId } from 'mongodb';
import { cache, events } from './simple_stubs.js';
import { Logger } from '../utils/logger.js';

export interface OrderBookLevel {
  price: number;
  quantity: number;
  order_count: number;
}

export interface OrderBook {
  market_id: string;
  outcome_id: string;
  bids: OrderBookLevel[]; // Buy orders, highest price first
  asks: OrderBookLevel[]; // Sell orders, lowest price first  
  best_bid: number | null;
  best_ask: number | null;
  spread: number | null;
  last_updated: Date;
}

export interface OrderBookSnapshot {
  market_id: string;
  outcome_id: string;
  bids: { price: number; size: number }[];
  asks: { price: number; size: number }[];
  timestamp: number;
}

export const create_order_book_service = () => {
  const logger = new Logger('OrderBook');
  const CACHE_TTL = 60; // Cache order books for 60 seconds
  const MAX_LEVELS = 10; // Maximum price levels to show in order book

  /**
   * Build order book from database orders
   * Aggregates orders by price level and sorts appropriately
   */
  const build_order_book = async (market_id: string, outcome_id: string): Promise<OrderBook> => {
    logger.debug(`Building order book for market ${market_id}, outcome ${outcome_id}`);

    const db = get_database();
    
    // Aggregate buy orders by price level
    const buy_levels = await db.collection('orders').aggregate([
      {
        $match: {
          market_id: new ObjectId(market_id),
          outcome_id: new ObjectId(outcome_id),
          side: 'buy',
          status: { $in: ['active', 'partial'] },
          remaining_quantity: { $gt: 0 }
        }
      },
      {
        $group: {
          _id: '$price',
          quantity: { $sum: '$remaining_quantity' },
          order_count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: -1 } // Highest price first for bids
      },
      {
        $limit: MAX_LEVELS
      },
      {
        $project: {
          price: '$_id',
          quantity: 1,
          order_count: 1,
          _id: 0
        }
      }
    ]).toArray() as OrderBookLevel[];

    // Aggregate sell orders by price level
    const sell_levels = await db.collection('orders').aggregate([
      {
        $match: {
          market_id: new ObjectId(market_id),
          outcome_id: new ObjectId(outcome_id),
          side: 'sell',
          status: { $in: ['active', 'partial'] },
          remaining_quantity: { $gt: 0 }
        }
      },
      {
        $group: {
          _id: '$price',
          quantity: { $sum: '$remaining_quantity' },
          order_count: { $sum: 1 }
        }
      },
      {
        $sort: { _id: 1 } // Lowest price first for asks
      },
      {
        $limit: MAX_LEVELS
      },
      {
        $project: {
          price: '$_id',
          quantity: 1,
          order_count: 1,
          _id: 0
        }
      }
    ]).toArray() as OrderBookLevel[];

    // Calculate best bid/ask and spread
    const best_bid = buy_levels.length > 0 ? buy_levels[0].price : null;
    const best_ask = sell_levels.length > 0 ? sell_levels[0].price : null;
    const spread = (best_bid && best_ask) ? best_ask - best_bid : null;

    const order_book: OrderBook = {
      market_id,
      outcome_id,
      bids: buy_levels,
      asks: sell_levels,
      best_bid,
      best_ask,
      spread,
      last_updated: new Date()
    };

    logger.debug(`Built order book: ${buy_levels.length} bid levels, ${sell_levels.length} ask levels, spread: ${spread}`);
    return order_book;
  };

  /**
   * Get order book from cache or build fresh
   */
  const get_order_book = async (market_id: string, outcome_id: string): Promise<OrderBook> => {
    const cache_key = `order_book:${market_id}:${outcome_id}`;

    try {
      // Try to get from Redis cache first
      const cached = await cache.get(cache_key);
      if (cached) {
        logger.debug(`Order book cache hit for ${cache_key}`);
        return JSON.parse(cached);
      }
    } catch (error) {
      logger.warn(`Redis cache error: ${error}`);
    }

    // Build fresh order book
    const order_book = await build_order_book(market_id, outcome_id);

    try {
      // Cache the result
      await cache.set(cache_key, JSON.stringify(order_book), CACHE_TTL);
      logger.debug(`Cached order book for ${cache_key}`);
    } catch (error) {
      logger.warn(`Failed to cache order book: ${error}`);
    }

    return order_book;
  };

  /**
   * Refresh order book and broadcast updates
   * Called after trades are executed or orders are placed/cancelled
   */
  const refresh_order_book = async (market_id: string, outcome_id: string): Promise<void> => {
    logger.debug(`Refreshing order book for market ${market_id}, outcome ${outcome_id}`);

    try {
      // Clear cache to force rebuild
      const cache_key = `order_book:${market_id}:${outcome_id}`;
      await cache.delete(cache_key);

      // Build fresh order book
      const order_book = await get_order_book(market_id, outcome_id);

      // Broadcast update via WebSocket
      const snapshot: OrderBookSnapshot = {
        market_id,
        outcome_id,
        bids: order_book.bids.map(level => ({
          price: level.price,
          size: level.quantity
        })),
        asks: order_book.asks.map(level => ({
          price: level.price,
          size: level.quantity
        })),
        timestamp: Date.now()
      };

      events.emit('order_book_update', { market_id, ...snapshot });

      logger.debug(`Order book refreshed and broadcasted for ${market_id}:${outcome_id}`);
    } catch (error) {
      logger.error(`Failed to refresh order book: ${error}`);
    }
  };

  /**
   * Get market depth - cumulative quantities at each price level
   */
  const get_market_depth = async (market_id: string, outcome_id: string, levels: number = 5): Promise<{
    bids: { price: number; cumulative_quantity: number }[];
    asks: { price: number; cumulative_quantity: number }[];
  }> => {
    const order_book = await get_order_book(market_id, outcome_id);

    // Calculate cumulative depths for bids (highest to lowest price)
    let cumulative_bid_quantity = 0;
    const bid_depths = order_book.bids.slice(0, levels).map(level => {
      cumulative_bid_quantity += level.quantity;
      return {
        price: level.price,
        cumulative_quantity: cumulative_bid_quantity
      };
    });

    // Calculate cumulative depths for asks (lowest to highest price)  
    let cumulative_ask_quantity = 0;
    const ask_depths = order_book.asks.slice(0, levels).map(level => {
      cumulative_ask_quantity += level.quantity;
      return {
        price: level.price,
        cumulative_quantity: cumulative_ask_quantity
      };
    });

    return {
      bids: bid_depths,
      asks: ask_depths
    };
  };

  /**
   * Get best bid and offer (BBO) for quick price reference
   */
  const get_best_bid_offer = async (market_id: string, outcome_id: string): Promise<{
    best_bid: number | null;
    best_ask: number | null;
    spread: number | null;
    mid_price: number | null;
  }> => {
    const order_book = await get_order_book(market_id, outcome_id);
    
    const mid_price = (order_book.best_bid && order_book.best_ask) 
      ? (order_book.best_bid + order_book.best_ask) / 2 
      : null;

    return {
      best_bid: order_book.best_bid,
      best_ask: order_book.best_ask,
      spread: order_book.spread,
      mid_price
    };
  };

  /**
   * Get all order books for a market (all outcomes)
   */
  const get_market_order_books = async (market_id: string): Promise<{ [outcome_id: string]: OrderBook }> => {
    const db = get_database();
    
    // Find all outcomes with active orders for this market
    const active_outcomes = await db.collection('orders').distinct('outcome_id', {
      market_id: new ObjectId(market_id),
      status: { $in: ['active', 'partial'] },
      remaining_quantity: { $gt: 0 }
    });

    const order_books: { [outcome_id: string]: OrderBook } = {};

    for (const outcome_id of active_outcomes) {
      try {
        order_books[outcome_id.toString()] = await get_order_book(market_id, outcome_id.toString());
      } catch (error) {
        logger.error(`Failed to get order book for ${market_id}:${outcome_id}: ${error}`);
      }
    }

    logger.debug(`Retrieved ${Object.keys(order_books).length} order books for market ${market_id}`);
    return order_books;
  };

  /**
   * Cache warming - preload order books for active markets
   */
  const warm_cache = async (market_ids?: string[]): Promise<void> => {
    logger.info('Warming order book cache');

    const db = get_database();
    
    let markets_to_warm = market_ids;
    if (!markets_to_warm) {
      // Get all markets with active orders
      markets_to_warm = await db.collection('orders').distinct('market_id', {
        status: { $in: ['active', 'partial'] },
        remaining_quantity: { $gt: 0 }
      }).then(ids => ids.map(id => id.toString()));
    }

    for (const market_id of markets_to_warm) {
      try {
        await get_market_order_books(market_id);
        logger.debug(`Warmed cache for market ${market_id}`);
      } catch (error) {
        logger.error(`Failed to warm cache for market ${market_id}: ${error}`);
      }
    }

    logger.info(`Cache warming complete for ${markets_to_warm.length} markets`);
  };

  /**
   * Clean up stale order book caches
   */
  const cleanup_cache = async (): Promise<void> => {
    logger.info('Cache cleanup not implemented - order book caches will expire naturally');
    // TODO: Implement Redis SCAN pattern matching when needed
  };

  return {
    build_order_book,
    get_order_book,
    refresh_order_book,
    get_market_depth,
    get_best_bid_offer,
    get_market_order_books,
    warm_cache,
    cleanup_cache
  };
};

// Export singleton instance
export const order_book_service = create_order_book_service();