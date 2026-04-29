import * as cheerio from 'cheerio';
import crypto from 'crypto';

// URL parsing
const BAT_URL_PATTERNS = [
  // Standard listing URL
  /^https?:\/\/(www\.)?bringatrailer\.com\/listing\/([a-z0-9-]+)\/?$/i,
  // Auction URL format
  /^https?:\/\/(www\.)?bringatrailer\.com\/auction\/([a-z0-9-]+)\/?$/i,
];

export interface ParsedBatUrl {
  isValid: boolean;
  normalizedUrl: string | null;
  listingId: string | null;
  errors: string[];
}

export function parseBatUrl(url: string): ParsedBatUrl {
  const errors: string[] = [];
  
  if (!url || typeof url !== 'string') {
    return { isValid: false, normalizedUrl: null, listingId: null, errors: ['URL is required'] };
  }
  
  const trimmedUrl = url.trim();
  
  for (const pattern of BAT_URL_PATTERNS) {
    const match = trimmedUrl.match(pattern);
    if (match) {
      const listingId = match[2].toLowerCase();
      const normalizedUrl = `https://bringatrailer.com/listing/${listingId}/`;
      
      return {
        isValid: true,
        normalizedUrl,
        listingId,
        errors: [],
      };
    }
  }
  
  // Check if it's a BaT URL but wrong format
  if (trimmedUrl.includes('bringatrailer.com')) {
    errors.push('URL appears to be from BaT but is not a valid listing URL');
    errors.push('Expected format: https://bringatrailer.com/listing/[listing-id]/');
  } else {
    errors.push('URL must be from bringatrailer.com');
  }
  
  return { isValid: false, normalizedUrl: null, listingId: null, errors };
}

// Vehicle information interface
export interface VehicleInfo {
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  mileage: number | null;
  transmission: string | null;
  engine: string | null;
  location: string | null;
}

export interface AuctionPricing {
  currentBid: number | null;
  bidCount: number;
  reserveStatus: 'unknown' | 'reserve_not_met' | 'reserve_met' | 'no_reserve';
  soldPrice: number | null;
}

export interface AuctionMetadata {
  seller: {
    username: string | null;
  };
  images: string[];
  commentCount: number;
}

// Extraction result interface
export interface ExtractionResult {
  success: boolean;
  data: {
    title: string | null;
    description: string | null;
    vehicle: VehicleInfo;
    pricing: AuctionPricing;
    metadata: AuctionMetadata;
    endTime: Date | null;
    status: 'active' | 'ended' | 'sold' | 'no_sale' | 'pending';
  } | null;
  rawHtml: string;
  htmlHash: string;
  errors: string[];
  warnings: string[];
}

export async function extractAuctionMetadata(url: string): Promise<ExtractionResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Fetch the page
  let rawHtml: string;
  try {
    console.log(`[BaT Parser] Fetching: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        errors.push('Auction listing not found (404)');
      } else if (response.status === 403) {
        errors.push('Access forbidden - may be rate limited');
      } else {
        errors.push(`HTTP error: ${response.status} ${response.statusText}`);
      }
      return { success: false, data: null, rawHtml: '', htmlHash: '', errors, warnings };
    }
    
    rawHtml = await response.text();
    console.log(`[BaT Parser] Fetched ${rawHtml.length} characters`);
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'TimeoutError') {
        errors.push('Request timed out after 30 seconds');
      } else {
        errors.push(`Fetch error: ${error.message}`);
      }
    }
    return { success: false, data: null, rawHtml: '', htmlHash: '', errors, warnings };
  }
  
  const htmlHash = crypto.createHash('sha256').update(rawHtml).digest('hex');
  
  // Parse HTML
  const $ = cheerio.load(rawHtml);
  
  // Extract data with error handling for each field
  try {
    const title = extractTitle($);
    const description = extractDescription($);
    const vehicle = extractVehicleInfo($, warnings);
    const pricing = extractPricing($, warnings);
    const metadata = extractMetadata($, warnings);
    const endTime = extractEndTime($);
    const status = determineStatus($, pricing);
    
    const extractedData = {
      title,
      description,
      vehicle,
      pricing,
      metadata,
      endTime,
      status,
    };
    
    console.log(`[BaT Parser] Extracted: ${title}, Status: ${status}, Current bid: $${pricing.currentBid}`);
    
    return {
      success: errors.length === 0,
      data: extractedData,
      rawHtml,
      htmlHash,
      errors,
      warnings,
    };
  } catch (error) {
    errors.push(`Parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { success: false, data: null, rawHtml, htmlHash, errors, warnings };
  }
}

