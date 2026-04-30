import { ObjectId } from 'mongodb';
import { get_database } from '../database/connection.js';
import { Auction, AuctionObservation, COLLECTIONS } from '../database/schemas.js';
import { parseBatUrl, extractAuctionMetadata, type ExtractionResult, extractWinningBidder, extractExtensionInfo } from './bat-parser.js';
import { auctionCloseService } from './auction-close-service.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('AuctionService');

export interface ImportAuctionRequest {
  url: string;
  skipValidation?: boolean;
}

export interface ImportAuctionResponse {
  success: boolean;
  auction?: Auction;
  error?: string;
  validationErrors?: string[];
}

export interface AuctionListQuery {
  status?: string | string[];
  limit?: number;
  offset?: number;
  sortBy?: 'end_date' | 'current_bid' | 'created_at';
  sortOrder?: 'asc' | 'desc';
}

export class AuctionService {
  /**
   * Import a new auction from a BaT URL
   */
  async importAuction(url: string, skipValidation = false, adminUserId?: string): Promise<ImportAuctionResponse> {
    logger.info(`Starting import for: ${url}`);
    
    // Step 1: Parse and validate URL
    const parsed = parseBatUrl(url);
    if (!parsed.isValid) {
      return {
        success: false,
        error: 'Invalid URL',
        validationErrors: parsed.errors,
      };
    }
    
    const { normalizedUrl, listingId } = parsed;
    
    // Step 2: Check if already exists
    const db = get_database();
    const auctions = db.collection<Auction>(COLLECTIONS.auctions);
    const existing = await auctions.findOne({ url: normalizedUrl });
    if (existing) {
      logger.info(`Auction already exists: ${existing._id}`);
      return {
        success: false,
        error: 'Auction already exists',
        auction: existing,
      };
    }
    
    // Step 3: Extract metadata from BaT
    const extraction = await extractAuctionMetadata(normalizedUrl!);
    
    if (!extraction.success && !skipValidation) {
      logger.info(`Extraction failed: ${extraction.errors.join(', ')}`);
      return {
        success: false,
        error: 'Failed to extract auction data',
        validationErrors: extraction.errors,
      };
    }
    
    // Step 4: Validate extracted data
    if (!skipValidation && extraction.data) {
      const validationErrors = this.validateAuctionData(extraction);
      if (validationErrors.length > 0) {
        return {
          success: false,
          error: 'Validation failed',
          validationErrors,
        };
      }
    }
    
    // Step 5: Create auction document
    const now = new Date();
    const auctionId = new ObjectId();
    const endTime = extraction.data?.endTime || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    
    const auction: Auction = {
      _id: auctionId,
      bat_id: listingId!, // Use listing ID as BaT ID
      url: normalizedUrl!,
      title: extraction.data?.title || `Listing: ${listingId}`,
      make: extraction.data?.vehicle?.make || 'Unknown',
      model: extraction.data?.vehicle?.model || 'Unknown',
      year: extraction.data?.vehicle?.year || 0,
      vin: extraction.data?.vehicle?.vin || undefined,
      reserve_status: extraction.data?.pricing?.reserveStatus === 'no_reserve' ? 'no_reserve' : 'reserve',
      
      // Auction timing
      start_date: new Date(), // Default to now since BaT doesn't always show start date
      end_date: endTime,
      original_end_date: endTime,
      is_live: extraction.data?.status === 'active',
      current_bid: extraction.data?.pricing?.currentBid || undefined,
      bid_count: extraction.data?.pricing?.bidCount || 0,
      extension_count: 0,
      
      // Final results (empty for new auctions)
      final_price: extraction.data?.pricing?.soldPrice || undefined,
      winning_bidder: undefined,
      closed_at: extraction.data?.status === 'sold' || extraction.data?.status === 'ended' ? now : undefined,
      close_validation_state: 'unvalidated',
      
      // Metadata
      status: this.mapStatusToSchema(extraction.data?.status || 'pending'),
      created_at: now,
      updated_at: now,
      created_by: adminUserId ? new ObjectId(adminUserId) : new ObjectId(), // TODO: Get from auth context
    };
    
    // Step 6: Store evidence snapshot if available
    if (extraction.rawHtml) {
      await auctionCloseService.archiveEvidence(
        auctionId.toString(),
        extraction.rawHtml,
        extraction.htmlHash,
        extraction.data,
        'periodic'
      );
    }
    
    // Step 7: Insert auction
    await auctions.insertOne(auction);
    
    // Step 8: Create initial observation
    if (extraction.data) {
      await this.recordObservation(auction, extraction.data, extraction.rawHtml);
    }
    
    logger.info(`Successfully imported auction: ${listingId} (${auction.status})`);
    
    return {
      success: true,
      auction,
    };
  }
  
