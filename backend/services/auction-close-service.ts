import { ObjectId } from 'mongodb';
import { get_database } from '../database/connection.js';
import { Auction, AuctionSnapshot, COLLECTIONS } from '../database/schemas.js';
import { cache_service } from './redis.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('AuctionClose');

export interface CloseValidationResult {
  valid: boolean;
  auction_id: string;
  status: string;
  checks: {
    has_closed_status: boolean;
    has_final_price: boolean;
    has_closed_at: boolean;
    has_close_evidence: boolean;
    observation_count_after_close: number;
    consistent_across_polls: boolean;
  };
  errors: string[];
}

export class AuctionCloseService {
  /**
   * Detect if an auction has been extended based on extracted end time.
   * BaT extends by 2 minutes when a bid is placed in the final 2 minutes.
   */
  detectExtension(auction: Auction, extractedEndTime: Date | null): { isExtended: boolean; newEndDate?: Date } {
    if (!extractedEndTime || !auction.end_date) {
      return { isExtended: false };
    }

    const currentEnd = auction.end_date.getTime();
    const newEnd = extractedEndTime.getTime();
    const thresholdMs = 30 * 1000; // 30 seconds threshold for clock skew

    if (newEnd > currentEnd + thresholdMs) {
      return { isExtended: true, newEndDate: extractedEndTime };
    }

    return { isExtended: false };
  }

  /**
   * Validate that an auction is truly closed before creating resolution proposals.
   * Performs multiple consistency checks and updates the auction's validation state.
   */
  async validateAuctionClose(auctionId: string): Promise<CloseValidationResult> {
    const db = get_database();
    const auction = await db.collection<Auction>(COLLECTIONS.auctions).findOne({
      _id: new ObjectId(auctionId)
    });

    const result: CloseValidationResult = {
      valid: false,
      auction_id: auctionId,
      status: auction?.status || 'unknown',
      checks: {
        has_closed_status: false,
        has_final_price: false,
        has_closed_at: false,
        has_close_evidence: false,
        observation_count_after_close: 0,
        consistent_across_polls: false
      },
      errors: []
    };

    if (!auction) {
      result.errors.push('Auction not found');
      return result;
    }

    // Check 1: Status must be 'closed'
    result.checks.has_closed_status = auction.status === 'closed';
    if (!result.checks.has_closed_status) {
      result.errors.push(`Auction status is '${auction.status}', expected 'closed'`);
    }

    // Check 2: Must have final price
    result.checks.has_final_price =
      auction.final_price !== undefined && auction.final_price !== null && auction.final_price > 0;
    if (!result.checks.has_final_price) {
      result.errors.push('Final price is missing or invalid');
    }

    // Check 3: Must have closed_at timestamp
    result.checks.has_closed_at = auction.closed_at !== undefined && auction.closed_at !== null;
    if (!result.checks.has_closed_at) {
      result.errors.push('Closed timestamp is missing');
    }

    // Check 4: Must have close evidence snapshot archived
    const evidenceCount = await db.collection<AuctionSnapshot>(COLLECTIONS.auction_snapshots).countDocuments({
      auction_id: new ObjectId(auctionId),
      snapshot_type: 'close_evidence'
    });
    result.checks.has_close_evidence = evidenceCount > 0;
    if (!result.checks.has_close_evidence) {
      result.errors.push('No close evidence snapshot archived');
    }

    // Check 5: Should have at least 2 observations after expected close time
    // (to confirm the close state is consistent and not a transient parsing error)
    if (auction.closed_at) {
      const observationsAfterClose = await db.collection(COLLECTIONS.auction_observations).countDocuments({
        auction_id: new ObjectId(auctionId),
        observed_at: { $gte: auction.closed_at }
      });
      result.checks.observation_count_after_close = observationsAfterClose;
      result.checks.consistent_across_polls = observationsAfterClose >= 2;
      if (!result.checks.consistent_across_polls) {
        result.errors.push(`Only ${observationsAfterClose} observation(s) after close time, need at least 2 for confirmation`);
      }
    } else {
      result.errors.push('Cannot verify observation consistency without closed_at');
    }

    // Overall valid only if all critical checks pass
    result.valid =
      result.checks.has_closed_status &&
      result.checks.has_final_price &&
      result.checks.has_closed_at &&
      result.checks.has_close_evidence &&
      result.checks.consistent_across_polls;

    // Update auction validation state in DB
    const newValidationState: Auction['close_validation_state'] = result.valid
      ? 'confirmed'
      : auction.close_validation_state === 'disputed'
        ? 'disputed'
        : 'pending_confirmation';

    await db.collection<Auction>(COLLECTIONS.auctions).updateOne(
      { _id: new ObjectId(auctionId) },
      {
        $set: {
          close_validation_state: newValidationState,
          close_confirmed_at: result.valid ? new Date() : auction.close_confirmed_at,
          updated_at: new Date()
        }
      }
    );

    logger.info(`Close validation for ${auctionId}: valid=${result.valid}, state=${newValidationState}`);
    return result;
  }

