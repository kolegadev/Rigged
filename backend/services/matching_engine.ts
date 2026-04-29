import { get_database } from '../database/connection.js';
import { ObjectId } from 'mongodb';
import { create_trade_execution_service } from './trade_execution.js';
import { create_order_book_service } from './order_book.js';
import { cache_service } from './redis.js';
import { Logger } from '../utils/logger.js';

export interface MatchingResult {
  trades_created: number;
  volume_matched: number;
  orders_filled: string[];
  orders_partially_filled: string[];
}

export interface Order {
  _id: ObjectId;
  user_id: ObjectId;
  market_id: ObjectId;
  outcome_id: ObjectId;
  side: 'buy' | 'sell';
  order_type: 'market' | 'limit';
  price: number;
  original_quantity: number;
  filled_quantity: number;
  remaining_quantity: number;
  status: 'active' | 'filled' | 'cancelled' | 'partial';
  created_at: Date;
  updated_at: Date;
}

export interface Trade {
  buyer_order_id: ObjectId;
  seller_order_id: ObjectId;
  buyer_user_id: ObjectId;
  seller_user_id: ObjectId;
  market_id: ObjectId;
  outcome_id: ObjectId;
  price: number;
  quantity: number;
  buyer_cost: number;
  seller_payout: number;
  timestamp: Date;
}

