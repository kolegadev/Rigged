import { get_database } from '../database/connection.js';
import { ObjectId } from 'mongodb';
import { COLLECTIONS, Order, Trade, Position, UserBalance, LedgerEntry } from '../database/schemas.js';
import { Logger } from '../utils/logger.js';

export interface OrderReconciliationResult {
  order_id: string;
  status: string;
  filled_quantity: number;
  remaining_quantity: number;
  expected_filled: number;
  actual_filled: number;
  discrepancy: number;
  is_valid: boolean;
}

export interface BalanceReconciliationResult {
  user_id: string;
  currency: string;
  recorded_available: number;
  recorded_locked: number;
  recorded_total: number;
  ledger_sum: number;
  ledger_available_sum: number;
  ledger_locked_sum: number;
  discrepancy: number;
  is_valid: boolean;
}

export interface PositionReconciliationResult {
  user_id: string;
  market_id: string;
  outcome_id: string;
  recorded_quantity: number;
  expected_quantity: number;
  discrepancy: number;
  is_valid: boolean;
}

export interface ReconciliationReport {
  timestamp: Date;
  orders_checked: number;
  orders_valid: number;
  orders_invalid: number;
  order_results: OrderReconciliationResult[];
  balances_checked: number;
  balances_valid: number;
  balances_invalid: number;
  balance_results: BalanceReconciliationResult[];
  positions_checked: number;
  positions_valid: number;
  positions_invalid: number;
  position_results: PositionReconciliationResult[];
  summary: {
    total_discrepancies: number;
    critical_issues: number;
    warnings: number;
  };
}

