import React, { useState, useEffect, useMemo } from 'react';
import { Activity, TrendingUp, TrendingDown } from 'lucide-react';
import { useWebSocketContext } from '../contexts/WebSocketContext';

interface HistoricalTrade {
  _id: string;
  market_id: string;
  outcome_id: string;
  price: number;
  quantity: number;
  timestamp: string;
  buyer_user_id: string;
  seller_user_id: string;
}

interface MyTrade {
  _id: string;
  market_id: string;
  outcome_id: string;
  price: number;
  quantity: number;
  timestamp: string;
  buyer_user_id: string;
  seller_user_id: string;
  side: 'buy' | 'sell';
}

interface TradeHistoryProps {
  marketId: string;
  outcomes?: Array<{ _id: string; title: string }>;
  token: string | null;
  userId?: string;
}

export const TradeHistory: React.FC<TradeHistoryProps> = ({ marketId, outcomes, token, userId }) => {
  const { trades: liveTrades } = useWebSocketContext();
  const [activeTab, setActiveTab] = useState<'market' | 'my'>('market');
  const [historicalTrades, setHistoricalTrades] = useState<HistoricalTrade[]>([]);
  const [myTrades, setMyTrades] = useState<MyTrade[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch historical market trades
  useEffect(() => {
    setLoading(true);
    fetch(`/api/trading/trades/${marketId}?limit=50`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setHistoricalTrades(data.trades || []);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [marketId]);

  // Fetch my trades
  useEffect(() => {
    if (!token) return;
    fetch(`/api/trading/my-trades?market_id=${marketId}&limit=50`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (data.success && data.trades) {
          const enriched = data.trades.map((t: HistoricalTrade) => ({
            ...t,
            side: t.buyer_user_id === userId ? 'buy' : 'sell'
          }));
          setMyTrades(enriched);
        }
      })
      .catch(console.error);
  }, [marketId, token, userId]);

  // Merge live WS trades with historical market trades
  const mergedMarketTrades = useMemo(() => {
    const liveForMarket = liveTrades.filter(t => t.market_id === marketId);
    const dedupedHistorical = historicalTrades.filter(ht => {
      const ts = new Date(ht.timestamp).getTime();
      return !liveForMarket.some(lt =>
        lt.price === ht.price && lt.quantity === ht.quantity && Math.abs(lt.timestamp - ts) < 1000
      );
    });

    const combined = [
      ...liveForMarket.map(t => ({
        _id: `live-${t.timestamp}`,
        market_id: t.market_id,
        outcome_id: t.outcome_id,
        price: t.price,
        quantity: t.quantity,
        timestamp: new Date(t.timestamp).toISOString(),
        buyer_user_id: t.buyer_user_id || '',
        seller_user_id: t.seller_user_id || '',
        isLive: true
      })),
      ...dedupedHistorical.map(t => ({ ...t, isLive: false }))
    ];

    return combined.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    ).slice(0, 50);
  }, [liveTrades, historicalTrades, marketId]);

  const getOutcomeName = (outcomeId: string) => {
    return outcomes?.find(o => o._id === outcomeId)?.title || outcomeId.slice(0, 8);
  };

  const formatTime = (ts: string | number) => {
    const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-semibold text-white">Trade History</h3>
        </div>
        <div className="flex bg-white/5 rounded-lg p-0.5">
          <button
            onClick={() => setActiveTab('market')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
              activeTab === 'market'
                ? 'bg-white/10 text-white'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            Market
          </button>
          <button
            onClick={() => setActiveTab('my')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
              activeTab === 'my'
                ? 'bg-white/10 text-white'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            My Trades
          </button>
        </div>
      </div>

      {loading && activeTab === 'market' ? (
        <div className="space-y-2 py-4">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="animate-pulse h-6 bg-white/5 rounded"></div>
          ))}
        </div>
      ) : activeTab === 'market' ? (
        <div className="space-y-0">
          <div className="grid grid-cols-[60px_1fr_60px_60px_60px] gap-2 text-[10px] uppercase tracking-wider text-gray-500 mb-1 px-1">
            <div>Time</div>
            <div>Outcome</div>
            <div className="text-right">Price</div>
            <div className="text-right">Size</div>
            <div className="text-right">Total</div>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {mergedMarketTrades.length === 0 ? (
              <p className="text-gray-400 text-xs text-center py-6">No trades yet</p>
            ) : (
              mergedMarketTrades.map((trade, idx) => (
                <div
                  key={trade._id || idx}
                  className={`grid grid-cols-[60px_1fr_60px_60px_60px] gap-2 items-center text-xs py-1.5 px-1 rounded ${
                    (trade as any).isLive ? 'bg-yellow-500/5' : 'hover:bg-white/5'
                  } transition-colors`}
                >
                  <span className="text-gray-400 tabular-nums">{formatTime(trade.timestamp)}</span>
                  <span className="text-gray-300 truncate">{getOutcomeName(trade.outcome_id)}</span>
                  <span className="text-right font-mono text-white">${trade.price.toFixed(2)}</span>
                  <span className="text-right font-mono text-gray-300">{trade.quantity}</span>
                  <span className="text-right font-mono text-emerald-400">${(trade.price * trade.quantity).toFixed(2)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-0">
          <div className="grid grid-cols-[60px_1fr_50px_50px_60px] gap-2 text-[10px] uppercase tracking-wider text-gray-500 mb-1 px-1">
            <div>Time</div>
            <div>Outcome</div>
            <div className="text-right">Side</div>
            <div className="text-right">Price</div>
            <div className="text-right">Size</div>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {myTrades.length === 0 ? (
              <p className="text-gray-400 text-xs text-center py-6">No trades yet</p>
            ) : (
              myTrades.map((trade, idx) => (
                <div
                  key={trade._id || idx}
                  className="grid grid-cols-[60px_1fr_50px_50px_60px] gap-2 items-center text-xs py-1.5 px-1 rounded hover:bg-white/5 transition-colors"
                >
                  <span className="text-gray-400 tabular-nums">{formatTime(trade.timestamp)}</span>
                  <span className="text-gray-300 truncate">{getOutcomeName(trade.outcome_id)}</span>
                  <div className="text-right">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${
                      trade.side === 'buy' ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {trade.side === 'buy' ? (
                        <><TrendingUp className="w-3 h-3" />Buy</>
                      ) : (
                        <><TrendingDown className="w-3 h-3" />Sell</>
                      )}
                    </span>
                  </div>
                  <span className="text-right font-mono text-white">${trade.price.toFixed(2)}</span>
                  <span className="text-right font-mono text-gray-300">{trade.quantity}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
