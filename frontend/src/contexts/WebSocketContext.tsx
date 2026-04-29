import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:9002';

export interface TradeEvent {
  market_id: string;
  outcome_id: string;
  price: number;
  quantity: number;
  timestamp: number;
  buyer_user_id?: string;
  seller_user_id?: string;
}

export interface OrderBookEvent {
  market_id: string;
  outcome_id: string;
  bids: { price: number; size: number }[];
  asks: { price: number; size: number }[];
  timestamp: number;
}

export interface MarketStatusEvent {
  market_id: string;
  previous_status: string;
  new_status: string;
  timestamp: number;
  reason: string;
}

interface WebSocketContextValue {
  connected: boolean;
  authenticated: boolean;
  trades: TradeEvent[];
  orderBooks: Map<string, OrderBookEvent>;
  marketStatuses: Map<string, MarketStatusEvent>;
  subscribeMarket: (marketId: string) => void;
  unsubscribeMarket: (marketId: string) => void;
  subscribeOrderBook: (marketId: string, outcomeId: string) => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

const MAX_TRADES = 50;

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [orderBooks, setOrderBooks] = useState<Map<string, OrderBookEvent>>(new Map());
  const [marketStatuses, setMarketStatuses] = useState<Map<string, MarketStatusEvent>>(new Map());

  useEffect(() => {
    const token = localStorage.getItem('auth_token');

    const socket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      if (token) {
        socket.emit('authenticate', { user_id: 'me', auth_token: token });
      }
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setAuthenticated(false);
    });

    socket.on('authenticated', (data: { success: boolean }) => {
      setAuthenticated(data.success);
    });

    socket.on('trade_executed', (data: TradeEvent) => {
      setTrades(prev => [data, ...prev].slice(0, MAX_TRADES));
    });

    socket.on('orderbook_update', (data: OrderBookEvent) => {
      setOrderBooks(prev => {
        const next = new Map(prev);
        next.set(`${data.market_id}:${data.outcome_id}`, data);
        return next;
      });
    });

    socket.on('market_update', (data: any) => {
      if (data.type === 'market_status_change') {
        setMarketStatuses(prev => {
          const next = new Map(prev);
          next.set(data.market_id, {
            market_id: data.market_id,
            previous_status: data.previous_status || data.data?.previous_status,
            new_status: data.new_status || data.data?.new_status,
            timestamp: data.timestamp || Date.now(),
            reason: data.reason || data.data?.reason || ''
          });
          return next;
        });
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const subscribeMarket = useCallback((marketId: string) => {
    socketRef.current?.emit('subscribe_market', { market_id: marketId });
  }, []);

  const unsubscribeMarket = useCallback((marketId: string) => {
    socketRef.current?.emit('unsubscribe_market', { market_id: marketId });
  }, []);

  const subscribeOrderBook = useCallback((marketId: string, outcomeId: string) => {
    socketRef.current?.emit('subscribe_orderbook', { market_id: marketId, outcome_id: outcomeId });
  }, []);

  return (
    <WebSocketContext.Provider value={{
      connected,
      authenticated,
      trades,
      orderBooks,
      marketStatuses,
      subscribeMarket,
      unsubscribeMarket,
      subscribeOrderBook
    }}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocketContext = () => {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useWebSocketContext must be used within a WebSocketProvider');
  return ctx;
};
