import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { auctionService } from '../services/auction-service.js';
import { parseBatUrl } from '../services/bat-parser.js';

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

  return router;
};