  /**
   * Get auction by ID
   */
  async getAuction(auctionId: string): Promise<Auction | null> {
    const db = get_database();
    const auctions = db.collection<Auction>(COLLECTIONS.auctions);
    
    if (!ObjectId.isValid(auctionId)) {
      return null;
    }
    
    return auctions.findOne({ _id: new ObjectId(auctionId) });
  }
  
  /**
   * Get auction by BaT listing ID
   */
  async getAuctionByListingId(listingId: string): Promise<Auction | null> {
    const db = get_database();
    const auctions = db.collection<Auction>(COLLECTIONS.auctions);
    return auctions.findOne({ bat_id: listingId });
  }
  
  /**
   * List auctions with filtering and pagination
   */
  async listAuctions(query: AuctionListQuery): Promise<{ auctions: Auction[]; total: number }> {
    const db = get_database();
    const auctions = db.collection<Auction>(COLLECTIONS.auctions);
    
    // Build filter
    const filter: Record<string, any> = {};
    if (query.status) {
      if (Array.isArray(query.status)) {
        filter.status = { $in: query.status };
      } else {
        filter.status = query.status;
      }
    }
    
    // Build sort
    const sortField = query.sortBy === 'end_date' ? 'end_date' :
                      query.sortBy === 'current_bid' ? 'current_bid' :
                      'created_at';
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    
    const [results, total] = await Promise.all([
      auctions
        .find(filter)
        .sort({ [sortField]: sortOrder })
        .skip(query.offset || 0)
        .limit(query.limit || 20)
        .toArray(),
      auctions.countDocuments(filter),
    ]);
    
    return { auctions: results, total };
  }
  
  /**
   * Get observations for an auction
   */
  async getObservations(
    auctionId: string, 
    options: { limit?: number; before?: Date } = {}
  ): Promise<AuctionObservation[]> {
    const db = get_database();
    const observations = db.collection<AuctionObservation>(COLLECTIONS.auction_observations);
    
    if (!ObjectId.isValid(auctionId)) {
      return [];
    }
    
    const filter: Record<string, any> = { auction_id: new ObjectId(auctionId) };
    if (options.before) {
      filter.observed_at = { $lt: options.before };
    }
    
    const results = await observations
      .find(filter)
      .sort({ observed_at: -1 })
      .limit(options.limit || 100)
      .toArray();
    
    return results;
  }
  
  /**
   * Record a new observation for an auction.
   * Stores a truncated HTML excerpt and detects extensions.
   */
  async recordObservation(
    auction: Auction,
    extractedData: any,
    rawHtml?: string
  ): Promise<AuctionObservation> {
    const db = get_database();
    const observations = db.collection<AuctionObservation>(COLLECTIONS.auction_observations);
    const auctions = db.collection<Auction>(COLLECTIONS.auctions);
    const now = new Date();
    
    // Detect extension by comparing extracted end time with stored end_date
    const extractedEndTime = extractedData.endTime as Date | null;
    const extension = auctionCloseService.detectExtension(auction, extractedEndTime);
    
    // If extended, update auction record
    if (extension.isExtended && extension.newEndDate) {
      const newExtensionCount = (auction.extension_count || 0) + 1;
      await auctions.updateOne(
        { _id: auction._id },
        {
          $set: {
            end_date: extension.newEndDate,
            status: 'extended',
            extension_count: newExtensionCount,
            last_extended_at: now,
            updated_at: now
          }
        }
      );
      logger.info(`Auction ${auction._id} extended to ${extension.newEndDate.toISOString()} (count: ${newExtensionCount})`);
      
      // Archive extension evidence if we have HTML
      if (rawHtml) {
        const htmlHash = await this.hashHtml(rawHtml);
        await auctionCloseService.archiveEvidence(
          auction._id!.toString(),
          rawHtml,
          htmlHash,
          extractedData,
          'extension_evidence'
        );
      }
    }
    
    // Calculate time remaining based on (possibly updated) end_date
    const currentEndDate = extension.isExtended && extension.newEndDate
      ? extension.newEndDate
      : auction.end_date;
    const timeRemainingSeconds = currentEndDate
      ? Math.max(0, Math.floor((currentEndDate.getTime() - now.getTime()) / 1000))
      : 0;
    
    const observation: AuctionObservation = {
      _id: new ObjectId(),
      auction_id: auction._id!,
      observed_at: now,
      current_bid: extractedData.pricing?.currentBid || auction.current_bid || 0,
      bid_count: extractedData.pricing?.bidCount || auction.bid_count || 0,
      time_left_seconds: timeRemainingSeconds,
      is_extended: extension.isExtended,
      raw_html_snapshot: rawHtml ? rawHtml.substring(0, 2000) : undefined,
      extension_detected: extension.isExtended,
      previous_end_date: extension.isExtended ? auction.end_date : undefined,
      created_at: now,
    };
    
    await observations.insertOne(observation);
    
    // Update auction with latest observation data
    await this.updateAuctionFromObservation(auction._id!.toString(), observation);
    
    return observation;
  }
  