export const create_matching_engine = () => {
  const logger = new Logger('MatchingEngine');
  const trade_execution = create_trade_execution_service();
  const order_book = create_order_book_service();

  /**
   * Main matching algorithm - implements price-time priority
   * 1. Find all active orders for the market/outcome
   * 2. Separate into buy/sell sides
   * 3. Sort by price priority, then time priority
   * 4. Match overlapping orders
   * 5. Execute trades atomically
   */
  const match_market = async (market_id: string, outcome_id: string): Promise<MatchingResult> => {
    logger.info(`Starting matching for market ${market_id}, outcome ${outcome_id}`);

    const result: MatchingResult = {
      trades_created: 0,
      volume_matched: 0,
      orders_filled: [],
      orders_partially_filled: []
    };

    try {
      const db = get_database();
      const orders_collection = db.collection('orders');

      // Get all active orders for this market/outcome
      const active_orders = await orders_collection.find({
        market_id: new ObjectId(market_id),
        outcome_id: new ObjectId(outcome_id),
        status: { $in: ['active', 'partial'] },
        remaining_quantity: { $gt: 0 }
      }).toArray() as Order[];

      if (active_orders.length < 2) {
        logger.debug(`Not enough orders to match: ${active_orders.length}`);
        return result;
      }

      // Separate into buy and sell orders
      const buy_orders = active_orders
        .filter(order => order.side === 'buy')
        .sort((a, b) => {
          // Price priority: highest price first for buys
          if (a.price !== b.price) return b.price - a.price;
          // Time priority: earliest first
          return a.created_at.getTime() - b.created_at.getTime();
        });

      const sell_orders = active_orders
        .filter(order => order.side === 'sell')
        .sort((a, b) => {
          // Price priority: lowest price first for sells
          if (a.price !== b.price) return a.price - b.price;
          // Time priority: earliest first
          return a.created_at.getTime() - b.created_at.getTime();
        });

      logger.debug(`Found ${buy_orders.length} buy orders, ${sell_orders.length} sell orders`);

      // Execute matching algorithm
      let buy_index = 0;
      let sell_index = 0;

      while (buy_index < buy_orders.length && sell_index < sell_orders.length) {
        const buy_order = buy_orders[buy_index];
        const sell_order = sell_orders[sell_index];

        // Check if orders can match (buy price >= sell price)
        if (buy_order.price < sell_order.price) {
          break; // No more matches possible
        }

        // Calculate trade details
        const trade_quantity = Math.min(buy_order.remaining_quantity, sell_order.remaining_quantity);
        const trade_price = determine_trade_price(buy_order, sell_order);

        logger.debug(`Matching orders: buy ${buy_order._id} @ ${buy_order.price} vs sell ${sell_order._id} @ ${sell_order.price}, trade @ ${trade_price} for ${trade_quantity}`);

        // Execute the trade
        const trade_result = await trade_execution.execute_trade({
          buy_order,
          sell_order,
          trade_price,
          trade_quantity
        });

        if (trade_result.success) {
          result.trades_created++;
          result.volume_matched += trade_quantity;

          // Update order tracking
          if (buy_order.remaining_quantity === trade_quantity) {
            result.orders_filled.push(buy_order._id.toString());
          } else {
            result.orders_partially_filled.push(buy_order._id.toString());
          }

          if (sell_order.remaining_quantity === trade_quantity) {
            result.orders_filled.push(sell_order._id.toString());
          } else {
            result.orders_partially_filled.push(sell_order._id.toString());
          }

          // Update remaining quantities for continued matching
          buy_order.remaining_quantity -= trade_quantity;
          sell_order.remaining_quantity -= trade_quantity;

          logger.info(`Trade executed: ${trade_quantity} @ ${trade_price} between users ${buy_order.user_id} and ${sell_order.user_id}`);
        } else {
          logger.error(`Trade execution failed: ${trade_result.error}`);
          break; // Stop matching on execution failure
        }

        // Move to next orders if current ones are fully filled
        if (buy_order.remaining_quantity === 0) buy_index++;
        if (sell_order.remaining_quantity === 0) sell_index++;
      }

      // Update order book after matching
      await order_book.refresh_order_book(market_id, outcome_id);

      // Publish matching complete event (task 4.12)
      await cache_service.publish_market_update(market_id, {
        type: 'matching_complete',
        outcome_id,
        trades_created: result.trades_created,
        volume_matched: result.volume_matched,
        orders_filled: result.orders_filled.length,
        orders_partially_filled: result.orders_partially_filled.length
      });

      // Also broadcast directly via WebSocket for redundancy (task 4.16)
      try {
        const { get_websocket_service } = await import('./websocket.js');
        const ws = get_websocket_service();
        await ws.notify_market_update(market_id, {
          market_id,
          type: 'matching_complete',
          data: {
            trades_created: result.trades_created,
            volume_matched: result.volume_matched,
            orders_filled: result.orders_filled.length,
            orders_partially_filled: result.orders_partially_filled.length,
            outcome_id
          },
          timestamp: Date.now()
        });
      } catch {
        // WebSocket may not be initialized in tests
      }

      logger.info(`Matching complete: ${result.trades_created} trades, ${result.volume_matched} volume`);
      return result;

    } catch (error) {
      logger.error(`Matching engine error: ${error}`);
      throw error;
    }
  };

  /**
   * Determine trade price using price-time priority rules
   * In prediction markets, trade price is typically the price of the earlier order
   */
  const determine_trade_price = (buy_order: Order, sell_order: Order): number => {
    // Use the price of whichever order was placed first (time priority)
    if (buy_order.created_at <= sell_order.created_at) {
      return buy_order.price;
    } else {
      return sell_order.price;
    }
  };

  /**
   * Trigger matching for all active markets
   * Used for batch processing or system recovery
   */
  const match_all_markets = async (): Promise<{ [market_outcome: string]: MatchingResult }> => {
    logger.info('Starting match_all_markets');

    const db = get_database();
    const results: { [market_outcome: string]: MatchingResult } = {};

    try {
      // Find all unique market/outcome combinations with active orders
      const active_combinations = await db.collection('orders').aggregate([
        {
          $match: {
            status: { $in: ['active', 'partial'] },
            remaining_quantity: { $gt: 0 }
          }
        },
        {
          $group: {
            _id: {
              market_id: '$market_id',
              outcome_id: '$outcome_id'
            },
            order_count: { $sum: 1 }
          }
        },
        {
          $match: {
            order_count: { $gte: 2 } // Only match if there are at least 2 orders
          }
        }
      ]).toArray();

      logger.info(`Found ${active_combinations.length} market/outcome combinations to match`);

      for (const combo of active_combinations) {
        const market_id = combo._id.market_id.toString();
        const outcome_id = combo._id.outcome_id.toString();
        const key = `${market_id}:${outcome_id}`;

        try {
          results[key] = await match_market(market_id, outcome_id);
        } catch (error) {
          logger.error(`Failed to match ${key}: ${error}`);
          results[key] = {
            trades_created: 0,
            volume_matched: 0,
            orders_filled: [],
            orders_partially_filled: []
          };
        }
      }

      return results;
    } catch (error) {
      logger.error(`match_all_markets error: ${error}`);
      throw error;
    }
  };

  /**
   * Match orders immediately after a new order is placed
   * This is the primary entry point for real-time matching
   */
  const match_on_new_order = async (order_id: string): Promise<MatchingResult> => {
    logger.info(`Matching triggered by new order: ${order_id}`);

    const db = get_database();

    // Get the order that was just placed
    const new_order = await db.collection('orders').findOne({
      _id: new ObjectId(order_id)
    }) as Order | null;

    if (!new_order) {
      throw new Error(`Order ${order_id} not found`);
    }

    // Trigger matching for this market/outcome
    return await match_market(
      new_order.market_id.toString(),
      new_order.outcome_id.toString()
    );
  };

  return {
    match_market,
    match_all_markets,
    match_on_new_order,
    determine_trade_price
  };
};

// Export singleton instance
export const matching_engine = create_matching_engine();
