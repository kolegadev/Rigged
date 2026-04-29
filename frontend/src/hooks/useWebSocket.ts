import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:9002';

interface WebSocketState {
  connected: boolean;
  authenticated: boolean;
  error: string | null;
}

export function useWebSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    authenticated: false,
    error: null
  });

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
      setState(prev => ({ ...prev, connected: true, error: null }));
      if (token) {
        socket.emit('authenticate', { user_id: 'me', auth_token: token });
      }
    });

    socket.on('disconnect', (reason) => {
      setState(prev => ({ ...prev, connected: false, authenticated: false }));
    });

    socket.on('connect_error', (err) => {
      setState(prev => ({ ...prev, error: err.message }));
    });

    socket.on('authenticated', (data: { success: boolean }) => {
      setState(prev => ({ ...prev, authenticated: data.success }));
    });

    // Heartbeat
    const pingInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit('ping');
      }
    }, 30000);

    return () => {
      clearInterval(pingInterval);
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

  const on = useCallback(<T = any>(event: string, callback: (data: T) => void) => {
    socketRef.current?.on(event, callback);
    return () => {
      socketRef.current?.off(event, callback);
    };
  }, []);

  return {
    socket: socketRef.current,
    ...state,
    subscribeMarket,
    unsubscribeMarket,
    subscribeOrderBook,
    on
  };
}