  /**
   * Poll an auction for updates.
   * Detects extensions, final price capture, and close states.
   */
  async pollAuction(auctionId: string): Promise<{ updated: boolean; auction: Auction | null; closeHandled?: boolean }> {
    const auction = await this.getAuction(auctionId);
    if (!auction) {
      return { updated: false, auction: null };
    }
    
    // Skip polling if already confirmed closed
    if (auction.status === 'closed' && auction.close_validation_state === 'confirmed') {
      logger.info(`Auction ${auctionId} is confirmed closed, skipping poll`);
      return { updated: false, auction };
    }
    
    // Extract fresh data
    const extraction = await extractAuctionMetadata(auction.url);
    
    if (!extraction.success) {
      logger.warn(`Poll failed for ${auctionId}: ${extraction.errors.join(', ')}`);
      return { updated: false, auction };
    }
    
    const previousStatus = auction.status;
    
    // Detect changes
    const hasChanges = 
      extraction.data?.pricing?.currentBid !== auction.current_bid ||
      extraction.data?.pricing?.bidCount !== auction.bid_count ||
      extraction.data?.status !== this.mapSchemaToStatus(auction.status) ||
      (extraction.data?.endTime && auctionCloseService.detectExtension(auction, extraction.data.endTime).isExtended);
    
    // Update auction if needed
    if (hasChanges && extraction.data) {
      await this.updateAuctionFromExtraction(auctionId, extraction.data, extraction.rawHtml, extraction.htmlHash);
    }
    
    // Record observation with raw HTML for evidence
    if (extraction.data) {
      await this.recordObservation(auction, extraction.data, extraction.rawHtml);
    }
    
    // Re-fetch auction to get latest state
    const updatedAuction = await this.getAuction(auctionId);
    
    // Handle close detection: if status transitioned to closed, trigger close workflow
    let closeHandled = false;
    if (updatedAuction && previousStatus !== 'closed' && updatedAuction.status === 'closed') {
      await auctionCloseService.handleAuctionClosed(updatedAuction, extraction);
      closeHandled = true;
    }
    
    // Also handle close if auction was already closed but never validated
    if (updatedAuction && updatedAuction.status === 'closed' && updatedAuction.close_validation_state === 'unvalidated') {
      await auctionCloseService.handleAuctionClosed(updatedAuction, extraction);
      closeHandled = true;
    }
    
    return { updated: hasChanges, auction: updatedAuction, closeHandled };
  }
  
  /**
   * Get auctions that need polling.
   * Includes active/extended auctions, auctions near end time, and recently closed
   * auctions that need close confirmation.
   */
  async getAuctionsNeedingPoll(limit = 10): Promise<Auction[]> {
    const db = get_database();
    const auctions = db.collection<Auction>(COLLECTIONS.auctions);
    const now = new Date();
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    
    return auctions
      .find({
        $or: [
          // Active or extended auctions that haven't ended yet
          {
            status: { $in: ['active', 'extended'] },
            end_date: { $gt: now }
          },
          // Auctions within 24h of ending (high-frequency polling zone)
          {
            status: { $in: ['active', 'extended'] },
            end_date: { $lte: twentyFourHoursFromNow, $gt: now }
          },
          // Recently closed auctions that need confirmation
          {
            status: 'closed',
            close_validation_state: { $in: ['unvalidated', 'pending_confirmation'] },
            closed_at: { $gte: thirtyMinutesAgo }
          },
          // Draft auctions that might have gone live
          {
            status: 'draft',
            end_date: { $gt: now }
          }
        ]
      })
      .sort({ end_date: 1 }) // Poll auctions ending soonest first
      .limit(limit)
      .toArray();
  }
  