  /**
   * Archive an HTML snapshot as evidence for dispute resolution or close validation.
   */
  async archiveEvidence(
    auctionId: string,
    rawHtml: string,
    htmlHash: string,
    parsedData: any,
    type: AuctionSnapshot['snapshot_type']
  ): Promise<AuctionSnapshot> {
    const db = get_database();
    const snapshot: AuctionSnapshot = {
      _id: new ObjectId(),
      auction_id: new ObjectId(auctionId),
      raw_html: rawHtml,
      html_hash: htmlHash,
      parsed_data: parsedData,
      snapshot_type: type,
      created_at: new Date()
    };

    await db.collection<AuctionSnapshot>(COLLECTIONS.auction_snapshots).insertOne(snapshot);
    logger.info(`Archived ${type} snapshot for auction ${auctionId} (${rawHtml.length} chars)`);
    return snapshot;
  }

  /**
   * Handle auction close detection: archive evidence, validate, and broadcast.
   */
  async handleAuctionClosed(auction: Auction, extraction: any): Promise<CloseValidationResult> {
    if (!auction._id) {
      return {
        valid: false,
        auction_id: 'unknown',
        status: 'unknown',
        checks: {
          has_closed_status: false,
          has_final_price: false,
          has_closed_at: false,
          has_close_evidence: false,
          observation_count_after_close: 0,
          consistent_across_polls: false
        },
        errors: ['Auction has no _id']
      };
    }

    const auctionId = auction._id.toString();
    const finalPrice = extraction.pricing?.soldPrice || auction.final_price;

    logger.info(
      `Auction ${auctionId} detected as closed. Final price: ${finalPrice}, ` +
      `winning bidder: ${extraction.winningBidder || auction.winning_bidder || 'unknown'}`
    );

    // Archive close evidence if we have raw HTML
    if (extraction.rawHtml && extraction.htmlHash) {
      await this.archiveEvidence(auctionId, extraction.rawHtml, extraction.htmlHash, extraction.data, 'close_evidence');
    }

    // Validate the close
    const validation = await this.validateAuctionClose(auctionId);

    // Broadcast close notification regardless of validation result
    await this.broadcastAuctionClose(auction, validation);

    return validation;
  }

  /**
   * Broadcast auction close event via Redis pub/sub and WebSocket.
   */
  async broadcastAuctionClose(auction: Auction, validation: CloseValidationResult): Promise<void> {
    const auctionId = auction._id!.toString();

    // Publish to Redis for cross-service communication
    await cache_service.publish_auction_close(auctionId, {
      auction_id: auctionId,
      bat_id: auction.bat_id,
      title: auction.title,
      final_price: auction.final_price,
      closed_at: auction.closed_at,
      validation: {
        valid: validation.valid,
        state: auction.close_validation_state
      }
    });

    // Broadcast via WebSocket
    try {
      const { get_websocket_service } = await import('./websocket.js');
      const ws = get_websocket_service();
      ws.notify_auction_close(auction, validation);
    } catch {
      // WebSocket may not be initialized in tests or during startup
    }
  }

  /**
   * Find prediction markets linked to this auction through events.
   */
  async getLinkedMarkets(auctionId: string): Promise<Array<{ market_id: string; event_id: string; title: string }>> {
    const db = get_database();
    const events = await db
      .collection(COLLECTIONS.events)
      .find({ auction_id: new ObjectId(auctionId) })
      .toArray();

    if (events.length === 0) return [];

    const eventIds = events.map((e: any) => e._id!.toString());
    const markets = await db
      .collection(COLLECTIONS.markets)
      .find({ event_id: { $in: eventIds.map((id: string) => new ObjectId(id)) } })
      .toArray();

    return markets.map((m: any) => ({
      market_id: m._id!.toString(),
      event_id: m.event_id.toString(),
      title: m.title
    }));
  }

  /**
   * Manually confirm an auction close (admin override).
   */
  async confirmClose(auctionId: string, adminUserId?: string): Promise<CloseValidationResult> {
    const db = get_database();

    await db.collection<Auction>(COLLECTIONS.auctions).updateOne(
      { _id: new ObjectId(auctionId) },
      {
        $set: {
          status: 'closed',
          close_validation_state: 'confirmed',
          close_confirmed_at: new Date(),
          updated_at: new Date()
        }
      }
    );

    // Log admin action if user ID provided
    if (adminUserId) {
      await db.collection(COLLECTIONS.admin_actions).insertOne({
        admin_user_id: new ObjectId(adminUserId),
        action_type: 'auction_close_confirmed',
        target_type: 'auction',
        target_id: new ObjectId(auctionId),
        changes: { close_validation_state: 'confirmed' },
        created_at: new Date()
      });
    }

    return this.validateAuctionClose(auctionId);
  }
}

export const auctionCloseService = new AuctionCloseService();
