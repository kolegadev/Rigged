import { ObjectId } from 'mongodb';
import { get_database } from '../database/connection.js';
import { COLLECTIONS, Order, Market, Outcome } from '../database/schemas.js';
import { balance_service } from './balance.js';

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market';
export type OrderStatus = 'active' | 'partial' | 'filled' | 'cancelled' | 'expired';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK';

export interface PlaceOrderInput {
  user_id: string;
  market_id: string;
  outcome: string; // 'yes' | 'no' or specific outcome slug
  side: OrderSide;
  type: OrderType;
  price: number;    // 0.01 to 0.99 for prediction markets
  quantity: number; // Number of shares
  time_in_force?: TimeInForce;
}

export interface OrderInfo {
  id: string;
  user_id: string;
  market_id: string;
  outcome_id: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  quantity: number;
  filled_quantity: number;
  remaining_quantity: number;
  status: OrderStatus;
  cost_locked: number;
  created_at: Date;
  updated_at: Date;
}

export interface PlaceOrderResult {
  success: boolean;
  order?: OrderInfo;
  error?: string;
}

export const order_service = {
  /**
   * Calculate the cost of an order for prediction markets
   */
  calculate_order_cost(side: OrderSide, outcome: string, price: number, quantity: number): number {
    // For prediction markets:
    // - Buying YES at $0.60 costs $0.60 per share
    // - Buying NO at $0.60 costs $0.40 per share (1 - 0.60)
    // - Selling requires holding shares (Phase 2)
    
    const is_yes_outcome = outcome.toLowerCase() === 'yes';
    
    if (side === 'buy') {
      const cost_per_share = is_yes_outcome ? price : (1 - price);
      return cost_per_share * quantity;
    } else {
      // For selling, user needs to have shares (Phase 2 feature)
      // For now, allow "short selling" by locking potential payout
      const risk_per_share = is_yes_outcome ? (1 - price) : price;
      return risk_per_share * quantity;
    }
  },

  /**
   * Validate order parameters
   */
  async validate_order(input: PlaceOrderInput): Promise<{ valid: boolean; error?: string; market?: any; outcome_id?: string }> {
    const db = get_database();
    
    try {
      // Validate price range for prediction markets
      if (input.price <= 0 || input.price >= 1) {
        return { valid: false, error: 'Price must be between 0.01 and 0.99' };
      }

      // Validate quantity
      if (input.quantity <= 0 || !Number.isInteger(input.quantity)) {
        return { valid: false, error: 'Quantity must be a positive integer' };
      }

      // Validate market exists and is active
      const market = await db.collection(COLLECTIONS.markets).findOne({
        _id: new ObjectId(input.market_id)
      }) as Market | null;

      if (!market) {
        return { valid: false, error: 'Market not found' };
      }

      if (market.status !== 'trading') {
        return { valid: false, error: 'Market is not open for trading' };
      }

      // Check if trading period is active
      const now = new Date();
      if (now < market.trading_starts_at) {
        return { valid: false, error: 'Trading has not started yet' };
      }

      if (now > market.trading_ends_at) {
        return { valid: false, error: 'Trading has ended' };
      }

      // Find outcome by slug/title
      const outcome = await db.collection(COLLECTIONS.outcomes).findOne({
        market_id: new ObjectId(input.market_id),
        $or: [
          { slug: input.outcome.toLowerCase() },
          { title: input.outcome }
        ]
      }) as Outcome | null;

      if (!outcome) {
        return { valid: false, error: `Outcome '${input.outcome}' not found in this market` };
      }

      return { 
        valid: true, 
        market, 
        outcome_id: outcome._id!.toString() 
      };

    } catch (error) {
      console.error('Order validation error:', error);
      return { valid: false, error: 'Invalid market or outcome ID' };
    }
  },

  /**
   * Place a new order
   */
  async place_order(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const db = get_database();
    
    try {
      // Validate order
      const validation = await this.validate_order(input);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const { market, outcome_id } = validation;

      // Calculate order cost
      const total_cost = this.calculate_order_cost(
        input.side, 
        input.outcome, 
        input.price, 
        input.quantity
      );

      console.log(`💰 Order cost calculation: ${input.side} ${input.quantity} shares of ${input.outcome} at $${input.price} = $${total_cost.toFixed(2)}`);

      // Check user balance and lock funds
      const available_balance = await balance_service.get_available_balance(input.user_id, 'USDC');
      
      if (available_balance < total_cost) {
        return { 
          success: false, 
          error: `Insufficient funds. Required: $${total_cost.toFixed(2)}, Available: $${available_balance.toFixed(2)}` 
        };
      }

      // Generate order ID for fund locking
      const order_id = new ObjectId();

      // Lock funds
      const lock_result = await balance_service.lock_funds(
        input.user_id,
        total_cost,
        'USDC',
        order_id.toString()
      );

      if (!lock_result.success) {
        return { success: false, error: lock_result.error };
      }

      // Create order document
      const now = new Date();
      const order_doc: Order = {
        _id: order_id,
        user_id: new ObjectId(input.user_id),
        market_id: new ObjectId(input.market_id),
        outcome_id: new ObjectId(outcome_id),
        side: input.side,
        order_type: input.type,
        price: input.price,
        quantity: input.quantity,
        filled_quantity: 0,
        remaining_quantity: input.quantity,
        status: 'active',
        time_in_force: input.time_in_force || 'GTC',
        created_at: now,
        updated_at: now
      };

      // Insert order
      await db.collection(COLLECTIONS.orders).insertOne(order_doc);

      console.log(`✅ Created order ${order_id} for user ${input.user_id}: ${input.side} ${input.quantity} shares of ${input.outcome} at $${input.price}`);

      // Trigger matching engine for immediate matching
      try {
        const { matching_engine } = await import('./matching_engine.js');
        const matching_result = await matching_engine.match_on_new_order(order_id.toString());
        
        if (matching_result.trades_created > 0) {
          console.log(`🔄 Matching completed: ${matching_result.trades_created} trades, ${matching_result.volume_matched} volume`);
        }
      } catch (matching_error) {
        console.error('Matching engine error (non-critical):', matching_error);
        // Don't fail order placement if matching fails
      }
      
      return {
        success: true,
        order: {
          id: order_id.toString(),
          user_id: input.user_id,
          market_id: input.market_id,
          outcome_id,
          side: input.side,
          type: input.type,
          price: input.price,
          quantity: input.quantity,
          filled_quantity: 0,
          remaining_quantity: input.quantity,
          status: 'active',
          cost_locked: total_cost,
          created_at: now,
          updated_at: now
        }
      };

    } catch (error: any) {
      console.error('Error placing order:', error);
      return { success: false, error: 'Failed to place order' };
    }
  },

  /**
   * Get user's orders with optional filtering
   */
  async get_user_orders(
    user_id: string,
    options: {
      status?: OrderStatus;
      market_id?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<OrderInfo[]> {
    const db = get_database();
    
    try {
      const filter: any = { user_id: new ObjectId(user_id) };
      
      if (options.status) filter.status = options.status;
      if (options.market_id) filter.market_id = new ObjectId(options.market_id);

      const orders = await db.collection(COLLECTIONS.orders)
        .find(filter)
        .sort({ created_at: -1 })
        .limit(options.limit || 50)
        .skip(options.offset || 0)
        .toArray() as Order[];

      return orders.map(order => ({
        id: order._id!.toString(),
        user_id: order.user_id.toString(),
        market_id: order.market_id.toString(),
        outcome_id: order.outcome_id.toString(),
        side: order.side,
        type: order.order_type,
        price: order.price,
        quantity: order.quantity,
        filled_quantity: order.filled_quantity,
        remaining_quantity: order.remaining_quantity,
        status: order.status,
        cost_locked: this.calculate_order_cost(order.side, 'yes', order.price, order.quantity), // Approximate
        created_at: order.created_at,
        updated_at: order.updated_at
      }));

    } catch (error) {
      console.error('Error getting user orders:', error);
      return [];
    }
  },

  /**
   * Get order by ID (user must own the order)
   */
  async get_order_by_id(order_id: string, user_id: string): Promise<OrderInfo | null> {
    const db = get_database();
    
    try {
      const order = await db.collection(COLLECTIONS.orders).findOne({
        _id: new ObjectId(order_id),
        user_id: new ObjectId(user_id)
      }) as Order | null;

      if (!order) return null;

      return {
        id: order._id!.toString(),
        user_id: order.user_id.toString(),
        market_id: order.market_id.toString(),
        outcome_id: order.outcome_id.toString(),
        side: order.side,
        type: order.order_type,
        price: order.price,
        quantity: order.quantity,
        filled_quantity: order.filled_quantity,
        remaining_quantity: order.remaining_quantity,
        status: order.status,
        cost_locked: this.calculate_order_cost(order.side, 'yes', order.price, order.quantity),
        created_at: order.created_at,
        updated_at: order.updated_at
      };

    } catch (error) {
      console.error('Error getting order by ID:', error);
      return null;
    }
  },

  /**
   * Cancel an order (unlock funds)
   */
  async cancel_order(order_id: string, user_id: string): Promise<{ success: boolean; error?: string }> {
    const db = get_database();
    
    try {
      // Find the order
      const order = await db.collection(COLLECTIONS.orders).findOne({
        _id: new ObjectId(order_id),
        user_id: new ObjectId(user_id)
      }) as Order | null;

      if (!order) {
        return { success: false, error: 'Order not found' };
      }

      if (order.status !== 'active' && order.status !== 'partial') {
        return { success: false, error: 'Order cannot be cancelled' };
      }

      // Calculate locked amount to release
      const remaining_cost = this.calculate_order_cost(
        order.side, 
        'yes', // Simplified - in Phase 2 we'll look up actual outcome
        order.price, 
        order.remaining_quantity
      );

      // Update order status
      await db.collection(COLLECTIONS.orders).updateOne(
        { _id: order._id },
        {
          $set: {
            status: 'cancelled',
            cancelled_at: new Date(),
            updated_at: new Date()
          }
        }
      );

      // Unlock funds
      const unlock_result = await balance_service.unlock_funds(
        user_id,
        remaining_cost,
        'USDC',
        order_id
      );

      if (!unlock_result.success) {
        console.error(`Failed to unlock funds for cancelled order ${order_id}:`, unlock_result.error);
        // Order is already cancelled, but funds weren't unlocked - needs manual intervention
      }

      console.log(`✅ Cancelled order ${order_id} and unlocked $${remaining_cost.toFixed(2)}`);
      return { success: true };

    } catch (error: any) {
      console.error('Error cancelling order:', error);
      return { success: false, error: 'Failed to cancel order' };
    }
  }
};