  /**
   * Poll all auctions that need polling (background task).
   */
  async pollAllAuctionsNeedingAttention(): Promise<{
    polled: number;
    updated: number;
    closesDetected: number;
    extensionsDetected: number;
    errors: number;
  }> {
    const auctions = await this.getAuctionsNeedingPoll(50);
    const result = { polled: 0, updated: 0, closesDetected: 0, extensionsDetected: 0, errors: 0 };
    
    for (const auction of auctions) {
      try {
        result.polled++;
        const pollResult = await this.pollAuction(auction._id!.toString());
        if (pollResult.updated) result.updated++;
        if (pollResult.closeHandled) result.closesDetected++;
        if (auction.status === 'extended') result.extensionsDetected++;
      } catch (error) {
        result.errors++;
        logger.error(`Error polling auction ${auction._id}: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    }
    
    if (result.polled > 0) {
      logger.info(
        `Background poll complete: ${result.polled} polled, ${result.updated} updated, ` +
        `${result.closesDetected} closes, ${result.extensionsDetected} extensions, ${result.errors} errors`
      );
    }
    
    return result;
  }
  
  // Private helpers
  
  private validateAuctionData(extraction: ExtractionResult): string[] {
    const errors: string[] = [];
    
    if (!extraction.data?.title) {
      errors.push('Could not extract auction title');
    }
    
    if (!extraction.data?.status || extraction.data.status === 'pending') {
      errors.push('Could not determine auction status - may not be a valid active auction');
    }
    
    return errors;
  }
  
  private mapStatusToSchema(extractedStatus: string): Auction['status'] {
    switch (extractedStatus) {
      case 'active':
        return 'active';
      case 'sold':
      case 'ended':
      case 'no_sale':
        return 'closed';
      default:
        return 'draft';
    }
  }
  
  private mapSchemaToStatus(schemaStatus: Auction['status']): string {
    switch (schemaStatus) {
      case 'active':
        return 'active';
      case 'extended':
        return 'active'; // Extended auctions are still active on BaT
      case 'closed':
        return 'ended';
      case 'cancelled':
        return 'cancelled';
      default:
        return 'pending';
    }
  }
  
  private async updateAuctionFromExtraction(
    auctionId: string,
    extractedData: any,
    rawHtml?: string,
    htmlHash?: string
  ): Promise<void> {
    const db = get_database();
    const auctions = db.collection<Auction>(COLLECTIONS.auctions);
    
    const updates: Record<string, any> = {
      updated_at: new Date(),
    };
    
    if (extractedData.pricing?.currentBid !== undefined) {
      updates.current_bid = extractedData.pricing.currentBid;
    }
    if (extractedData.pricing?.bidCount !== undefined) {
      updates.bid_count = extractedData.pricing.bidCount;
    }
    if (extractedData.status) {
      const newStatus = this.mapStatusToSchema(extractedData.status);
      updates.status = newStatus;
      
      // Capture final price and close timestamp when auction closes
      if (newStatus === 'closed') {
        updates.closed_at = new Date();
        if (extractedData.pricing?.soldPrice !== undefined) {
          updates.final_price = extractedData.pricing.soldPrice;
        }
        // Extract winning bidder from raw HTML if available
        if (rawHtml) {
          const $ = (await import('cheerio')).load(rawHtml);
          const winningBidder = extractWinningBidder($);
          if (winningBidder) {
            updates.winning_bidder = winningBidder;
          }
        }
      }
    }
    if (extractedData.endTime) {
      // Only update end_date if it represents an extension
      const auction = await this.getAuction(auctionId);
      if (auction && auctionCloseService.detectExtension(auction, extractedData.endTime).isExtended) {
        updates.end_date = extractedData.endTime;
      }
    }
    
    await auctions.updateOne(
      { _id: new ObjectId(auctionId) },
      { $set: updates }
    );
  }
  
  private async updateAuctionFromObservation(auctionId: string, observation: AuctionObservation): Promise<void> {
    const db = get_database();
    const auctions = db.collection<Auction>(COLLECTIONS.auctions);
    
    await auctions.updateOne(
      { _id: new ObjectId(auctionId) },
      { 
        $set: {
          current_bid: observation.current_bid,
          bid_count: observation.bid_count,
          updated_at: new Date(),
        }
      }
    );
  }
  
  private async hashHtml(rawHtml: string): Promise<string> {
    const { createHash } = await import('crypto');
    return createHash('sha256').update(rawHtml).digest('hex');
  }
}

// Singleton instance
export const auctionService = new AuctionService();

// Background polling state
let auction_poll_interval: NodeJS.Timeout | null = null;

/**
 * Start periodic background polling of auctions.
 */
export function start_auction_poll_checker(interval_ms: number = 60000): void {
  if (auction_poll_interval) {
    logger.warn('Auction poll checker already running');
    return;
  }
  
  logger.info(`Starting auction poll checker (interval: ${interval_ms}ms)`);
  
  // Run immediately
  auctionService.pollAllAuctionsNeedingAttention().catch(err => logger.error('Initial auction poll failed:', err));
  
  auction_poll_interval = setInterval(() => {
    auctionService.pollAllAuctionsNeedingAttention().catch(err => logger.error('Periodic auction poll failed:', err));
  }, interval_ms);
}

/**
 * Stop the periodic auction poll checker.
 */
export function stop_auction_poll_checker(): void {
  if (auction_poll_interval) {
    clearInterval(auction_poll_interval);
    auction_poll_interval = null;
    logger.info('Auction poll checker stopped');
  }
}