function extractTitle($: cheerio.CheerioAPI): string | null {
  // Try multiple selectors for robustness
  const selectors = [
    'h1.post-title',
    'h1.listing-post-title', 
    '.listing-title h1',
    'h1',
  ];
  
  for (const selector of selectors) {
    const text = $(selector).first().text().trim();
    if (text && text.length > 5) {
      return text;
    }
  }
  
  // Fallback: try meta title
  const metaTitle = $('meta[property="og:title"]').attr('content');
  if (metaTitle) {
    return metaTitle.replace(' - Bring a Trailer', '').trim();
  }
  
  return null;
}

function extractVehicleInfo($: cheerio.CheerioAPI, warnings: string[]): VehicleInfo {
  const info: VehicleInfo = {
    year: null,
    make: null,
    model: null,
    vin: null,
    mileage: null,
    transmission: null,
    engine: null,
    location: null,
  };
  
  // Extract from essentials list
  $('.listing-essentials-item, .essentials-item, .listing-details li').each((_, el) => {
    const label = $(el).find('.label, .item-label, strong').first().text().toLowerCase().trim();
    const value = $(el).find('.value, .item-value').last().text().trim() || 
                  $(el).text().replace($(el).find('.label, .item-label, strong').text(), '').trim();
    
    if (!value || value.toLowerCase().includes('listing details')) return;
    
    switch (true) {
      case label.includes('location'):
        info.location = value;
        break;
      case label.includes('mileage') || label.includes('odometer'):
        const mileageMatch = value.match(/^([\d,]+)/);
        if (mileageMatch) {
          info.mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
        }
        break;
      case label.includes('vin'):
        info.vin = value;
        break;
      case label.includes('transmission'):
        info.transmission = value;
        break;
      case label.includes('engine'):
        info.engine = value;
        break;
    }
  });
  
  // Try to parse year/make/model from title
  const title = extractTitle($);
  if (title) {
    const yearMatch = title.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      info.year = parseInt(yearMatch[0]);
    }
    
    // Common makes to look for (case-insensitive)
    const makes = ['Porsche', 'BMW', 'Mercedes-Benz', 'Mercedes', 'Ferrari', 'Lamborghini', 
                   'Audi', 'Toyota', 'Honda', 'Ford', 'Chevrolet', 'Chevy', 'Dodge', 
                   'Nissan', 'Mazda', 'Volkswagen', 'VW', 'Subaru', 'Lexus', 'Acura',
                   'Land Rover', 'Jaguar', 'Alfa Romeo', 'Fiat', 'Maserati', 'Aston Martin',
                   'Bentley', 'Rolls-Royce', 'McLaren', 'Lotus', 'Triumph', 'MG', 'Austin-Healey'];
    
    for (const make of makes) {
      if (title.toLowerCase().includes(make.toLowerCase())) {
        info.make = make;
        // Try to extract model (word after make)
        const makeRegex = new RegExp(`${make}\\s+([A-Za-z0-9-]+)`, 'i');
        const modelMatch = title.match(makeRegex);
        if (modelMatch && modelMatch[1]) {
          info.model = modelMatch[1];
        }
        break;
      }
    }
  }
  
  return info;
}

function extractPricing($: cheerio.CheerioAPI, warnings: string[]): AuctionPricing {
  const pricing: AuctionPricing = {
    currentBid: null,
    bidCount: 0,
    reserveStatus: 'unknown',
    soldPrice: null,
  };
  
  // Current bid - try multiple selectors
  const bidSelectors = ['.current-bid', '.bid-value', '.listing-bid-value', '.current-high-bid'];
  for (const selector of bidSelectors) {
    const bidText = $(selector).first().text();
    const bidMatch = bidText.match(/\$?([\d,]+)/);
    if (bidMatch) {
      pricing.currentBid = parseInt(bidMatch[1].replace(/,/g, ''));
      break;
    }
  }
  
  // Bid count
  const bidCountSelectors = ['.bid-count', '.listing-bid-count', '.bids-count'];
  for (const selector of bidCountSelectors) {
    const bidCountText = $(selector).first().text();
    const bidCountMatch = bidCountText.match(/(\d+)\s*bids?/i);
    if (bidCountMatch) {
      pricing.bidCount = parseInt(bidCountMatch[1]);
      break;
    }
  }
  
  // Reserve status
  const pageText = $('body').text().toLowerCase();
  if (pageText.includes('reserve not met') || pageText.includes('reserve not yet met')) {
    pricing.reserveStatus = 'reserve_not_met';
  } else if (pageText.includes('reserve met') || pageText.includes('reserve has been met')) {
    pricing.reserveStatus = 'reserve_met';
  } else if (pageText.includes('no reserve')) {
    pricing.reserveStatus = 'no_reserve';
  }
  
  // Sold price (if auction ended)
  const soldSelectors = ['.sold-price', '.final-bid', '.winning-bid'];
  for (const selector of soldSelectors) {
    const soldText = $(selector).first().text();
    const soldMatch = soldText.match(/\$?([\d,]+)/);
    if (soldMatch) {
      pricing.soldPrice = parseInt(soldMatch[1].replace(/,/g, ''));
      break;
    }
  }
  
  return pricing;
}

