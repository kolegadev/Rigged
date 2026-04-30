import React, { useMemo } from 'react';
import { BookOpen, ArrowDown, ArrowUp } from 'lucide-react';
import { useWebSocketContext } from '../contexts/WebSocketContext';

interface OrderBookProps {
  marketId: string;
  outcomeId: string;
  outcomeTitle: string;
}

export const OrderBook: React.FC<OrderBookProps> = ({ marketId, outcomeId, outcomeTitle }) => {
  const { orderBooks, lastPrices } = useWebSocketContext();
  const book = orderBooks.get(`${marketId}:${outcomeId}`);
  const priceData = lastPrices.get(`${marketId}:${outcomeId}`);

  const maxSize = useMemo(() => {
    if (!book) return 1;
    const allSizes = [...book.bids.map(b => b.size), ...book.asks.map(a => a.size)];
    return Math.max(1, ...allSizes);
  }, [book]);

  const spread = useMemo(() => {
    if (!book) return null;
    const bestBid = book.bids[0]?.price ?? null;
    const bestAsk = book.asks[0]?.price ?? null;
    if (bestBid !== null && bestAsk !== null) return bestAsk - bestBid;
    return priceData?.spread ?? null;
  }, [book, priceData]);

  const midPrice = useMemo(() => {
    if (spread !== null && book) {
      const bestBid = book.bids[0]?.price;
      const bestAsk = book.asks[0]?.price;
      if (bestBid !== undefined && bestAsk !== undefined) {
        return (bestBid + bestAsk) / 2;
      }
    }
    return priceData?.mid_price ?? null;
  }, [book, spread, priceData]);

  const lastTradePrice = priceData?.last_trade_price ?? null;

  if (!book) {
    return (
      <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/10 p-4">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-white">{outcomeTitle}</h3>
        </div>
        <p className="text-gray-400 text-xs text-center py-6">Waiting for orders...</p>
      </div>
    );
  }

  return (
    <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-white">{outcomeTitle}</h3>
        </div>
        {lastTradePrice !== null && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-gray-400">Last</span>
            <span className="font-mono font-semibold text-yellow-400">${lastTradePrice.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Header */}
      <div className="grid grid-cols-[1fr_80px_1fr] gap-2 text-[10px] uppercase tracking-wider text-gray-500 mb-1 px-1">
        <div className="text-right">Size</div>
        <div className="text-center">Price</div>
        <div className="text-left">Size</div>
      </div>

      {/* Asks (Red) — best ask closest to spread (bottom of ask section) */}
      <div className="space-y-0.5">
        {[...book.asks].reverse().map((level, idx) => (
          <div key={`ask-${idx}`} className="grid grid-cols-[1fr_80px_1fr] gap-2 items-center text-xs group">
            <div className="flex items-center justify-end gap-1.5">
              <span className="text-gray-400 tabular-nums">{level.size}</span>
              <div className="w-16 h-4 relative rounded-sm overflow-hidden bg-red-500/5">
                <div
                  className="absolute right-0 top-0 h-full bg-red-500/20 rounded-sm transition-all duration-500"
                  style={{ width: `${(level.size / maxSize) * 100}%` }}
                />
              </div>
            </div>
            <div className="text-center">
              <span className="font-mono text-red-300 font-medium">${level.price.toFixed(2)}</span>
            </div>
            <div />
          </div>
        ))}
      </div>

      {/* Spread / Mid Price */}
      <div className="flex items-center justify-center gap-3 py-2 my-1 border-y border-white/10">
        {spread !== null ? (
          <span className="text-[10px] font-mono text-gray-400 bg-white/5 px-2 py-0.5 rounded">
            Spread ${spread.toFixed(2)}
          </span>
        ) : (
          <span className="text-[10px] font-mono text-gray-500">—</span>
        )}
        {midPrice !== null && (
          <span className="text-[10px] font-mono text-blue-300 bg-blue-500/10 px-2 py-0.5 rounded">
            Mid ${midPrice.toFixed(2)}
          </span>
        )}
      </div>

      {/* Bids (Green) */}
      <div className="space-y-0.5">
        {book.bids.map((level, idx) => (
          <div key={`bid-${idx}`} className="grid grid-cols-[1fr_80px_1fr] gap-2 items-center text-xs group">
            <div />
            <div className="text-center">
              <span className="font-mono text-emerald-300 font-medium">${level.price.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-start gap-1.5">
              <div className="w-16 h-4 relative rounded-sm overflow-hidden bg-emerald-500/5">
                <div
                  className="absolute left-0 top-0 h-full bg-emerald-500/20 rounded-sm transition-all duration-500"
                  style={{ width: `${(level.size / maxSize) * 100}%` }}
                />
              </div>
              <span className="text-gray-400 tabular-nums">{level.size}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Stats Footer */}
      <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-gray-500">
        <div className="flex items-center gap-3">
          {priceData?.best_bid !== undefined && (
            <span className="flex items-center gap-1">
              <ArrowDown className="w-3 h-3 text-emerald-400" />
              Bid ${priceData.best_bid.toFixed(2)}
            </span>
          )}
          {priceData?.best_ask !== undefined && (
            <span className="flex items-center gap-1">
              <ArrowUp className="w-3 h-3 text-red-400" />
              Ask ${priceData.best_ask.toFixed(2)}
            </span>
          )}
        </div>
        <span>{book.bids.length} bid · {book.asks.length} ask</span>
      </div>
    </div>
  );
};
