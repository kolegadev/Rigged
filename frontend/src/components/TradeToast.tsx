import React, { useEffect, useState } from 'react';
import { CheckCircle, X, Zap } from 'lucide-react';
import { useWebSocketContext, OrderFillEvent } from '../contexts/WebSocketContext';

interface Toast {
  id: number;
  fill: OrderFillEvent;
}

export const TradeToast: React.FC = () => {
  const { orderFills } = useWebSocketContext();
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    if (orderFills.length === 0) return;
    const latest = orderFills[0];
    const id = Date.now();
    setToasts(prev => [{ id, fill: latest }, ...prev].slice(0, 5));

    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);

    return () => clearTimeout(timer);
  }, [orderFills]);

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="pointer-events-auto bg-slate-800/95 backdrop-blur-md border border-emerald-500/30 rounded-xl shadow-2xl p-4 flex items-start gap-3 min-w-[280px] animate-in slide-in-from-right duration-300"
        >
          <div className="w-8 h-8 bg-emerald-500/20 rounded-full flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-sm font-semibold text-white">Order Filled</span>
            </div>
            <p className="text-xs text-gray-300">
              <span className="font-mono font-medium text-emerald-300">{toast.fill.fill_quantity}</span> shares at{' '}
              <span className="font-mono font-medium text-white">${toast.fill.fill_price.toFixed(2)}</span>
            </p>
            {toast.fill.remaining_quantity > 0 && (
              <p className="text-[10px] text-gray-500 mt-0.5">
                {toast.fill.remaining_quantity} remaining
              </p>
            )}
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
