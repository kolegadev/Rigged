import { Hono } from 'hono';
import { auth_service } from '../services/auth.js';
import { balance_service } from '../services/balance.js';
import { order_service } from '../services/orders.js';

export function create_auth_routes(): Hono {
  const app = new Hono();

  // ─────────────────────────────────────────────────────────────
  // HELPER: Get user from token
  // ─────────────────────────────────────────────────────────────

  const get_user_from_request = (c: any): string | null => {
    const auth_header = c.req.header('Authorization');
    
    if (!auth_header?.startsWith('Bearer ')) {
      return null;
    }

    const token = auth_header.slice(7);
    const payload = auth_service.verify_token(token);
    
    return payload ? payload.userId : null;
  };

  // ─────────────────────────────────────────────────────────────
  // PUBLIC AUTH ROUTES
  // ─────────────────────────────────────────────────────────────

  /**
   * POST /api/auth/register
   * Register a new user account
   */
  app.post('/register', async (c) => {
    try {
      const body = await c.req.json();
      
      // Basic validation
      if (!body.email || !body.password) {
        return c.json({ 
          success: false, 
          error: 'Email and password required' 
        }, 400);
      }

      const result = await auth_service.register({
        email: body.email,
        password: body.password,
        displayName: body.displayName
      });
      
      if (!result.success) {
        return c.json({ 
          success: false, 
          error: result.error 
        }, 400);
      }

      return c.json({
        success: true,
        message: 'Registration successful',
        user: result.user,
        token: result.token
      }, 201);

    } catch (error: any) {
      console.error('Registration endpoint error:', error);
      return c.json({ 
        success: false, 
        error: 'Registration failed' 
      }, 500);
    }
  });

  /**
   * POST /api/auth/login
   * Login with email and password
   */
  app.post('/login', async (c) => {
    try {
      const body = await c.req.json();
      
      if (!body.email || !body.password) {
        return c.json({ 
          success: false, 
          error: 'Email and password required' 
        }, 400);
      }

      const result = await auth_service.login({
        email: body.email,
        password: body.password
      });
      
      if (!result.success) {
        return c.json({ 
          success: false, 
          error: result.error 
        }, 401);
      }

      return c.json({
        success: true,
        message: 'Login successful',
        user: result.user,
        token: result.token
      });

    } catch (error: any) {
      console.error('Login endpoint error:', error);
      return c.json({ 
        success: false, 
        error: 'Login failed' 
      }, 500);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // PROTECTED USER ROUTES
  // ─────────────────────────────────────────────────────────────

  /**
   * GET /api/auth/me
   * Get current user information
   */
  app.get('/me', async (c) => {
    try {
      const user_id = get_user_from_request(c);
      if (!user_id) {
        return c.json({ 
          success: false, 
          error: 'Authorization required' 
        }, 401);
      }

      const user = await auth_service.get_user_by_id(user_id);
      
      if (!user) {
        return c.json({ 
          success: false, 
          error: 'User not found' 
        }, 404);
      }

      return c.json({
        success: true,
        user
      });

    } catch (error: any) {
      console.error('Get user endpoint error:', error);
      return c.json({ 
        success: false, 
        error: 'Failed to get user information' 
      }, 500);
    }
  });

  /**
   * GET /api/auth/wallet
   * Get user's wallet and balance information
   */
  app.get('/wallet', async (c) => {
    try {
      const user_id = get_user_from_request(c);
      if (!user_id) {
        return c.json({ 
          success: false, 
          error: 'Authorization required' 
        }, 401);
      }

      const wallet = await balance_service.get_user_wallet(user_id);
      
      if (!wallet) {
        return c.json({ 
          success: false, 
          error: 'Wallet not found' 
        }, 404);
      }

      return c.json({
        success: true,
        wallet
      });

    } catch (error: any) {
      console.error('Get wallet endpoint error:', error);
      return c.json({ 
        success: false, 
        error: 'Failed to get wallet information' 
      }, 500);
    }
  });

  /**
   * GET /api/auth/balance
   * Get detailed balance summary
   */
  app.get('/balance', async (c) => {
    try {
      const user_id = get_user_from_request(c);
      if (!user_id) {
        return c.json({ 
          success: false, 
          error: 'Authorization required' 
        }, 401);
      }

      const summary = await balance_service.get_balance_summary(user_id);
      
      return c.json({
        success: true,
        ...summary
      });

    } catch (error: any) {
      console.error('Get balance endpoint error:', error);
      return c.json({ 
        success: false, 
        error: 'Failed to get balance information' 
      }, 500);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // ORDER MANAGEMENT ROUTES
  // ─────────────────────────────────────────────────────────────

  /**
   * POST /api/auth/orders
   * Place a new order
   */
  app.post('/orders', async (c) => {
    try {
      const user_id = get_user_from_request(c);
      if (!user_id) {
        return c.json({ 
          success: false, 
          error: 'Authorization required' 
        }, 401);
      }

      const body = await c.req.json();
      
      // Validate required fields
      if (!body.market_id || !body.outcome || !body.side || !body.price || !body.quantity) {
        return c.json({
          success: false,
          error: 'Missing required fields: market_id, outcome, side, price, quantity'
        }, 400);
      }

      const result = await order_service.place_order({
        user_id,
        market_id: body.market_id,
        outcome: body.outcome,
        side: body.side,
        type: body.type || 'limit',
        price: parseFloat(body.price),
        quantity: parseInt(body.quantity, 10),
        time_in_force: body.time_in_force
      });

      if (!result.success) {
        return c.json({
          success: false,
          error: result.error
        }, 400);
      }

      return c.json({
        success: true,
        message: 'Order placed successfully',
        order: result.order
      }, 201);

    } catch (error: any) {
      console.error('Place order endpoint error:', error);
      return c.json({
        success: false,
        error: 'Failed to place order'
      }, 500);
    }
  });

  /**
   * GET /api/auth/orders
   * Get user's orders with optional filtering
   */
  app.get('/orders', async (c) => {
    try {
      const user_id = get_user_from_request(c);
      if (!user_id) {
        return c.json({ 
          success: false, 
          error: 'Authorization required' 
        }, 401);
      }

      const status = c.req.query('status');
      const market_id = c.req.query('market_id');
      const limit = parseInt(c.req.query('limit') || '20', 10);
      const offset = parseInt(c.req.query('offset') || '0', 10);

      const orders = await order_service.get_user_orders(user_id, {
        status: status as any,
        market_id,
        limit,
        offset
      });

      return c.json({
        success: true,
        orders,
        pagination: {
          limit,
          offset,
          count: orders.length
        }
      });

    } catch (error: any) {
      console.error('Get orders endpoint error:', error);
      return c.json({
        success: false,
        error: 'Failed to get orders'
      }, 500);
    }
  });

  /**
   * GET /api/auth/orders/:id
   * Get specific order details
   */
  app.get('/orders/:id', async (c) => {
    try {
      const user_id = get_user_from_request(c);
      if (!user_id) {
        return c.json({ 
          success: false, 
          error: 'Authorization required' 
        }, 401);
      }

      const order_id = c.req.param('id');
      const order = await order_service.get_order_by_id(order_id, user_id);

      if (!order) {
        return c.json({
          success: false,
          error: 'Order not found'
        }, 404);
      }

      return c.json({
        success: true,
        order
      });

    } catch (error: any) {
      console.error('Get order endpoint error:', error);
      return c.json({
        success: false,
        error: 'Failed to get order'
      }, 500);
    }
  });

  /**
   * DELETE /api/auth/orders/:id
   * Cancel an order
   */
  app.delete('/orders/:id', async (c) => {
    try {
      const user_id = get_user_from_request(c);
      if (!user_id) {
        return c.json({ 
          success: false, 
          error: 'Authorization required' 
        }, 401);
      }

      const order_id = c.req.param('id');
      const result = await order_service.cancel_order(order_id, user_id);

      if (!result.success) {
        return c.json({
          success: false,
          error: result.error
        }, 400);
      }

      return c.json({
        success: true,
        message: 'Order cancelled successfully'
      });

    } catch (error: any) {
      console.error('Cancel order endpoint error:', error);
      return c.json({
        success: false,
        error: 'Failed to cancel order'
      }, 500);
    }
  });

  return app;
}