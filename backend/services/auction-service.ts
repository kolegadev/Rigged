import { ObjectId } from 'mongodb';
import { get_database } from '../database/connection.js';
import { Auction, AuctionObservation, COLLECTIONS } from '../database/schemas.js';
import { parseBatUrl, extractAuctionMetadata, type ExtractionResult } from './bat-parser.js';

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
    console.log(`[AuctionService] Starting import for: ${url}`);
    
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
      console.log(`[AuctionService] Auction already exists: ${existing._id}`);
      return {
        success: false,
        error: 'Auction already exists',
        auction: existing,
      };
    }
    
    // Step 3: Extract metadata from BaT
    const extraction = await extractAuctionMetadata(normalizedUrl!);
    
    if (!extraction.success && !skipValidation) {
      console.log(`[AuctionService] Extraction failed: ${extraction.errors.join(', ')}`);
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
      end_date: extraction.data?.endTime || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Default to 7 days
      is_live: extraction.data?.status === 'active',
      current_bid: extraction.data?.pricing?.currentBid || undefined,
      bid_count: extraction.data?.pricing?.bidCount || 0,
      
      // Final results (empty for new auctions)
      final_price: extraction.data?.pricing?.soldPrice || undefined,
      winning_bidder: undefined,
      closed_at: extraction.data?.status === 'sold' || extraction.data?.status === 'ended' ? now : undefined,
      
      // Metadata
      status: this.mapStatusToSchema(extraction.data?.status || 'pending'),
      created_at: now,
      updated_at: now,
      created_by: adminUserId ? new ObjectId(adminUserId) : new ObjectId(), // TODO: Get from auth context
    };
    
    // Step 6: Store evidence snapshot if available
    if (extraction.rawHtml) {
      await this.storeSnapshot({
        auctionId: auctionId,
        rawHtml: extraction.rawHtml,
        htmlHash: extraction.htmlHash,
        extractedData: extraction.data,
        extractionErrors: extraction.errors,
      });
    }
    
    // Step 7: Insert auction
    await auctions.insertOne(auction);
    
    // Step 8: Create initial observation
    if (extraction.data) {
      await this.recordObservation(auction, extraction.data);
    }
    
    console.log(`[AuctionService] Successfully imported auction: ${listingId} (${auction.status})`);
    
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
   * Record a new observation for an auction
   */
  async recordObservation(auction: Auction, extractedData: any): Promise<AuctionObservation> {
    const db = get_database();
    const observations = db.collection<AuctionObservation>(COLLECTIONS.auction_observations);
    const now = new Date();
    
    // Calculate time remaining
    const timeRemainingSeconds = auction.end_date 
      ? Math.max(0, Math.floor((auction.end_date.getTime() - now.getTime()) / 1000))
      : 0;
    
    const observation: AuctionObservation = {
      _id: new ObjectId(),
      auction_id: auction._id!,
      observed_at: now,
      current_bid: extractedData.pricing?.currentBid || auction.current_bid || 0,
      bid_count: extractedData.pricing?.bidCount || auction.bid_count || 0,
      time_left_seconds: timeRemainingSeconds,
      is_extended: false, // TODO: Detect extensions
      created_at: now,
    };
    
    await observations.insertOne(observation);
    
    // Update auction with latest observation data
    await this.updateAuctionFromObservation(auction._id!.toString(), observation);
    
    return observation;
  }
  
  /**
   * Poll an auction for updates
   */
  async pollAuction(auctionId: string): Promise<{ updated: boolean; auction: Auction | null }> {
    const auction = await this.getAuction(auctionId);
    if (!auction) {
      return { updated: false, auction: null };
    }
    
    // Extract fresh data
    const extraction = await extractAuctionMetadata(auction.url);
    
    if (!extraction.success) {
      console.log(`[AuctionService] Poll failed for ${auctionId}: ${extraction.errors.join(', ')}`);
      return { updated: false, auction };
    }
    
    // Store snapshot
    if (extraction.rawHtml) {
      await this.storeSnapshot({
        auctionId: auction._id!,
        rawHtml: extraction.rawHtml,
        htmlHash: extraction.htmlHash,
        extractedData: extraction.data,
        extractionErrors: extraction.errors,
      });
    }
    
    // Detect changes
    const hasChanges = 
      extraction.data?.pricing?.currentBid !== auction.current_bid ||
      extraction.data?.pricing?.bidCount !== auction.bid_count ||
      extraction.data?.status !== this.mapSchemaToStatus(auction.status);
    
    // Update auction if needed
    if (hasChanges && extraction.data) {
      await this.updateAuctionFromExtraction(auctionId, extraction.data);
    }
    
    // Record observation
    if (extraction.data) {
      await this.recordObservation(auction, extraction.data);
    }
    
    const updatedAuction = await this.getAuction(auctionId);
    return { updated: hasChanges, auction: updatedAuction };
  }
  
  /**
   * Get auctions that need polling (active/live auctions)
   */
  async getAuctionsNeedingPoll(limit = 10): Promise<Auction[]> {
    const db = get_database();
    const auctions = db.collection<Auction>(COLLECTIONS.auctions);
    
    return auctions
      .find({
        status: { $in: ['active', 'draft'] }, // Poll active and draft auctions
        end_date: { $gt: new Date() }, // Only poll auctions that haven't ended
      })
      .sort({ end_date: 1 }) // Poll auctions ending soonest first
      .limit(limit)
      .toArray();
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
      case 'closed':
        return 'ended';
      case 'cancelled':
        return 'cancelled';
      default:
        return 'pending';
    }
  }
  
  private async updateAuctionFromExtraction(auctionId: string, extractedData: any): Promise<void> {
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
      updates.status = this.mapStatusToSchema(extractedData.status);
    }
    if (extractedData.pricing?.soldPrice !== undefined) {
      updates.final_price = extractedData.pricing.soldPrice;
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
  
  private async storeSnapshot(data: {
    auctionId: ObjectId;
    rawHtml: string;
    htmlHash: string;
    extractedData: any;
    extractionErrors: string[];
  }): Promise<void> {
    // For now, we'll store snapshots in the observation records
    // In a production system, you'd want a separate snapshots collection
    // or use GridFS for large HTML documents
    console.log(`[AuctionService] Storing snapshot for auction ${data.auctionId}, ${data.rawHtml.length} characters`);
  }
}

// Singleton instance
export const auctionService = new AuctionService();