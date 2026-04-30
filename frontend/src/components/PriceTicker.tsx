import React, { useState, useEffect } from 'react';
import { Activity, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { useWebSocketContext } from '../contexts/WebSocketContext';

interface BboData {
  best_bid: number | null;
  best_ask: number | null;
  spread: number | null;
  mid_price: number | null;
}

interface PriceTickerProps {
  marketId: string;
  outcomeId: string;
  outcomeTitle: string;
  onPriceSelect?: (price: number) => void;
}

export const PriceTicker: React.FC<PriceTickerProps> = ({
  marketId,
  outcomeId,
  outcomeTitle,
  onPriceSelect
}) => {
  const { lastPrices } = useWebSocketContext();
  const [bbo, setBbo] = useState<BboData | null>(null);
  const [loading, setLoading] = useState(true);

  const priceData = lastPrices.get(`${marketId}:${outcomeId}`);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/trading/bbo/${marketId}/${outcomeId}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setBbo(data.bbo);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [marketId, outcomeId]);

  const lastPrice = priceData?.last_trade_price ?? null;
  const bestBid = priceData?.best_bid ?? bbo?.best_bid ?? null;
  const bestAsk = priceData?.best_ask ?? bbo?.best_ask ?? null;
  const spread = priceData?.spread ?? bbo?.spread ?? null;
  const midPrice = priceData?.mid_price ?? bbo?.mid_price ?? null;

  if (loading) {
    return (
      <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/10 p-4 animate-pulse">
        <div className="h-4 bg-white/10 rounded w-1/3 mb-2"></div>
        <div className="h-8 bg-white/10 rounded w-1/2"></div>
      </div>
    );
  }

  return (
    <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">{outcomeTitle}</h3>
        </div>
        {lastPrice !== null && (
          <span className="text-lg font-bold font-mono text-yellow-400">
            ${lastPrice.toFixed(2)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-emerald-500/10 rounded-lg p-2 text-center border border-emerald-500/10">
          <div className="text-[10px] text-emerald-400/80 mb-0.5 flex items-center justify-center gap-1">
            <ArrowDown className="w-3 h-3" /> Bid
          </div>
          <div className="text-sm font-mono font-semibold text-emerald-300">
            {bestBid !== null ? `$${bestBid.toFixed(2)}` : '—'}
          </div>
          {bestBid !== null && onPriceSelect && (
            <button
              onClick={() => onPriceSelect(bestBid)}
              className="text-[10px] text-emerald-400/60 hover:text-emerald-400 mt-1 transition-colors"
            >
              Use for order
            </button>
          )}
        </div>

        <div className="bg-white/5 rounded-lg p-2 text-center border border-white/5">
          <div className="text-[10px] text-gray-400 mb-0.5 flex items-center justify-center gap-1">
            <Minus className="w-3 h-3" /> Spread
          </div>
          <div className="text-sm font-mono font-semibold text-gray-300">
            {spread !== null ? `$${spread.toFixed(2)}` : '—'}
          </div>
          {midPrice !== null && (
            <div className="text-[10px] text-gray-500 mt-1">Mid ${midPrice.toFixed(2)}</div>
          )}
        </div>

        <div className="bg-red-500/10 rounded-lg p-2 text-center border border-red-500/10">
          <div className="text-[10px] text-red-400/80 mb-0.5 flex items-center justify-center gap-1">
            <ArrowUp className="w-3 h-3" /> Ask
          </div>
          <div className="text-sm font-mono font-semibold text-red-300">
            {bestAsk !== null ? `$${bestAsk.toFixed(2)}` : '—'}
          </div>
          {bestAsk !== null && onPriceSelect && (
            <button
              onClick={() => onPriceSelect(bestAsk)}
              className="text-[10px] text-red-400/60 hover:text-red-400 mt-1 transition-colors"
            >
              Use for order
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
