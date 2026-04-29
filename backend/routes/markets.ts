import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import { get_database } from '../database/connection.js';
import { Market, Outcome, Event, Auction, COLLECTIONS } from '../database/schemas.js';

export const create_market_routes = (): Hono => {
  const router = new Hono();

  // GET /api/markets - List all published markets with filtering
  router.get('/', async (c) => {
    try {
      const status = c.req.query('status') || 'published';
      const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
      const skip = parseInt(c.req.query('skip') || '0');

      const db = get_database();
      
      // Build aggregation pipeline to include event and auction data
      const pipeline = [
        {
          $match: {
            status: { $in: status.split(',') }
          }
        },
        {
          $lookup: {
            from: COLLECTIONS.events,
            localField: 'event_id',
            foreignField: '_id',
            as: 'event'
          }
        },
        {
          $unwind: '$event'
        },
        {
          $lookup: {
            from: COLLECTIONS.auctions,
            localField: 'event.auction_id',
            foreignField: '_id',
            as: 'auction'
          }
        },
        {
          $unwind: '$auction'
        },
        {
          $lookup: {
            from: COLLECTIONS.outcomes,
            localField: '_id',
            foreignField: 'market_id',
            as: 'outcomes'
          }
        },
        {
          $sort: { trading_ends_at: 1 }
        },
        { $skip: skip },
        { $limit: limit }
      ];

      const markets = await db.collection<Market>(COLLECTIONS.markets)
        .aggregate(pipeline)
        .toArray();

      return c.json({
        success: true,
        data: markets,
        count: markets.length
      });
    } catch (error) {
      console.error('Error fetching markets:', error);
      return c.json({
        success: false,
        error: 'Failed to fetch markets'
      }, 500);
    }
  });

  // GET /api/markets/:id - Get specific market with full details
  router.get('/:id', async (c) => {
    try {
      const market_id = c.req.param('id');
      
      if (!ObjectId.isValid(market_id)) {
        return c.json({
          success: false,
          error: 'Invalid market ID'
        }, 400);
      }

      const db = get_database();
      
      const pipeline = [
        {
          $match: { _id: new ObjectId(market_id) }
        },
        {
          $lookup: {
            from: COLLECTIONS.events,
            localField: 'event_id',
            foreignField: '_id',
            as: 'event'
          }
        },
        {
          $unwind: '$event'
        },
        {
          $lookup: {
            from: COLLECTIONS.auctions,
            localField: 'event.auction_id',
            foreignField: '_id',
            as: 'auction'
          }
        },
        {
          $unwind: '$auction'
        },
        {
          $lookup: {
            from: COLLECTIONS.outcomes,
            localField: '_id',
            foreignField: 'market_id',
            as: 'outcomes'
          }
        }
      ];

      const result = await db.collection<Market>(COLLECTIONS.markets)
        .aggregate(pipeline)
        .toArray();

      if (result.length === 0) {
        return c.json({
          success: false,
          error: 'Market not found'
        }, 404);
      }

      return c.json({
        success: true,
        data: result[0]
      });
    } catch (error) {
      console.error('Error fetching market:', error);
      return c.json({
        success: false,
        error: 'Failed to fetch market'
      }, 500);
    }
  });

  // GET /api/markets/search - Search markets by auction details
  router.get('/search', async (c) => {
    try {
      const query = c.req.query('q');
      if (!query || query.trim().length < 2) {
        return c.json({
          success: false,
          error: 'Query must be at least 2 characters'
        }, 400);
      }

      const db = get_database();
      
      // Search across market title, auction make, model, and title
      const pipeline = [
        {
          $lookup: {
            from: COLLECTIONS.events,
            localField: 'event_id',
            foreignField: '_id',
            as: 'event'
          }
        },
        {
          $unwind: '$event'
        },
        {
          $lookup: {
            from: COLLECTIONS.auctions,
            localField: 'event.auction_id',
            foreignField: '_id',
            as: 'auction'
          }
        },
        {
          $unwind: '$auction'
        },
        {
          $match: {
            $or: [
              { title: { $regex: query, $options: 'i' } },
              { description: { $regex: query, $options: 'i' } },
              { 'auction.title': { $regex: query, $options: 'i' } },
              { 'auction.make': { $regex: query, $options: 'i' } },
              { 'auction.model': { $regex: query, $options: 'i' } }
            ],
            status: { $in: ['published', 'trading'] }
          }
        },
        {
          $lookup: {
            from: COLLECTIONS.outcomes,
            localField: '_id',
            foreignField: 'market_id',
            as: 'outcomes'
          }
        },
        {
          $limit: 20
        }
      ];

      const markets = await db.collection<Market>(COLLECTIONS.markets)
        .aggregate(pipeline)
        .toArray();

      return c.json({
        success: true,
        data: markets,
        count: markets.length
      });
    } catch (error) {
      console.error('Error searching markets:', error);
      return c.json({
        success: false,
        error: 'Failed to search markets'
      }, 500);
    }
  });

  return router;
};