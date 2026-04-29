import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { get_redis, cache_service, is_redis_available } from './redis.js';
import { ObjectId } from 'mongodb';
import { Logger } from '../utils/logger.js';

export interface SocketUser {
  user_id?: string;
  session_id: string;
  connected_at: Date;
  subscribed_markets: Set<string>;
}

export interface MarketUpdate {
  market_id: string;
  outcome_id?: string;
  type: 'price_update' | 'trade_executed' | 'order_placed' | 'market_status_change';
  data: any;
  timestamp: number;
}

export class WebSocketService {
  private io: Server;
  private connected_users: Map<string, SocketUser> = new Map();
  private redis_subscriber: any = null;
  private logger: Logger;

  constructor(http_server: HttpServer) {
    this.logger = new Logger('WebSocketService');
    this.io = new Server(http_server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:5173",
        methods: ["GET", "POST"]
      },
      transports: ['websocket', 'polling']
    });

    this.setup_connection_handlers();
    this.setup_redis_subscription();
  }

  private setup_connection_handlers(): void {
    this.io.on('connection', (socket) => {
      this.logger.debug(`🔌 WebSocket connection established: ${socket.id}`);

      // Initialize user data
      const user_data: SocketUser = {
        session_id: socket.id,
        connected_at: new Date(),
        subscribed_markets: new Set()
      };
      this.connected_users.set(socket.id, user_data);

      // Handle user authentication
      socket.on('authenticate', async (data: { user_id: string; auth_token: string }) => {
        try {
          // TODO: Verify auth token with database
          const { user_id } = data;

          // Update user data with authenticated user ID
          const current_user = this.connected_users.get(socket.id);
          if (current_user) {
            current_user.user_id = user_id;
            this.connected_users.set(socket.id, current_user);
          }

          socket.emit('authenticated', { success: true, user_id });
          this.logger.debug(`👤 User ${user_id} authenticated via WebSocket`);
        } catch (error) {
          socket.emit('authenticated', { success: false, error: 'Authentication failed' });
        }
      });

      // Handle market subscription
      socket.on('subscribe_market', async (data: { market_id: string }) => {
        try {
          const { market_id } = data;

          if (!ObjectId.isValid(market_id)) {
            socket.emit('subscription_error', { error: 'Invalid market ID' });
            return;
          }

          // Join the market room
          socket.join(`market:${market_id}`);

          // Update user's subscribed markets
          const user_data = this.connected_users.get(socket.id);
          if (user_data) {
            user_data.subscribed_markets.add(market_id);
          }

          // Send initial market data
          const market_data = await cache_service.get_cached_market_data(market_id);
          if (market_data) {
            socket.emit('market_data', {
              market_id,
              data: market_data,
              timestamp: Date.now()
            });
          }

          socket.emit('subscribed', { market_id, success: true });
          this.logger.debug(`📊 Socket ${socket.id} subscribed to market ${market_id}`);
        } catch (error) {
          socket.emit('subscription_error', { error: 'Failed to subscribe to market' });
        }
      });

      // Handle market unsubscription
      socket.on('unsubscribe_market', async (data: { market_id: string }) => {
        try {
          const { market_id } = data;

          // Leave the market room
          socket.leave(`market:${market_id}`);

          // Update user's subscribed markets
          const user_data = this.connected_users.get(socket.id);
          if (user_data) {
            user_data.subscribed_markets.delete(market_id);
          }

          socket.emit('unsubscribed', { market_id, success: true });
          this.logger.debug(`📊 Socket ${socket.id} unsubscribed from market ${market_id}`);
        } catch (error) {
          socket.emit('unsubscription_error', { error: 'Failed to unsubscribe from market' });
        }
      });

      // Handle order book subscription
      socket.on('subscribe_orderbook', async (data: { market_id: string; outcome_id: string }) => {
        try {
          const { market_id, outcome_id } = data;

          if (!ObjectId.isValid(market_id) || !ObjectId.isValid(outcome_id)) {
            socket.emit('subscription_error', { error: 'Invalid market or outcome ID' });
            return;
          }

          // Join the order book room
          const room = `orderbook:${market_id}:${outcome_id}`;
          socket.join(room);

          // Send initial order book data
          const order_book = await cache_service.get_cached_order_book(market_id, outcome_id);
          if (order_book) {
            socket.emit('orderbook_data', {
              market_id,
              outcome_id,
              data: order_book,
              timestamp: Date.now()
            });
          }

          socket.emit('subscribed_orderbook', { market_id, outcome_id, success: true });
          this.logger.debug(`📖 Socket ${socket.id} subscribed to order book ${market_id}:${outcome_id}`);
        } catch (error) {
          socket.emit('subscription_error', { error: 'Failed to subscribe to order book' });
        }
      });

      // Handle ping/pong for connection health
      socket.on('ping', () => {
        socket.emit('pong', { timestamp: Date.now() });
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        this.logger.debug(`🔌 WebSocket disconnected: ${socket.id}, reason: ${reason}`);

        // Clean up user data
        this.connected_users.delete(socket.id);
      });
    });
  }

  private async setup_redis_subscription(): Promise<void> {
    if (!is_redis_available()) {
      this.logger.warn('Redis not available, skipping Redis pub/sub for WebSocket');
      return;
    }

    try {
      const redis = get_redis();
      this.redis_subscriber = redis.duplicate();

      // Subscribe to market update patterns
      await this.redis_subscriber.psubscribe('market_updates:*', 'trades:*', 'orderbook_updates:*');

      this.redis_subscriber.on('pmessage', (pattern: string, channel: string, message: string) => {
        try {
          const data = JSON.parse(message);
          this.handle_redis_message(pattern, channel, data);
        } catch (error) {
          this.logger.error('Error parsing Redis message:', error);
        }
      });

      this.logger.info('🔴 WebSocket service subscribed to Redis channels');
    } catch (error) {
      this.logger.error('❌ Failed to setup Redis subscription for WebSocket:', error);
    }
  }

  private handle_redis_message(pattern: string, channel: string, data: any): void {
    if (pattern === 'market_updates:*') {
      // Market data updates
      const market_id = channel.split(':')[1];
      this.broadcast_to_market(market_id, 'market_update', data);
    } else if (pattern === 'trades:*') {
      // Trade execution updates
      const [, market_id, outcome_id] = channel.split(':');
      this.broadcast_to_market(market_id, 'trade_executed', data);
      this.broadcast_to_orderbook(market_id, outcome_id, 'trade_executed', data);
    } else if (pattern === 'orderbook_updates:*') {
      // Order book updates
      const [, market_id, outcome_id] = channel.split(':');
      this.broadcast_to_orderbook(market_id, outcome_id, 'orderbook_update', data);
    }
  }

  // Broadcast methods
  public broadcast_to_market(market_id: string, event: string, data: any): void {
    this.io.to(`market:${market_id}`).emit(event, {
      market_id,
      ...data,
      timestamp: Date.now()
    });
  }

  public broadcast_to_orderbook(market_id: string, outcome_id: string, event: string, data: any): void {
    this.io.to(`orderbook:${market_id}:${outcome_id}`).emit(event, {
      market_id,
      outcome_id,
      ...data,
      timestamp: Date.now()
    });
  }

  public broadcast_to_user(user_id: string, event: string, data: any): void {
    // Find all sockets for this user
    for (const [socket_id, user_data] of this.connected_users) {
      if (user_data.user_id === user_id) {
        this.io.to(socket_id).emit(event, {
          ...data,
          timestamp: Date.now()
        });
      }
    }
  }

  public broadcast_to_all(event: string, data: any): void {
    this.io.emit(event, {
      ...data,
      timestamp: Date.now()
    });
  }

  // Utility methods
  public get_connection_stats(): {
    total_connections: number;
    authenticated_users: number;
    subscribed_markets: Map<string, number>;
  } {
    const total_connections = this.connected_users.size;
    let authenticated_users = 0;
    const market_subscriptions = new Map<string, number>();

    for (const user_data of this.connected_users.values()) {
      if (user_data.user_id) {
        authenticated_users++;
      }

      for (const market_id of user_data.subscribed_markets) {
        market_subscriptions.set(market_id, (market_subscriptions.get(market_id) || 0) + 1);
      }
    }

    return {
      total_connections,
      authenticated_users,
      subscribed_markets: market_subscriptions
    };
  }

  public async notify_market_update(market_id: string, update: MarketUpdate): Promise<void> {
    // Cache the update
    await cache_service.publish_market_update(market_id, update);

    // Broadcast directly as well (in case Redis subscription isn't working)
    this.broadcast_to_market(market_id, 'market_update', update);
  }

  public async notify_trade_execution(
    market_id: string,
    outcome_id: string,
    trade: any
  ): Promise<void> {
    // Publish to Redis for persistence and cross-service communication
    await cache_service.publish_trade_execution(market_id, outcome_id, trade);

    // Broadcast to connected clients
    this.broadcast_to_market(market_id, 'trade_executed', trade);
    this.broadcast_to_orderbook(market_id, outcome_id, 'trade_executed', trade);
  }

  public async notify_orderbook_update(
    market_id: string,
    outcome_id: string,
    order_book: any
  ): Promise<void> {
    await cache_service.publish_orderbook_update(market_id, outcome_id, order_book);
    this.broadcast_to_orderbook(market_id, outcome_id, 'orderbook_update', order_book);
  }

  public async shutdown(): Promise<void> {
    if (this.redis_subscriber) {
      try {
        await this.redis_subscriber.punsubscribe();
        await this.redis_subscriber.quit();
      } catch (error) {
        this.logger.error('Error shutting down Redis subscriber:', error);
      }
    }

    this.io.close();
    this.logger.info('🔌 WebSocket service shut down');
  }
}

// Global instance
let websocket_service: WebSocketService | null = null;

export function create_websocket_service(http_server: HttpServer): WebSocketService {
  websocket_service = new WebSocketService(http_server);
  return websocket_service;
}

export function get_websocket_service(): WebSocketService {
  if (!websocket_service) {
    throw new Error('WebSocket service not initialized. Call create_websocket_service first.');
  }
  return websocket_service;
}
