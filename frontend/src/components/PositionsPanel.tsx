import React, { useState, useEffect } from 'react';
import { Briefcase, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface PositionDetail {
  outcome_id: string;
  quantity: number;
  average_price: number;
  current_price: number | null;
  unrealized_pnl: number;
  market_value: number;
}

interface PositionSummary {
  user_id: string;
  market_id: string;
  total_positions: number;
  total_unrealized_pnl: number;
  total_realized_pnl: number;
  positions: PositionDetail[];
}

interface PositionsPanelProps {
  marketId: string;
  outcomes?: Array<{ _id: string; title: string }>;
  token: string | null;
}

export const PositionsPanel: React.FC<PositionsPanelProps> = ({ marketId, outcomes, token }) => {
  const [summary, setSummary] = useState<PositionSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/trading/position-summary?market_id=${marketId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (data.success && data.summary && data.summary.length > 0) {
          setSummary(data.summary[0]);
        } else {
          setSummary(null);
        }
      })
      .catch(err => {
        console.error('Failed to fetch positions:', err);
        setSummary(null);
      })
      .finally(() => setLoading(false));
  }, [marketId, token]);

  const getOutcomeName = (outcomeId: string) => {
    return outcomes?.find(o => o._id === outcomeId)?.title || outcomeId.slice(0, 8);
  };

  const formatPnL = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}$${value.toFixed(2)}`;
  };

  const getPnLColor = (value: number) => {
    if (value > 0) return 'text-emerald-400';
    if (value < 0) return 'text-red-400';
    return 'text-gray-400';
  };

  const getPnLBg = (value: number) => {
    if (value > 0) return 'bg-emerald-500/10 border-emerald-500/20';
    if (value < 0) return 'bg-red-500/10 border-red-500/20';
    return 'bg-white/5 border-white/10';
  };

  if (loading) {
    return (
      <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/10 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Briefcase className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Positions</h3>
        </div>
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className="animate-pulse h-16 bg-white/5 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!summary || summary.positions.length === 0) {
    return (
      <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/10 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Briefcase className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Positions</h3>
        </div>
        <div className="text-center py-6">
          <Minus className="w-6 h-6 text-gray-500 mx-auto mb-2" />
          <p className="text-gray-400 text-xs">No open positions</p>
          <p className="text-gray-500 text-[10px] mt-1">Place an order to start trading</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Positions</h3>
        </div>
        <span className="text-[10px] text-gray-400">{summary.total_positions} open</span>
      </div>

      {/* Total P&L Summary */}
      <div className={`rounded-lg border p-3 mb-3 ${getPnLBg(summary.total_unrealized_pnl)}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-300">Unrealized P&L</span>
          <span className={`text-sm font-bold font-mono ${getPnLColor(summary.total_unrealized_pnl)}`}>
            {formatPnL(summary.total_unrealized_pnl)}
          </span>
        </div>
        {summary.total_realized_pnl !== 0 && (
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-gray-400">Realized P&L</span>
            <span className={`text-xs font-mono ${getPnLColor(summary.total_realized_pnl)}`}>
              {formatPnL(summary.total_realized_pnl)}
            </span>
          </div>
        )}
      </div>

      {/* Individual Positions */}
      <div className="space-y-2">
        {summary.positions.map((pos, idx) => {
          const isLong = pos.quantity > 0;
          const isShort = pos.quantity < 0;
          const absQty = Math.abs(pos.quantity);

          return (
            <div key={idx} className="bg-white/5 rounded-lg p-3 border border-white/5 hover:border-white/10 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-white truncate max-w-[120px]">
                  {getOutcomeName(pos.outcome_id)}
                </span>
                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  isLong
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : isShort
                    ? 'bg-red-500/15 text-red-300'
                    : 'bg-gray-500/15 text-gray-300'
                }`}>
                  {isLong ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : isShort ? (
                    <TrendingDown className="w-3 h-3" />
                  ) : null}
                  {isLong ? 'Long' : isShort ? 'Short' : 'Flat'} {absQty}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-gray-500">Avg Price</span>
                  <span className="font-mono text-gray-300">${pos.average_price.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Market</span>
                  <span className="font-mono text-gray-300">
                    {pos.current_price !== null ? `$${pos.current_price.toFixed(2)}` : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Value</span>
                  <span className="font-mono text-gray-300">${pos.market_value.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">P&L</span>
                  <span className={`font-mono font-medium ${getPnLColor(pos.unrealized_pnl)}`}>
                    {formatPnL(pos.unrealized_pnl)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
