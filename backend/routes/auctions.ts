import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auctionService } from '../services/auction-service.js';
import { auctionCloseService } from '../services/auction-close-service.js';
import { parseBatUrl } from '../services/bat-parser.js';
import { ObjectId } from 'mongodb';
import { get_database } from '../database/connection.js';
import { COLLECTIONS, AuctionSnapshot } from '../database/schemas.js';

export const create_auction_routes = (): Hono => {
  const router = new Hono();

  // Request validation schemas
  const importAuctionSchema = z.object({
    url: z.string().url('Must be a valid URL'),
    skipValidation: z.boolean().optional().default(false),
  });

  const listAuctionsSchema = z.object({
    status: z.union([
      z.enum(['draft', 'active', 'extended', 'closed', 'cancelled']),
      z.array(z.enum(['draft', 'active', 'extended', 'closed', 'cancelled'])),
    ]).optional(),
    limit: z.coerce.number().min(1).max(100).optional().default(20),
    offset: z.coerce.number().min(0).optional().default(0),
    sortBy: z.enum(['end_date', 'current_bid', 'created_at']).optional().default('created_at'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  });

  const observationsSchema = z.object({
    limit: z.coerce.number().min(1).max(500).optional().default(100),
    before: z.coerce.date().optional(),
  });

  // Error handler helper
  function handleError(error: unknown, c: any) {
    console.error('[API Error]', error);
    
    if (error instanceof z.ZodError) {
      return c.json({
        success: false,
        error: 'Validation error',
        details: error.issues.map(e => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      }, 400);
    }
    
    const message = error instanceof Error ? error.message : 'Internal server error';
    return c.json({ success: false, error: message }, 500);
  }

  // ============================================
  // PUBLIC ENDPOINTS
  // ============================================

  /**
   * GET /api/auctions
   * List auctions (public)
   */
  router.get('/', zValidator('query', listAuctionsSchema), async (c) => {
    try {
      const query = c.req.valid('query');
      const result = await auctionService.listAuctions(query);
      
      return c.json({
        success: true,
        data: result.auctions,
        pagination: {
          total: result.total,
          limit: query.limit,
          offset: query.offset,
          hasMore: (query.offset || 0) + result.auctions.length < result.total,
        },
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /api/auctions/:id
   * Get single auction
   */
  router.get('/:id', async (c) => {
    try {
      const auctionId = c.req.param('id');
      const auction = await auctionService.getAuction(auctionId);
      
      if (!auction) {
        return c.json({ success: false, error: 'Auction not found' }, 404);
      }
      
      return c.json({ success: true, data: auction });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /api/auctions/listing/:listingId
   * Get auction by BaT listing ID
   */
  router.get('/listing/:listingId', async (c) => {
    try {
      const listingId = c.req.param('listingId');
      const auction = await auctionService.getAuctionByListingId(listingId);
      
      if (!auction) {
        return c.json({ success: false, error: 'Auction not found' }, 404);
      }
      
      return c.json({ success: true, data: auction });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /api/auctions/:id/observations
   * Get auction observation history
   */
  router.get('/:id/observations', zValidator('query', observationsSchema), async (c) => {
    try {
      const auctionId = c.req.param('id');
      const query = c.req.valid('query');
      
      // Verify auction exists
      const auction = await auctionService.getAuction(auctionId);
      if (!auction) {
        return c.json({ success: false, error: 'Auction not found' }, 404);
      }
      
      const observations = await auctionService.getObservations(auctionId, {
        limit: query.limit,
        before: query.before,
      });
      
      return c.json({
        success: true,
        data: observations,
        meta: {
          auctionId,
          count: observations.length,
        },
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  // ============================================
  // ADMIN ENDPOINTS
  // ============================================

  /**
   * POST /api/auctions/admin/import
   * Import a new auction from BaT URL
   */
  router.post('/admin/import', zValidator('json', importAuctionSchema), async (c) => {
    try {
      const { url, skipValidation } = c.req.valid('json');
      
      console.log(`[API] Import request: ${url}`);
      
      const result = await auctionService.importAuction(url, skipValidation);
      
      if (!result.success) {
        return c.json(result, 400);
      }
      
      return c.json(result, 201);
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * POST /api/auctions/admin/validate-url
   * Validate a BaT URL without importing
   */
  router.post('/admin/validate-url', zValidator('json', z.object({ url: z.string() })), async (c) => {
    try {
      const { url } = c.req.valid('json');
      const parsed = parseBatUrl(url);
      
      return c.json({
        success: true,
        data: {
          isValid: parsed.isValid,
          normalizedUrl: parsed.normalizedUrl,
          listingId: parsed.listingId,
          errors: parsed.errors,
        },
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * POST /api/auctions/:id/poll
   * Manually trigger a poll for an auction
   */
  router.post('/:id/poll', async (c) => {
    try {
      const auctionId = c.req.param('id');
      const result = await auctionService.pollAuction(auctionId);
      
      if (!result.auction) {
        return c.json({ success: false, error: 'Auction not found' }, 404);
      }
      
      return c.json({
        success: true,
        data: {
          updated: result.updated,
          auction: result.auction,
        },
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /api/auctions/admin/needs-poll
   * Get auctions that need polling (for monitoring)
   */
  router.get('/admin/needs-poll', async (c) => {
    try {
      const auctions = await auctionService.getAuctionsNeedingPoll(20);
      
      return c.json({
        success: true,
        data: auctions,
        meta: {
          count: auctions.length,
        },
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  // ============================================
  // CLOSE VALIDATION & EVIDENCE ENDPOINTS (5.1–5.5)
  // ============================================

  /**
   * GET /api/auctions/:id/close-validation
   * Get close validation state for an auction
   */
  router.get('/:id/close-validation', async (c) => {
    try {
      const auctionId = c.req.param('id');
      const auction = await auctionService.getAuction(auctionId);
      
      if (!auction) {
        return c.json({ success: false, error: 'Auction not found' }, 404);
      }
      
      const validation = await auctionCloseService.validateAuctionClose(auctionId);
      
      return c.json({
        success: true,
        data: {
          auction_id: auctionId,
          status: auction.status,
          close_validation_state: auction.close_validation_state,
          close_confirmed_at: auction.close_confirmed_at,
          final_price: auction.final_price,
          closed_at: auction.closed_at,
          validation
        }
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /api/auctions/:id/snapshots
   * Get archived evidence snapshots for an auction
   */
  router.get('/:id/snapshots', zValidator('query', z.object({
    type: z.enum(['periodic', 'close_evidence', 'extension_evidence']).optional(),
    limit: z.coerce.number().min(1).max(100).optional().default(20),
  })), async (c) => {
    try {
      const auctionId = c.req.param('id');
      const query = c.req.valid('query');
      
      if (!ObjectId.isValid(auctionId)) {
        return c.json({ success: false, error: 'Invalid auction ID' }, 400);
      }
      
      const db = get_database();
      const filter: Record<string, any> = { auction_id: new ObjectId(auctionId) };
      if (query.type) {
        filter.snapshot_type = query.type;
      }
      
      const snapshots = await db.collection<AuctionSnapshot>(COLLECTIONS.auction_snapshots)
        .find(filter)
        .sort({ created_at: -1 })
        .limit(query.limit)
        .project({ raw_html: 0 }) // Exclude full HTML from listing
        .toArray();
      
      return c.json({
        success: true,
        data: snapshots,
        meta: {
          auctionId,
          count: snapshots.length,
          type: query.type || 'all'
        }
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /api/auctions/:id/snapshots/:snapshotId
   * Get a single snapshot with full HTML (for evidence review)
   */
  router.get('/:id/snapshots/:snapshotId', async (c) => {
    try {
      const auctionId = c.req.param('id');
      const snapshotId = c.req.param('snapshotId');
      
      if (!ObjectId.isValid(auctionId) || !ObjectId.isValid(snapshotId)) {
        return c.json({ success: false, error: 'Invalid ID' }, 400);
      }
      
      const db = get_database();
      const snapshot = await db.collection<AuctionSnapshot>(COLLECTIONS.auction_snapshots).findOne({
        _id: new ObjectId(snapshotId),
        auction_id: new ObjectId(auctionId)
      });
      
      if (!snapshot) {
        return c.json({ success: false, error: 'Snapshot not found' }, 404);
      }
      
      return c.json({
        success: true,
        data: snapshot
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * POST /api/auctions/:id/confirm-close
   * Admin endpoint to manually confirm an auction close
   */
  router.post('/:id/confirm-close', async (c) => {
    try {
      const auctionId = c.req.param('id');
      const auction = await auctionService.getAuction(auctionId);
      
      if (!auction) {
        return c.json({ success: false, error: 'Auction not found' }, 404);
      }
      
      // TODO: Add admin authentication check
      const adminUserId = c.req.header('x-admin-user-id') || undefined;
      
      const validation = await auctionCloseService.confirmClose(auctionId, adminUserId);
      
      return c.json({
        success: true,
        data: {
          auction_id: auctionId,
          status: 'closed',
          close_validation_state: 'confirmed',
          validation
        }
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  /**
   * GET /api/auctions/:id/linked-markets
   * Get prediction markets linked to this auction
   */
  router.get('/:id/linked-markets', async (c) => {
    try {
      const auctionId = c.req.param('id');
      const auction = await auctionService.getAuction(auctionId);
      
      if (!auction) {
        return c.json({ success: false, error: 'Auction not found' }, 404);
      }
      
      const markets = await auctionCloseService.getLinkedMarkets(auctionId);
      
      return c.json({
        success: true,
        data: markets
      });
    } catch (error) {
      return handleError(error, c);
    }
  });

  return router;
};