export const create_reconciliation_service = () => {
  const logger = new Logger('Reconciliation');

  /**
   * Reconcile a single order against its related trades
   * Verifies that order.filled_quantity == sum(trades.quantity)
   */
  const reconcile_order = async (order_id: string): Promise<OrderReconciliationResult> => {
    const db = get_database();

    try {
      const order = await db.collection(COLLECTIONS.orders)
        .findOne({ _id: new ObjectId(order_id) }) as Order | null;

      if (!order) {
        return {
          order_id,
          status: 'not_found',
          filled_quantity: 0,
          remaining_quantity: 0,
          expected_filled: 0,
          actual_filled: 0,
          discrepancy: 0,
          is_valid: false
        };
      }

      // Find all trades where this order is either buyer or seller
      const trades = await db.collection(COLLECTIONS.trades)
        .find({
          $or: [
            { buyer_order_id: order._id },
            { seller_order_id: order._id }
          ]
        })
        .toArray() as Trade[];

      const actual_filled = trades.reduce((sum, trade) => sum + trade.quantity, 0);
      const discrepancy = actual_filled - order.filled_quantity;

      const is_valid =
        Math.abs(discrepancy) < 0.0001 &&
        (order.status === 'filled' ? order.remaining_quantity === 0 : true) &&
        (order.status === 'cancelled' ? true : order.filled_quantity + order.remaining_quantity === order.quantity);

      return {
        order_id: order._id.toString(),
        status: order.status,
        filled_quantity: order.filled_quantity,
        remaining_quantity: order.remaining_quantity,
        expected_filled: order.filled_quantity,
        actual_filled,
        discrepancy,
        is_valid
      };
    } catch (error) {
      logger.error(`Failed to reconcile order ${order_id}: ${error}`);
      return {
        order_id,
        status: 'error',
        filled_quantity: 0,
        remaining_quantity: 0,
        expected_filled: 0,
        actual_filled: 0,
        discrepancy: 0,
        is_valid: false
      };
    }
  };

  /**
   * Reconcile all orders for a market
   */
  const reconcile_market_orders = async (market_id: string): Promise<OrderReconciliationResult[]> => {
    const db = get_database();

    const orders = await db.collection(COLLECTIONS.orders)
      .find({ market_id: new ObjectId(market_id) })
      .toArray() as Order[];

    const results: OrderReconciliationResult[] = [];
    for (const order of orders) {
      const result = await reconcile_order(order._id!.toString());
      results.push(result);
    }

    return results;
  };

  /**
   * Reconcile user balance against ledger entries
   * Verifies that balance.total == sum(ledger.amount) + initial_balance
   */
  const reconcile_user_balance = async (user_id: string): Promise<BalanceReconciliationResult[]> => {
    const db = get_database();

    const balances = await db.collection(COLLECTIONS.user_balances)
      .find({ user_id: new ObjectId(user_id) })
      .toArray() as UserBalance[];

    const results: BalanceReconciliationResult[] = [];

    for (const balance of balances) {
      // Get all ledger entries for this user and currency
      const ledger_entries = await db.collection(COLLECTIONS.ledger_entries)
        .find({ user_id: new ObjectId(user_id), currency: balance.currency })
        .sort({ created_at: 1 })
        .toArray() as LedgerEntry[];

      // Separate ledger entries by impact on available vs locked
      // trade entries with negative amount reduce available (lock)
      // trade entries with positive amount increase available (unlock/transfer in)
      const ledger_available_sum = ledger_entries.reduce((sum, entry) => {
        // For simplicity, all 'trade' entries in our system affect available balance
        // lock = negative available, unlock/transfer in = positive available
        return sum + entry.amount;
      }, 0);

      // Total balance should equal sum of all ledger movements
      // We can't perfectly derive available/locked split from ledger alone without
      // tracking state transitions, so we verify total balance consistency
      const recorded_total = balance.total_balance;
      const discrepancy = ledger_available_sum - recorded_total;

      results.push({
        user_id,
        currency: balance.currency,
        recorded_available: balance.available_balance,
        recorded_locked: balance.locked_balance,
        recorded_total,
        ledger_sum: ledger_available_sum,
        ledger_available_sum: ledger_available_sum,
        ledger_locked_sum: 0,
        discrepancy,
        is_valid: Math.abs(discrepancy) < 0.0001
      });
    }

    return results;
  };

  /**
   * Reconcile user positions against trade history
   * Verifies that position.quantity == sum(buy_trades) - sum(sell_trades)
   */
  const reconcile_user_positions = async (user_id: string): Promise<PositionReconciliationResult[]> => {
    const db = get_database();

    const positions = await db.collection(COLLECTIONS.positions)
      .find({ user_id: new ObjectId(user_id) })
      .toArray() as Position[];

    const results: PositionReconciliationResult[] = [];

    for (const position of positions) {
      // Get all trades for this user, market, outcome
      const buy_trades = await db.collection(COLLECTIONS.trades)
        .find({
          buyer_user_id: new ObjectId(user_id),
          market_id: position.market_id,
          outcome_id: position.outcome_id
        })
        .toArray() as Trade[];

      const sell_trades = await db.collection(COLLECTIONS.trades)
        .find({
          seller_user_id: new ObjectId(user_id),
          market_id: position.market_id,
          outcome_id: position.outcome_id
        })
        .toArray() as Trade[];

      const buy_quantity = buy_trades.reduce((sum, t) => sum + t.quantity, 0);
      const sell_quantity = sell_trades.reduce((sum, t) => sum + t.quantity, 0);
      const expected_quantity = buy_quantity - sell_quantity;
      const discrepancy = expected_quantity - position.quantity;

      results.push({
        user_id,
        market_id: position.market_id.toString(),
        outcome_id: position.outcome_id.toString(),
        recorded_quantity: position.quantity,
        expected_quantity,
        discrepancy,
        is_valid: Math.abs(discrepancy) < 0.0001
      });
    }

    return results;
  };

  /**
   * Run full system reconciliation
   * Checks orders, balances, and positions across the system
   */
  const run_full_reconciliation = async (): Promise<ReconciliationReport> => {
    logger.info('Starting full system reconciliation');
    const db = get_database();

    // Reconcile all orders
    const all_orders = await db.collection(COLLECTIONS.orders)
      .find({}, { projection: { _id: 1 } })
      .toArray() as Array<{ _id: ObjectId }>;

    const order_results: OrderReconciliationResult[] = [];
    for (const order_doc of all_orders) {
      order_results.push(await reconcile_order(order_doc._id.toString()));
    }

    // Reconcile all balances
    const all_users = await db.collection(COLLECTIONS.user_balances)
      .distinct('user_id');

    const balance_results: BalanceReconciliationResult[] = [];
    for (const user_id of all_users) {
      balance_results.push(...(await reconcile_user_balance(user_id.toString())));
    }

    // Reconcile all positions
    const all_position_users = await db.collection(COLLECTIONS.positions)
      .distinct('user_id');

    const position_results: PositionReconciliationResult[] = [];
    for (const user_id of all_position_users) {
      position_results.push(...(await reconcile_user_positions(user_id.toString())));
    }

    const orders_valid = order_results.filter(r => r.is_valid).length;
    const orders_invalid = order_results.filter(r => !r.is_valid).length;

    const balances_valid = balance_results.filter(r => r.is_valid).length;
    const balances_invalid = balance_results.filter(r => !r.is_valid).length;

    const positions_valid = position_results.filter(r => r.is_valid).length;
    const positions_invalid = position_results.filter(r => !r.is_valid).length;

    const total_discrepancies =
      order_results.reduce((sum, r) => sum + Math.abs(r.discrepancy), 0) +
      balance_results.reduce((sum, r) => sum + Math.abs(r.discrepancy), 0) +
      position_results.reduce((sum, r) => sum + Math.abs(r.discrepancy), 0);

    const critical_issues = orders_invalid + balances_invalid;
    const warnings = positions_invalid;

    const report: ReconciliationReport = {
      timestamp: new Date(),
      orders_checked: order_results.length,
      orders_valid,
      orders_invalid,
      order_results: order_results.filter(r => !r.is_valid),
      balances_checked: balance_results.length,
      balances_valid,
      balances_invalid,
      balance_results: balance_results.filter(r => !r.is_valid),
      positions_checked: position_results.length,
      positions_valid,
      positions_invalid,
      position_results: position_results.filter(r => !r.is_valid),
      summary: {
        total_discrepancies,
        critical_issues,
        warnings
      }
    };

    logger.info(`Reconciliation complete: ${orders_valid}/${order_results.length} orders valid, ${balances_valid}/${balance_results.length} balances valid, ${positions_valid}/${position_results.length} positions valid`);

    return report;
  };

  /**
   * Reconcile trades for a specific order (bidirectional lookup)
   */
  const get_order_trade_summary = async (order_id: string): Promise<{
    order: Order | null;
    trades_as_buyer: Trade[];
    trades_as_seller: Trade[];
    total_bought: number;
    total_sold: number;
  }> => {
    const db = get_database();
    const oid = new ObjectId(order_id);

    const order = await db.collection(COLLECTIONS.orders).findOne({ _id: oid }) as Order | null;

    const trades_as_buyer = await db.collection(COLLECTIONS.trades)
      .find({ buyer_order_id: oid })
      .sort({ timestamp: -1 })
      .toArray() as Trade[];

    const trades_as_seller = await db.collection(COLLECTIONS.trades)
      .find({ seller_order_id: oid })
      .sort({ timestamp: -1 })
      .toArray() as Trade[];

    return {
      order,
      trades_as_buyer,
      trades_as_seller,
      total_bought: trades_as_buyer.reduce((sum, t) => sum + t.quantity, 0),
      total_sold: trades_as_seller.reduce((sum, t) => sum + t.quantity, 0)
    };
  };

  return {
    reconcile_order,
    reconcile_market_orders,
    reconcile_user_balance,
    reconcile_user_positions,
    run_full_reconciliation,
    get_order_trade_summary
  };
};

// Export singleton instance
export const reconciliation_service = create_reconciliation_service();