function extractEndTime($: cheerio.CheerioAPI): Date | null {
  // Look for end time in various formats
  const timeElements = [
    $('[data-ends], [data-auction-end]').attr('data-ends') || 
    $('[data-ends], [data-auction-end]').attr('data-auction-end'),
    $('time.auction-end, time.end-time').attr('datetime'),
  ];
  
  for (const timeStr of timeElements) {
    if (timeStr) {
      const parsed = new Date(timeStr);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }
  
  // Try to parse from text like "Ends in 2d 5h"
  const endsText = $('.time-remaining, .auction-ends, .ends-in').first().text();
  const parsed = parseRelativeTime(endsText);
  if (parsed) {
    return parsed;
  }
  
  return null;
}

function parseRelativeTime(text: string): Date | null {
  if (!text) return null;
  
  const now = new Date();
  let totalMs = 0;
  
  const dayMatch = text.match(/(\d+)\s*d/i);
  const hourMatch = text.match(/(\d+)\s*h/i);
  const minMatch = text.match(/(\d+)\s*m(?:in)?/i);
  
  if (dayMatch) totalMs += parseInt(dayMatch[1]) * 24 * 60 * 60 * 1000;
  if (hourMatch) totalMs += parseInt(hourMatch[1]) * 60 * 60 * 1000;
  if (minMatch) totalMs += parseInt(minMatch[1]) * 60 * 1000;
  
  if (totalMs > 0) {
    return new Date(now.getTime() + totalMs);
  }
  
  return null;
}

function determineStatus($: cheerio.CheerioAPI, pricing: AuctionPricing): 'active' | 'ended' | 'sold' | 'no_sale' | 'pending' {
  const pageText = $('body').text().toLowerCase();
  
  if (pageText.includes('sold for') || pageText.includes('winning bid')) {
    return 'sold';
  }
  if (pageText.includes('bid did not meet') || (pageText.includes('reserve not met') && pageText.includes('ended'))) {
    return 'no_sale';
  }
  if (pageText.includes('auction ended') || pageText.includes('this auction has ended')) {
    return pricing.soldPrice ? 'sold' : 'ended';
  }
  
  // Check for active indicators
  if ($('.time-remaining, .auction-ends').length > 0) {
    return 'active';
  }
  
  return 'pending';
}

function extractMetadata($: cheerio.CheerioAPI, warnings: string[]): AuctionMetadata {
  const metadata: AuctionMetadata = {
    seller: {
      username: null,
    },
    images: [],
    commentCount: 0,
  };
  
  // Seller info
  const sellerLink = $('.seller-info a, .listing-seller a').first();
  if (sellerLink.length) {
    metadata.seller.username = sellerLink.text().trim();
  }
  
  // Images
  $('img.gallery-image, .listing-gallery img, .carousel-image').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    if (src && src.includes('bringatrailer')) {
      metadata.images.push(src);
    }
  });
  
  // Also check og:image
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage && !metadata.images.includes(ogImage)) {
    metadata.images.unshift(ogImage);
  }
  
  // Comment count
  const commentText = $('.comment-count, .comments-count').first().text();
  const commentMatch = commentText.match(/(\d+)/);
  if (commentMatch) {
    metadata.commentCount = parseInt(commentMatch[1]);
  }
  
  return metadata;
}

function extractDescription($: cheerio.CheerioAPI): string | null {
  const descEl = $('.listing-description, .post-content, .listing-content').first();
  if (descEl.length) {
    return descEl.text().trim().substring(0, 5000); // Limit length
  }
  
  const metaDesc = $('meta[property="og:description"]').attr('content');
  return metaDesc || null;
}

export const _internal = {
  extractTitle,
  extractVehicleInfo,
  extractPricing,
  extractEndTime,
  parseRelativeTime,
  determineStatus,
};