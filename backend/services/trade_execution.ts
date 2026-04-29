import { get_database } from '../database/connection.js';
import { ObjectId, ClientSession } from 'mongodb';
import { Trade } from '../database/schemas.js';
import { balance_service } from './balance.js';
import { events } from './simple_stubs.js';
import { Logger } from '../utils/logger.js';

export interface TradeExecutionRequest {
  buy_order: {
    _id: ObjectId;
    user_id: ObjectId;
    market_id: ObjectId;
    outcome_id: ObjectId;
    price: number;
    remaining_quantity: number;
    filled_quantity?: number;
  };
  sell_order: {
    _id: ObjectId;
    user_id: ObjectId;
    market_id: ObjectId;
    outcome_id: ObjectId;
    price: number;
    remaining_quantity: number;
    filled_quantity?: number;
  };
  trade_price: number;
  trade_quantity: number;
}

export interface TradeExecutionResult {
  success: boolean;
  trade_id?: ObjectId;
  error?: string;
  buyer_fill?: number;
  seller_fill?: number;
}

export const create_trade_execution_service = () => {
  const logger = new Logger('TradeExecution');

  /**
   * Execute a trade between two orders with full atomicity
   * This is the core function that creates trade records and updates all related data
   */
  const execute_trade = async (request: TradeExecutionRequest): Promise<TradeExecutionResult> => {
    const { buy_order, sell_order, trade_price, trade_quantity } = request;

    logger.info(`Executing trade: ${trade_quantity} @ ${trade_price} between orders ${buy_order._id} and ${sell_order._id}`);

    const db = get_database();
    const client = db.client;
    const session = client.startSession();

    try {
      let trade_id: ObjectId;
      
      // Start transaction for atomicity
      await session.withTransaction(async (session_ctx: ClientSession) => {
        // 1. Create the trade record
        const trade_record: Omit<Trade, '_id'> = {
          buyer_order_id: buy_order._id,
          seller_order_id: sell_order._id,
          buyer_user_id: buy_order.user_id,
          seller_user_id: sell_order.user_id,
          market_id: buy_order.market_id,
          outcome_id: buy_order.outcome_id,
          price: trade_price,
          quantity: trade_quantity,
          buyer_cost: trade_price * trade_quantity,
          seller_payout: trade_price * trade_quantity,
          settlement_status: 'pending',
          timestamp: new Date()
        };

        const trade_result = await db.collection('trades').insertOne(trade_record, { session: session_ctx });
        trade_id = trade_result.insertedId;

        logger.debug(`Created trade record ${trade_id}`);

        // 2. Update buy order
        const new_buy_filled = (buy_order.filled_quantity || 0) + trade_quantity;
        const new_buy_remaining = buy_order.remaining_quantity - trade_quantity;
        const buy_status = new_buy_remaining === 0 ? 'filled' : 'partial';

        await db.collection('orders').updateOne(
          { _id: buy_order._id },
          {
            $set: {
              filled_quantity: new_buy_filled,
              remaining_quantity: new_buy_remaining,
              status: buy_status,
              updated_at: new Date()
            }
          },
          { session: session_ctx }
        );

        logger.debug(`Updated buy order ${buy_order._id}: filled=${new_buy_filled}, remaining=${new_buy_remaining}, status=${buy_status}`);

        // 3. Update sell order  
        const new_sell_filled = (sell_order.filled_quantity || 0) + trade_quantity;
        const new_sell_remaining = sell_order.remaining_quantity - trade_quantity;
        const sell_status = new_sell_remaining === 0 ? 'filled' : 'partial';

        await db.collection('orders').updateOne(
          { _id: sell_order._id },
          {
            $set: {
              filled_quantity: new_sell_filled,
              remaining_quantity: new_sell_remaining,
              status: sell_status,
              updated_at: new Date()
            }
          },
          { session: session_ctx }
        );

        logger.debug(`Updated sell order ${sell_order._id}: filled=${new_sell_filled}, remaining=${new_sell_remaining}, status=${sell_status}`);

        // 4. Handle fund transfers
        await execute_fund_transfers({
          trade_record: { ...trade_record, _id: trade_id },
          session: session_ctx
        });

        // 5. Update positions (will be called after transaction commits)
        // Note: Position updates happen outside transaction to avoid deadlocks

        logger.info(`Trade ${trade_id} executed successfully`);
      });

      // Post-transaction operations (non-atomic but important)
      await post_trade_operations(request, trade_id!);

      return {
        success: true,
        trade_id: trade_id!,
        buyer_fill: (buy_order.filled_quantity || 0) + trade_quantity,
        seller_fill: (sell_order.filled_quantity || 0) + trade_quantity
      };

    } catch (error) {
      logger.error(`Trade execution failed: ${error}`);
      return {
        success: false,
        error: `Trade execution failed: ${error}`
      };
    } finally {
      await session.endSession();
    }
  };

  /**
   * Handle fund transfers between buyer and seller
   * In prediction markets, this involves moving locked funds from buyer to seller
   */
  const execute_fund_transfers = async ({
    trade_record,
    session
  }: {
    trade_record: Trade;
    session: ClientSession;
  }): Promise<void> => {
    const { buyer_user_id, seller_user_id, seller_payout } = trade_record;

    logger.debug(`Executing fund transfers: buyer pays ${trade_record.buyer_cost}, seller receives ${seller_payout}`);

    // For prediction markets:
    // - Buyer's locked funds are transferred to seller as payout
    // - Buyer receives the outcome tokens (tracked in positions)
    // - Seller loses outcome tokens and receives USDC

    try {
      // Transfer from buyer to seller
      // Note: buyer's funds were already locked when order was placed
      await balance_service.transfer_funds(
        buyer_user_id.toString(),
        seller_user_id.toString(),
        seller_payout,
        'USDC',
        trade_record._id!.toString()
      );

      logger.debug(`Funds transferred: ${seller_payout} USDC from ${buyer_user_id} to ${seller_user_id}`);

    } catch (error) {
      logger.error(`Fund transfer failed: ${error}`);
      throw error; // This will cause the transaction to rollback
    }
  };

  /**
   * Post-trade operations that happen after the main transaction
   * These include position updates and real-time notifications
   */
  const post_trade_operations = async (request: TradeExecutionRequest, trade_id: ObjectId): Promise<void> => {
    const { buy_order, sell_order, trade_price, trade_quantity } = request;

    try {
      // 1. Update positions (outside of main transaction to avoid deadlocks)
      const { position_engine } = await import('./position_engine.js');
      
      await position_engine.update_positions_from_trade(
        {
          user_id: buy_order.user_id,
          market_id: buy_order.market_id,
          outcome_id: buy_order.outcome_id,
          side: 'BUY',
          quantity: trade_quantity,
          price: trade_price,
          trade_cost: trade_price * trade_quantity
        },
        {
          user_id: sell_order.user_id,
          market_id: sell_order.market_id,
          outcome_id: sell_order.outcome_id,
          side: 'SELL',
          quantity: trade_quantity,
          price: trade_price,
          trade_cost: trade_price * trade_quantity
        }
      );
      
      // 2. Broadcast trade execution via WebSocket
      const trade_event = {
        type: 'trade_executed',
        data: {
          market_id: buy_order.market_id.toString(),
          outcome_id: buy_order.outcome_id.toString(),
          price: trade_price,
          quantity: trade_quantity,
          timestamp: Date.now(),
          buyer_user_id: buy_order.user_id.toString(),
          seller_user_id: sell_order.user_id.toString()
        }
      };

      events.emit('trade_executed', trade_event.data);
      events.emit('order_filled', {
        user_id: buy_order.user_id.toString(),
        order_id: buy_order._id.toString(),
        fill_quantity: trade_quantity,
        fill_price: trade_price,
        remaining_quantity: buy_order.remaining_quantity - trade_quantity
      });
      events.emit('order_filled', {
        user_id: sell_order.user_id.toString(),
        order_id: sell_order._id.toString(),
        fill_quantity: trade_quantity,
        fill_price: trade_price,
        remaining_quantity: sell_order.remaining_quantity - trade_quantity
      });

      logger.debug(`Post-trade operations completed for trade between ${buy_order._id} and ${sell_order._id}`);

    } catch (error) {
      logger.error(`Post-trade operations failed (non-critical): ${error}`);
      // Don't throw - these operations are nice-to-have but shouldn't fail the trade
    }
  };

  /**
   * Get trade history for a user
   */
  const get_user_trades = async (user_id: string, market_id?: string, limit: number = 50): Promise<Trade[]> => {
    const db = get_database();
    const filter: any = {
      $or: [
        { buyer_user_id: new ObjectId(user_id) },
        { seller_user_id: new ObjectId(user_id) }
      ]
    };

    if (market_id) {
      filter.market_id = new ObjectId(market_id);
    }

    const trades = await db.collection('trades')
      .find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray() as Trade[];

    return trades;
  };

  /**
   * Get trade history for a market
   */
  const get_market_trades = async (market_id: string, outcome_id?: string, limit: number = 100): Promise<Trade[]> => {
    const db = get_database();
    const filter: any = { market_id: new ObjectId(market_id) };

    if (outcome_id) {
      filter.outcome_id = new ObjectId(outcome_id);
    }

    const trades = await db.collection('trades')
      .find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray() as Trade[];

    return trades;
  };

  /**
   * Get recent trades for real-time display
   */
  const get_recent_trades = async (market_id: string, outcome_id: string, limit: number = 20): Promise<{
    price: number;
    quantity: number;
    timestamp: number;
    side: 'buy' | 'sell'; // From the perspective of the price taker
  }[]> => {
    const trades = await get_market_trades(market_id, outcome_id, limit);
    
    return trades.map(trade => ({
      price: trade.price,
      quantity: trade.quantity,
      timestamp: trade.timestamp.getTime(),
      side: 'buy' // In prediction markets, we could determine this based on order timestamps
    }));
  };

  /**
   * Calculate volume statistics for a market
   */
  const get_trade_statistics = async (market_id: string, outcome_id?: string): Promise<{
    total_volume: number;
    trade_count: number;
    average_price: number;
    price_range: { min: number; max: number };
    last_trade_price: number | null;
    volume_24h: number;
  }> => {
    const db = get_database();
    const filter: any = { market_id: new ObjectId(market_id) };
    
    if (outcome_id) {
      filter.outcome_id = new ObjectId(outcome_id);
    }

    // Get all trades for statistics
    const trades = await db.collection('trades').find(filter).toArray() as Trade[];
    
    if (trades.length === 0) {
      return {
        total_volume: 0,
        trade_count: 0,
        average_price: 0,
        price_range: { min: 0, max: 0 },
        last_trade_price: null,
        volume_24h: 0
      };
    }

    // Calculate statistics
    const total_volume = trades.reduce((sum, trade) => sum + trade.quantity, 0);
    const prices = trades.map(trade => trade.price);
    const average_price = trades.reduce((sum, trade) => sum + trade.price * trade.quantity, 0) / total_volume;
    
    // 24h volume
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent_trades = trades.filter(trade => trade.timestamp > twentyFourHoursAgo);
    const volume_24h = recent_trades.reduce((sum, trade) => sum + trade.quantity, 0);

    return {
      total_volume,
      trade_count: trades.length,
      average_price,
      price_range: {
        min: Math.min(...prices),
        max: Math.max(...prices)
      },
      last_trade_price: trades.length > 0 ? trades[0].price : null,
      volume_24h
    };
  };

  return {
    execute_trade,
    execute_fund_transfers,
    get_user_trades,
    get_market_trades,
    get_recent_trades,
    get_trade_statistics
  };
};

// Export singleton instance
export const trade_execution_service = create_trade_execution_service();
