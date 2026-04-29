import { get_database } from '../database/connection.js';
import { ObjectId, ClientSession } from 'mongodb';
import { Logger } from '../utils/logger.js';
import { events } from './simple_stubs.js';

export interface Position {
  _id?: ObjectId;
  user_id: ObjectId;
  market_id: ObjectId;
  outcome_id: ObjectId;
  quantity: number; // Net position (can be negative)
  average_price: number; // Volume-weighted average price
  total_cost: number; // Total amount paid/received for this position
  realized_pnl: number; // Profit/loss from closed positions
  unrealized_pnl: number; // Current mark-to-market P&L
  created_at: Date;
  updated_at: Date;
}

export interface TradePositionUpdate {
  user_id: ObjectId;
  market_id: ObjectId;
  outcome_id: ObjectId;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  trade_cost: number;
}

export interface PositionSummary {
  user_id: string;
  market_id: string;
  total_positions: number;
  total_unrealized_pnl: number;
  total_realized_pnl: number;
  positions: {
    outcome_id: string;
    quantity: number;
    average_price: number;
    current_price: number | null;
    unrealized_pnl: number;
    market_value: number;
  }[];
}

export const create_position_engine = () => {
  const logger = new Logger('PositionEngine');

  /**
   * Update user positions after a trade
   * This is called after each trade execution to maintain accurate position tracking
   */
  const update_positions_from_trade = async (
    buyer_update: TradePositionUpdate,
    seller_update: TradePositionUpdate,
    session?: ClientSession
  ): Promise<void> => {
    logger.debug(`Updating positions from trade: buyer +${buyer_update.quantity}, seller -${seller_update.quantity}`);

    try {
      // Update buyer position (they bought outcome tokens)
      await update_single_position({
        ...buyer_update,
        side: 'BUY'
      }, session);

      // Update seller position (they sold outcome tokens)
      await update_single_position({
        ...seller_update,
        side: 'SELL'
      }, session);

      logger.debug('Position updates completed successfully');
    } catch (error) {
      logger.error(`Failed to update positions from trade: ${error}`);
      throw error;
    }
  };

  /**
   * Update a single user's position for a specific outcome
   * Handles position netting and average price calculation
   */
  const update_single_position = async (
    update: TradePositionUpdate,
    session?: ClientSession
  ): Promise<void> => {
    const { user_id, market_id, outcome_id, side, quantity, price, trade_cost } = update;
    const db = get_database();

    // Get current position
    const existing_position = await db.collection('positions').findOne({
      user_id,
      market_id,
      outcome_id
    }, { session }) as Position | null;

    if (!existing_position) {
      // Create new position
      const new_position: Position = {
        user_id,
        market_id,
        outcome_id,
        quantity: side === 'BUY' ? quantity : -quantity,
        average_price: price,
        total_cost: side === 'BUY' ? trade_cost : -trade_cost,
        realized_pnl: 0,
        unrealized_pnl: 0,
        created_at: new Date(),
        updated_at: new Date()
      };

      await db.collection('positions').insertOne(new_position, { session });
      logger.debug(`Created new position for user ${user_id}: ${new_position.quantity} @ ${price}`);
    } else {
      // Update existing position
      const trade_quantity = side === 'BUY' ? quantity : -quantity;
      const new_quantity = existing_position.quantity + trade_quantity;

      let new_average_price = existing_position.average_price;
      let new_total_cost = existing_position.total_cost;
      let new_realized_pnl = existing_position.realized_pnl;

      if (new_quantity === 0) {
        // Position closed completely
        new_realized_pnl = existing_position.total_cost + (side === 'BUY' ? -trade_cost : trade_cost);
        new_average_price = 0;
        new_total_cost = 0;
        logger.debug(`Position closed for user ${user_id}, realized P&L: ${new_realized_pnl}`);
      } else if (Math.sign(new_quantity) === Math.sign(existing_position.quantity)) {
        // Adding to existing position (same direction)
        new_total_cost = existing_position.total_cost + (side === 'BUY' ? trade_cost : -trade_cost);
        new_average_price = Math.abs(new_total_cost / new_quantity);
        logger.debug(`Added to position for user ${user_id}: ${new_quantity} @ avg ${new_average_price}`);
      } else {
        // Reducing position (opposite direction) - realize some P&L
        const quantity_closed = Math.min(Math.abs(existing_position.quantity), quantity);
        const pnl_per_unit = (side === 'SELL' ? price : -price) - 
                           (existing_position.quantity > 0 ? existing_position.average_price : -existing_position.average_price);
        const realized_pnl_from_trade = pnl_per_unit * quantity_closed;
        
        new_realized_pnl = existing_position.realized_pnl + realized_pnl_from_trade;
        new_total_cost = existing_position.total_cost + (side === 'BUY' ? trade_cost : -trade_cost);
        
        if (new_quantity !== 0) {
          new_average_price = Math.abs(new_total_cost / new_quantity);
        } else {
          new_average_price = 0;
          new_total_cost = 0;
        }

        logger.debug(`Reduced position for user ${user_id}: ${new_quantity} @ avg ${new_average_price}, realized P&L: ${realized_pnl_from_trade}`);
      }

      // Update the position
      await db.collection('positions').updateOne(
        { user_id, market_id, outcome_id },
        {
          $set: {
            quantity: new_quantity,
            average_price: new_average_price,
            total_cost: new_total_cost,
            realized_pnl: new_realized_pnl,
            updated_at: new Date()
          }
        },
        { session }
      );
    }
  };

  /**
   * Calculate unrealized P&L for all positions based on current market prices
   */
  const calculate_unrealized_pnl = async (user_id?: string, market_id?: string): Promise<void> => {
    logger.debug(`Calculating unrealized P&L for user: ${user_id}, market: ${market_id}`);

    const db = get_database();
    const filter: any = {};
    if (user_id) filter.user_id = new ObjectId(user_id);
    if (market_id) filter.market_id = new ObjectId(market_id);

    // Get all positions to update
    const positions = await db.collection('positions').find(filter).toArray() as Position[];

    for (const position of positions) {
      if (position.quantity === 0) {
        // No unrealized P&L for closed positions
        continue;
      }

      try {
        // Get current market price for this outcome
        const current_price = await get_current_market_price(
          position.market_id.toString(),
          position.outcome_id.toString()
        );

        if (current_price !== null) {
          // Calculate unrealized P&L
          const market_value = current_price * Math.abs(position.quantity);
          const unrealized_pnl = position.quantity > 0 
            ? (current_price - position.average_price) * position.quantity
            : (position.average_price - current_price) * Math.abs(position.quantity);

          // Update position with current P&L
          await db.collection('positions').updateOne(
            { _id: position._id },
            {
              $set: {
                unrealized_pnl,
                updated_at: new Date()
              }
            }
          );

          logger.debug(`Updated P&L for position ${position._id}: ${unrealized_pnl}`);
        }
      } catch (error) {
        logger.error(`Failed to calculate P&L for position ${position._id}: ${error}`);
      }
    }
  };

  /**
   * Get current market price for an outcome (mid-price from order book)
   */
  const get_current_market_price = async (market_id: string, outcome_id: string): Promise<number | null> => {
    try {
      // Import here to avoid circular dependency
      const { order_book_service } = await import('./order_book.js');
      const bbo = await order_book_service.get_best_bid_offer(market_id, outcome_id);
      return bbo.mid_price;
    } catch (error) {
      logger.warn(`Could not get market price for ${market_id}:${outcome_id}: ${error}`);
      return null;
    }
  };

  /**
   * Get all positions for a user
   */
  const get_user_positions = async (user_id: string, market_id?: string): Promise<Position[]> => {
    const db = get_database();
    const filter: any = { 
      user_id: new ObjectId(user_id),
      quantity: { $ne: 0 } // Only return non-zero positions
    };

    if (market_id) {
      filter.market_id = new ObjectId(market_id);
    }

    const positions = await db.collection('positions')
      .find(filter)
      .sort({ updated_at: -1 })
      .toArray() as Position[];

    return positions;
  };

  /**
   * Get position summary with current market values
   */
  const get_position_summary = async (user_id: string, market_id?: string): Promise<PositionSummary[]> => {
    const positions = await get_user_positions(user_id, market_id);
    
    // Group positions by market
    const position_groups = positions.reduce((acc, position) => {
      const market_key = position.market_id.toString();
      if (!acc[market_key]) {
        acc[market_key] = [];
      }
      acc[market_key].push(position);
      return acc;
    }, {} as { [market_id: string]: Position[] });

    const summaries: PositionSummary[] = [];

    for (const [marketId, marketPositions] of Object.entries(position_groups)) {
      const position_details = [];
      let total_unrealized_pnl = 0;
      let total_realized_pnl = 0;

      for (const position of marketPositions) {
        const current_price = await get_current_market_price(
          position.market_id.toString(),
          position.outcome_id.toString()
        );

        const market_value = current_price ? current_price * Math.abs(position.quantity) : 0;
        total_unrealized_pnl += position.unrealized_pnl;
        total_realized_pnl += position.realized_pnl;

        position_details.push({
          outcome_id: position.outcome_id.toString(),
          quantity: position.quantity,
          average_price: position.average_price,
          current_price,
          unrealized_pnl: position.unrealized_pnl,
          market_value
        });
      }

      summaries.push({
        user_id,
        market_id: marketId,
        total_positions: marketPositions.length,
        total_unrealized_pnl,
        total_realized_pnl,
        positions: position_details
      });
    }

    return summaries;
  };

  /**
   * Get aggregated position statistics across all users for a market
   */
  const get_market_position_stats = async (market_id: string): Promise<{
    total_open_interest: number;
    positions_by_outcome: { [outcome_id: string]: { long: number; short: number; net: number } };
    top_positions: { user_id: string; total_exposure: number; pnl: number }[];
  }> => {
    const db = get_database();

    // Get all non-zero positions for this market
    const positions = await db.collection('positions').find({
      market_id: new ObjectId(market_id),
      quantity: { $ne: 0 }
    }).toArray() as Position[];

    // Calculate statistics
    const positions_by_outcome: { [outcome_id: string]: { long: number; short: number; net: number } } = {};
    const user_exposures: { [user_id: string]: { exposure: number; pnl: number } } = {};
    let total_open_interest = 0;

    for (const position of positions) {
      const outcome_key = position.outcome_id.toString();
      const user_key = position.user_id.toString();

      // Track by outcome
      if (!positions_by_outcome[outcome_key]) {
        positions_by_outcome[outcome_key] = { long: 0, short: 0, net: 0 };
      }

      if (position.quantity > 0) {
        positions_by_outcome[outcome_key].long += position.quantity;
      } else {
        positions_by_outcome[outcome_key].short += Math.abs(position.quantity);
      }
      positions_by_outcome[outcome_key].net += position.quantity;

      // Track by user
      if (!user_exposures[user_key]) {
        user_exposures[user_key] = { exposure: 0, pnl: 0 };
      }
      user_exposures[user_key].exposure += Math.abs(position.quantity * position.average_price);
      user_exposures[user_key].pnl += position.realized_pnl + position.unrealized_pnl;

      // Total open interest
      total_open_interest += Math.abs(position.quantity);
    }

    // Get top positions by exposure
    const top_positions = Object.entries(user_exposures)
      .map(([user_id, data]) => ({
        user_id,
        total_exposure: data.exposure,
        pnl: data.pnl
      }))
      .sort((a, b) => b.total_exposure - a.total_exposure)
      .slice(0, 10);

    return {
      total_open_interest,
      positions_by_outcome,
      top_positions
    };
  };

  /**
   * Broadcast position updates to users via WebSocket
   */
  const broadcast_position_update = async (user_id: string, market_id: string): Promise<void> => {
    try {
      const summary = await get_position_summary(user_id, market_id);
      
      events.emit('position_update', {
        user_id,
        market_id,
        summary: summary[0] || null
      });

      logger.debug(`Broadcasted position update to user ${user_id}`);
    } catch (error) {
      logger.error(`Failed to broadcast position update: ${error}`);
    }
  };

  return {
    update_positions_from_trade,
    update_single_position,
    calculate_unrealized_pnl,
    get_user_positions,
    get_position_summary,
    get_market_position_stats,
    broadcast_position_update
  };
};

// Export singleton instance
export const position_engine = create_position_engine();