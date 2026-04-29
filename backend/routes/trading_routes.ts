import { Hono } from 'hono';
import { matching_engine } from '../services/matching_engine.js';
import { order_book_service } from '../services/order_book.js';
import { trade_execution_service } from '../services/trade_execution.js';
import { position_engine } from '../services/position_engine.js';
import { reconciliation_service } from '../services/reconciliation.js';
import { get_user_from_request } from '../middleware/auth.js';
import { Logger } from '../utils/logger.js';

export const create_trading_routes = (): Hono => {
  const router = new Hono();
  const logger = new Logger('TradingRoutes');

  /**
   * GET /api/trading/orderbook/:market_id/:outcome_id
   * Get order book for a specific market/outcome
   */
  router.get('/orderbook/:market_id/:outcome_id', async (c) => {
    try {
      const market_id = c.req.param('market_id');
      const outcome_id = c.req.param('outcome_id');

      const order_book = await order_book_service.get_order_book(market_id, outcome_id);
      
      return c.json({
        success: true,
        order_book
      });
    } catch (error) {
      logger.error(`Error getting order book: ${error}`);
      return c.json({
        success: false,
        error: 'Failed to get order book'
      }, 500);
    }
  });

  /**
   * GET /api/trading/orderbook/:market_id
   * Get all order books for a market (all outcomes)
   */
  router.get('/orderbook/:market_id', async (c) => {
    try {
      const market_id = c.req.param('market_id');
      const order_books = await order_book_service.get_market_order_books(market_id);
      
      return c.json({
        success: true,
        order_books
      });
    } catch (error) {
      logger.error(`Error getting market order books: ${error}`);
      return c.json({
        success: false,
        error: 'Failed to get market order books'
      }, 500);
    }
  });

  /**
   * GET /api/trading/depth/:market_id/:outcome_id
   * Get market depth for a specific outcome
   */
  router.get('/depth/:market_id/:outcome_id', async (c) => {
    try {
      const market_id = c.req.param('market_id');
      const outcome_id = c.req.param('outcome_id');
      const levels = parseInt(c.req.query('levels') || '10');

      const depth = await order_book_service.get_market_depth(market_id, outcome_id, levels);
      
      return c.json({
        success: true,
        depth
      });
    } catch (error) {
      logger.error(`Error getting market depth: ${error}`);
      return c.json({
        success: false,
        error: 'Failed to get market depth'
      }, 500);
    }
  });

  /**
   * GET /api/trading/bbo/:market_id/:outcome_id
   * Get best bid/offer for quick price reference
   */
  router.get('/bbo/:market_id/:outcome_id', async (c) => {
    try {
      const market_id = c.req.param('market_id');
      const outcome_id = c.req.param('outcome_id');

      const bbo = await order_book_service.get_best_bid_offer(market_id, outcome_id);
      
      return c.json({
        success: true,
        bbo
      });
    } catch (error) {
      logger.error(`Error getting best bid/offer: ${error}`);
      return c.json({
        success: false,
        error: 'Failed to get best bid/offer'
      }, 500);
    }
  });

  /**
   * GET /api/trading/trades/:market_id
   * Get recent trades for a market
   */
  router.get('/trades/:market_id', async (c) => {
    try {
      const market_id = c.req.param('market_id');
      const outcome_id = c.req.query('outcome_id');
      const limit = parseInt(c.req.query('limit') || '50');

      const trades = await trade_execution_service.get_market_trades(market_id, outcome_id, limit);
      
      return c.json({
        success: true,
        trades
      });
    } catch (error) {
      logger.error(`Error getting market trades: ${error}`);
      return c.json({
        success: false,
        error: 'Failed to get market trades'
      }, 500);
    }
  });

  /**
   * GET /api/trading/recent-trades/:market_id/:outcome_id
   * Get recent trades formatted for real-time display
   */
  router.get('/recent-trades/:market_id/:outcome_id', async (c) => {
    try {
      const market_id = c.req.param('market_id');
      const outcome_id = c.req.param('outcome_id');
      const limit = parseInt(c.req.query('limit') || '20');

      const trades = await trade_execution_service.get_recent_trades(market_id, outcome_id, limit);
      
      return c.json({
        success: true,
        trades
      });
    } catch (error) {
      logger.error(`Error getting recent trades: ${error}`);
      return c.json({
        success: false,
        error: 'Failed to get recent trades'
      }, 500);
    }
  });

  /**
   * GET /api/trading/statistics/:market_id
   * Get trade statistics for a market
   */
  router.get('/statistics/:market_id', async (c) => {
    try {
      const market_id = c.req.param('market_id');
      const outcome_id = c.req.query('outcome_id');

      const stats = await trade_execution_service.get_trade_statistics(market_id, outcome_id);
      
      return c.json({
        success: true,
        statistics: stats
      });
    } catch (error) {
      logger.error(`Error getting trade statistics: ${error}`);
      return c.json({
        success: false,
        error: 'Failed to get trade statistics'
      }, 500);
    }
  });

  // Protected routes (require authentication)
  
  /**
   * GET /api/trading/positions
   * Get user's positions
   */
  router.get('/positions', async (c) => {
    try {
      const user = await get_user_from_request(c.req);
      if (!user) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
      }

      const market_id = c.req.query('market_id');
      const positions = await position_engine.get_user_positions(user.id, market_id);
      
      return c.json({
        success: true,
        positions
      });
    } catch (error) {
      logger.error(`Error getting user positions: ${error}`);
      return c.json({
        success: false,
        error: 'Failed to get positions'
      }, 500);
    }
  });

  /**
   * GET /api/trading/position-summary
   * Get user's position summary with P&L
   */
  router.get('/position-summary', async (c) => {
    try {
      const user = await get_user_from_request(c.req);
      if (!user) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
      }

      const market_id = c.req.query('market_id');
      const summary = await position_engine.get_position_summary(user.id, market_id);
      
      return c.json({
        success: true,
        summary
      });
    } catch (error) {
      logger.error(`Error getting position summary: ${error}`);
      return c.json({
        success: false,
        error: 'Failed to get position summary'
      }, 500);
    }
  });

  /**
   * GET /api/trading/my-trades
   * Get user's trade history
   */
  router.get('/my-trades', async (c) => {
    try {
      const user = await get_user_from_request(c.req);
      if (!user) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
      }

      const market_id = c.req.query('market_id');
      const limit = parseInt(c.req.query('limit') || '50');
      
      const trades = await trade_execution_service.get_user_trades(user.id, market_id, limit);
      
      return c.json({
        success: true,
        trades
      });
    } catch (error) {
      logger.error(`Error getting user trades: ${error}`);
      return c.json({
        success: false,
        error: 'Failed to get user trades'
      }, 500);
    }
  });

  /**
   * POST /api/trading/trigger-matching/:market_id/:outcome_id
   * Manually trigger matching for a market/outcome (admin only)
   */
  router.post('/trigger-matching/:market_id/:outcome_id', async (c) => {
    try {
      // TODO: Add admin authentication check here
      
      const market_id = c.req.param('market_id');
      const outcome_id = c.req.param('outcome_id');

      const result = await matching_engine.match_market(market_id, outcome_id);
      
      return c.json({
        success: true,
        matching_result: result
      });
    } catch (error) {
      logger.error(`Error triggering matching: ${error}`);
      return c.json({
        success: false,
        error: 'Failed to trigger matching'
      }, 500);
    }
  });

  /**
   * POST /api/trading/trigger-all-matching
   * Trigger matching for all active markets (admin only)
   */
  router.post('/trigger-all-matching', async (c) => {
    try {
      // TODO: Add admin authentication check here
      
      const results = await matching_engine.match_all_markets();
      
      return c.json({
        success: true,
        matching_results: results
      });
    } catch (error) {
      logger.error(`Error triggering all matching: ${error}`);
      return c.json({
        success: false,
        error: 'Failed to trigger matching for all markets'
      }, 500);
    }
  });

  /**
   * POST /api/trading/recalculate-pnl
   * Recalculate unrealized P&L for user positions
   */
  router.post('/recalculate-pnl', async (c) => {
    try {
      const user = await get_user_from_request(c.req);
      if (!user) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
      }

      const market_id = c.req.query('market_id');
      await position_engine.calculate_unrealized_pnl(user.id, market_id);
      
      return c.json({
        success: true,
        message: 'P&L recalculation triggered'
      });
    } catch (error) {
      logger.error(`Error recalculating P&L: ${error}`);
      return c.json({
        success: false,
        error: 'Failed to recalculate P&L'
      }, 500);
    }
  });

  /**
   * GET /api/trading/market-stats/:market_id
   * Get position statistics for a market
   */
  router.get('/market-stats/:market_id', async (c) => {
    try {
      const market_id = c.req.param('market_id');
      const stats = await position_engine.get_market_position_stats(market_id);
      
      return c.json({
        success: true,
        stats
      });
    } catch (error) {
      logger.error(`Error getting market position stats: ${error}`);
      return c.json({
        success: false,
        error: 'Failed to get market position stats'
      }, 500);
    }
  });

  // Protected reconciliation routes

  /**
   * GET /api/trading/reconciliation/balance
   * Get user's own balance reconciliation
   */
  router.get('/reconciliation/balance', async (c) => {
    try {
      const user = await get_user_from_request(c.req);
      if (!user) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
      }

      const results = await reconciliation_service.reconcile_user_balance(user.id);
      
      return c.json({
        success: true,
        balance_reconciliation: results
      });
    } catch (error) {
      logger.error(`Error reconciling user balance: ${error}`);
      return c.json({
        success: false,
        error: 'Failed to reconcile balance'
      }, 500);
    }
  });

  /**
   * GET /api/trading/reconciliation/positions
   * Get user's own position reconciliation
   */
  router.get('/reconciliation/positions', async (c) => {
    try {
      const user = await get_user_from_request(c.req);
      if (!user) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
      }

      const results = await reconciliation_service.reconcile_user_positions(user.id);
      
      return c.json({
        success: true,
        position_reconciliation: results
      });
    } catch (error) {
      logger.error(`Error reconciling user positions: ${error}`);
      return c.json({
        success: false,
        error: 'Failed to reconcile positions'
      }, 500);
    }
  });

  /**
   * GET /api/trading/reconciliation/orders/:order_id
   * Get order reconciliation for a user's order
   */
  router.get('/reconciliation/orders/:order_id', async (c) => {
    try {
      const user = await get_user_from_request(c.req);
      if (!user) {
        return c.json({ success: false, error: 'Unauthorized' }, 401);
      }

      const order_id = c.req.param('order_id');
      const result = await reconciliation_service.reconcile_order(order_id);
      const summary = await reconciliation_service.get_order_trade_summary(order_id);

      // Ensure user owns this order
      if (summary.order && summary.order.user_id.toString() !== user.id) {
        return c.json({ success: false, error: 'Unauthorized' }, 403);
      }
      
      return c.json({
        success: true,
        reconciliation: result,
        trade_summary: {
          total_bought: summary.total_bought,
          total_sold: summary.total_sold,
          trade_count: summary.trades_as_buyer.length + summary.trades_as_seller.length
        }
      });
    } catch (error) {
      logger.error(`Error reconciling order: ${error}`);
      return c.json({
        success: false,
        error: 'Failed to reconcile order'
      }, 500);
    }
  });

  return router;
};