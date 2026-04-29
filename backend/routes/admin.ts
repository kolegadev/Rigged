import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import { get_database } from '../database/connection.js';
import { Auction, Event, Market, Outcome, COLLECTIONS } from '../database/schemas.js';
import { reconciliation_service } from '../services/reconciliation.js';
import { broadcast_market_status_change } from '../services/market_status.js';

export const create_admin_routes = (): Hono => {
  const router = new Hono();

  // TODO: Add proper admin authentication middleware
  // For now, this is a basic admin API structure

  // POST /api/admin/auctions/import - Import a new BaT auction (LEGACY - kept for compatibility)
  router.post('/auctions/import', async (c) => {
    try {
      const body = await c.req.json();
      const { url, admin_user_id, skipValidation = false } = body;

      if (!url || !admin_user_id) {
        return c.json({
          success: false,
          error: 'Missing required fields: url, admin_user_id'
        }, 400);
      }

      console.log(`[Admin API] Import request from ${admin_user_id}: ${url}`);

      // Use the new auction service (imported via the auction routes)
      // This is a temporary workaround - in production the auction service should be imported here too
      const response = await fetch('http://localhost:9002/api/auctions/admin/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, skipValidation }),
      });

      const result = await response.json();

      if (!response.ok) {
        return c.json(result, response.status as any);
      }

      // Log the successful import
      console.log(`[Admin API] Successfully imported auction: ${result.auction?.title}`);

      return c.json({
        success: true,
        data: {
          auction_id: result.auction?._id,
          auction: result.auction,
          message: 'Auction imported successfully using new import service'
        }
      }, 201);
    } catch (error) {
      console.error('Error importing auction:', error);
      return c.json({
        success: false,
        error: 'Failed to import auction'
      }, 500);
    }
  });

  // POST /api/admin/events - Create a new prediction event
  router.post('/events', async (c) => {
    try {
      const body = await c.req.json();
      const { title, description, auction_id, admin_user_id } = body;

      if (!title || !description || !auction_id || !admin_user_id) {
        return c.json({
          success: false,
          error: 'Missing required fields: title, description, auction_id, admin_user_id'
        }, 400);
      }

      if (!ObjectId.isValid(auction_id)) {
        return c.json({
          success: false,
          error: 'Invalid auction_id'
        }, 400);
      }

      const db = get_database();

      // Verify auction exists
      const auction = await db.collection<Auction>(COLLECTIONS.auctions)
        .findOne({ _id: new ObjectId(auction_id) });

      if (!auction) {
        return c.json({
          success: false,
          error: 'Auction not found'
        }, 404);
      }

      const slug = generate_slug(title);
      const new_event: Omit<Event, '_id'> = {
        title,
        description,
        auction_id: new ObjectId(auction_id),
        slug,
        resolution_source: 'bat_final_price',
        status: 'draft',
        created_at: new Date(),
        updated_at: new Date(),
        created_by: new ObjectId(admin_user_id)
      };

      const result = await db.collection<Event>(COLLECTIONS.events)
        .insertOne(new_event);

      return c.json({
        success: true,
        data: {
          event_id: result.insertedId,
          slug,
          message: 'Event created successfully'
        }
      }, 201);
    } catch (error) {
      console.error('Error creating event:', error);
      return c.json({
        success: false,
        error: 'Failed to create event'
      }, 500);
    }
  });

  // POST /api/admin/markets - Create a new prediction market
  router.post('/markets', async (c) => {
    try {
      const body = await c.req.json();
      const { 
        event_id, 
        title, 
        description, 
        type, 
        threshold_value, 
        bucket_ranges,
        trading_starts_at,
        trading_ends_at,
        admin_user_id 
      } = body;

      // Validate required fields
      if (!event_id || !title || !description || !type || !trading_starts_at || !trading_ends_at || !admin_user_id) {
        return c.json({
          success: false,
          error: 'Missing required fields'
        }, 400);
      }

      if (!ObjectId.isValid(event_id)) {
        return c.json({
          success: false,
          error: 'Invalid event_id'
        }, 400);
      }

      if (type !== 'threshold' && type !== 'bucket') {
        return c.json({
          success: false,
          error: 'Market type must be "threshold" or "bucket"'
        }, 400);
      }

      if (type === 'threshold' && !threshold_value) {
        return c.json({
          success: false,
          error: 'threshold_value is required for threshold markets'
        }, 400);
      }

      if (type === 'bucket' && !bucket_ranges) {
        return c.json({
          success: false,
          error: 'bucket_ranges is required for bucket markets'
        }, 400);
      }

      const db = get_database();

      // Verify event exists
      const event = await db.collection<Event>(COLLECTIONS.events)
        .findOne({ _id: new ObjectId(event_id) });

      if (!event) {
        return c.json({
          success: false,
          error: 'Event not found'
        }, 404);
      }

      const slug = generate_slug(title);
      const new_market: Omit<Market, '_id'> = {
        event_id: new ObjectId(event_id),
        title,
        description,
        slug,
        type,
        threshold_value: type === 'threshold' ? threshold_value : undefined,
        bucket_ranges: type === 'bucket' ? bucket_ranges : undefined,
        trading_starts_at: new Date(trading_starts_at),
        trading_ends_at: new Date(trading_ends_at),
        status: 'draft',
        created_at: new Date(),
        updated_at: new Date(),
        created_by: new ObjectId(admin_user_id)
      };

      const market_result = await db.collection<Market>(COLLECTIONS.markets)
        .insertOne(new_market);

      // Create outcomes based on market type
      const outcomes: Omit<Outcome, '_id'>[] = [];
      
      if (type === 'threshold') {
        outcomes.push(
          {
            market_id: market_result.insertedId,
            title: 'Yes',
            slug: 'yes',
            sort_order: 1,
            created_at: new Date(),
            updated_at: new Date()
          },
          {
            market_id: market_result.insertedId,
            title: 'No', 
            slug: 'no',
            sort_order: 2,
            created_at: new Date(),
            updated_at: new Date()
          }
        );
      } else if (type === 'bucket' && bucket_ranges) {
        bucket_ranges.forEach((bucket: any, index: number) => {
          outcomes.push({
            market_id: market_result.insertedId,
            title: bucket.label,
            slug: generate_slug(bucket.label),
            sort_order: index + 1,
            created_at: new Date(),
            updated_at: new Date()
          });
        });
      }

      if (outcomes.length > 0) {
        await db.collection<Outcome>(COLLECTIONS.outcomes)
          .insertMany(outcomes);
      }

      return c.json({
        success: true,
        data: {
          market_id: market_result.insertedId,
          slug,
          outcomes_created: outcomes.length,
          message: 'Market created successfully'
        }
      }, 201);
    } catch (error) {
      console.error('Error creating market:', error);
      return c.json({
        success: false,
        error: 'Failed to create market'
      }, 500);
    }
  });

  // POST /api/admin/markets/:id/publish - Publish a draft market
  router.post('/markets/:id/publish', async (c) => {
    try {
      const market_id = c.req.param('id');

      if (!ObjectId.isValid(market_id)) {
        return c.json({
          success: false,
          error: 'Invalid market_id'
        }, 400);
      }

      const db = get_database();

      const result = await db.collection<Market>(COLLECTIONS.markets)
        .updateOne(
          { _id: new ObjectId(market_id), status: 'draft' },
          { 
            $set: { 
              status: 'published',
              updated_at: new Date()
            }
          }
        );

      if (result.matchedCount === 0) {
        return c.json({
          success: false,
          error: 'Market not found or not in draft status'
        }, 404);
      }

      // Broadcast status change (task 4.19)
      await broadcast_market_status_change({
        market_id: market_id,
        previous_status: 'draft',
        new_status: 'published',
        timestamp: new Date(),
        reason: 'admin_publish'
      });

      return c.json({
        success: true,
        message: 'Market published successfully'
      });
    } catch (error) {
      console.error('Error publishing market:', error);
      return c.json({
        success: false,
        error: 'Failed to publish market'
      }, 500);
    }
  });

  // POST /api/admin/markets/:id/unpublish - Unpublish a published market
  router.post('/markets/:id/unpublish', async (c) => {
    try {
      const market_id = c.req.param('id');

      if (!ObjectId.isValid(market_id)) {
        return c.json({
          success: false,
          error: 'Invalid market_id'
        }, 400);
      }

      const db = get_database();

      const result = await db.collection<Market>(COLLECTIONS.markets)
        .updateOne(
          { _id: new ObjectId(market_id), status: 'published' },
          { 
            $set: { 
              status: 'draft',
              updated_at: new Date()
            }
          }
        );

      if (result.matchedCount === 0) {
        return c.json({
          success: false,
          error: 'Market not found or not in published status'
        }, 404);
      }

      // Broadcast status change (task 4.19)
      await broadcast_market_status_change({
        market_id: market_id,
        previous_status: 'published',
        new_status: 'draft',
        timestamp: new Date(),
        reason: 'admin_unpublish'
      });

      return c.json({
        success: true,
        message: 'Market unpublished successfully'
      });
    } catch (error) {
      console.error('Error unpublishing market:', error);
      return c.json({
        success: false,
        error: 'Failed to unpublish market'
      }, 500);
    }
  });

  // GET /api/admin/events - List all events
  router.get('/events', async (c) => {
    try {
      const db = get_database();
      
      const events = await db.collection<Event>(COLLECTIONS.events)
        .aggregate([
          {
            $lookup: {
              from: COLLECTIONS.auctions,
              localField: 'auction_id',
              foreignField: '_id',
              as: 'auction'
            }
          },
          {
            $unwind: {
              path: '$auction',
              preserveNullAndEmptyArrays: true
            }
          },
          {
            $sort: { created_at: -1 }
          }
        ])
        .toArray();

      return c.json({
        success: true,
        data: events
      });
    } catch (error) {
      console.error('Error fetching events:', error);
      return c.json({
        success: false,
        error: 'Failed to fetch events'
      }, 500);
    }
  });

  // GET /api/admin/reconciliation - Run full system reconciliation
  router.get('/reconciliation', async (c) => {
    try {
      const report = await reconciliation_service.run_full_reconciliation();

      return c.json({
        success: true,
        report: {
          timestamp: report.timestamp,
          summary: report.summary,
          orders: {
            checked: report.orders_checked,
            valid: report.orders_valid,
            invalid: report.orders_invalid
          },
          balances: {
            checked: report.balances_checked,
            valid: report.balances_valid,
            invalid: report.balances_invalid
          },
          positions: {
            checked: report.positions_checked,
            valid: report.positions_valid,
            invalid: report.positions_invalid
          },
          invalid_order_results: report.order_results,
          invalid_balance_results: report.balance_results,
          invalid_position_results: report.position_results
        }
      });
    } catch (error) {
      console.error('Reconciliation error:', error);
      return c.json({
        success: false,
        error: 'Failed to run reconciliation'
      }, 500);
    }
  });

  // GET /api/admin/reconciliation/orders/:order_id - Reconcile a specific order
  router.get('/reconciliation/orders/:order_id', async (c) => {
    try {
      const order_id = c.req.param('order_id');

      if (!ObjectId.isValid(order_id)) {
        return c.json({
          success: false,
          error: 'Invalid order_id'
        }, 400);
      }

      const result = await reconciliation_service.reconcile_order(order_id);
      const summary = await reconciliation_service.get_order_trade_summary(order_id);

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
      console.error('Order reconciliation error:', error);
      return c.json({
        success: false,
        error: 'Failed to reconcile order'
      }, 500);
    }
  });

  // GET /api/admin/reconciliation/markets/:market_id/orders - Reconcile all orders for a market
  router.get('/reconciliation/markets/:market_id/orders', async (c) => {
    try {
      const market_id = c.req.param('market_id');

      if (!ObjectId.isValid(market_id)) {
        return c.json({
          success: false,
          error: 'Invalid market_id'
        }, 400);
      }

      const results = await reconciliation_service.reconcile_market_orders(market_id);
      const invalid = results.filter(r => !r.is_valid);

      return c.json({
        success: true,
        market_id,
        total_orders: results.length,
        invalid_count: invalid.length,
        invalid_results: invalid
      });
    } catch (error) {
      console.error('Market reconciliation error:', error);
      return c.json({
        success: false,
        error: 'Failed to reconcile market orders'
      }, 500);
    }
  });

  return router;
};

// Helper functions
function extract_bat_id_from_url(url: string): string | null {
  const match = url.match(/bringatrailer\.com\/listing\/([^\/]+)/);
  return match ? match[1] : null;
}

function generate_slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}