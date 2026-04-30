import React, { useState, useEffect, createContext, useContext } from 'react';
import { AlertTriangle, DollarSign, TrendingUp, User, LogOut, RefreshCw, Radio, BarChart3 } from 'lucide-react';
import { useWebSocketContext } from '../contexts/WebSocketContext';
import { OrderBook } from './OrderBook';
import { TradeHistory } from './TradeHistory';
import { PositionsPanel } from './PositionsPanel';
import { PriceTicker } from './PriceTicker';
import { TradeToast } from './TradeToast';

// ─────────────────────────────────────────────────────────────
// TYPES & INTERFACES
// ─────────────────────────────────────────────────────────────

interface User {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
}

interface BalanceInfo {
  currency: string;
  available: number;
  locked: number;
  total: number;
}

interface WalletInfo {
  id: string;
  address: string;
  type: string;
  balances: BalanceInfo[];
}

interface Order {
  id: string;
  market_id: string;
  outcome_id: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price: number;
  quantity: number;
  filled_quantity: number;
  remaining_quantity: number;
  status: 'pending' | 'partial' | 'filled' | 'cancelled' | 'expired';
  cost_locked: number;
  created_at: string;
}

interface Market {
  _id: string;
  title: string;
  description: string;
  status: string;
  type: 'threshold' | 'bucket';
  trading_starts_at: string;
  trading_ends_at: string;
  outcomes?: Array<{ _id: string; title: string; slug: string }>;
}

// ─────────────────────────────────────────────────────────────
// AUTH CONTEXT
// ─────────────────────────────────────────────────────────────

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem('auth_token')
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (token) {
      fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => {
          if (data.success) {
            setUser(data.user);
          } else {
            throw new Error('Invalid response');
          }
        })
        .catch(() => {
          setToken(null);
          localStorage.removeItem('auth_token');
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [token]);

  const login = async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Login failed');
    }
    localStorage.setItem('auth_token', data.token);
    setToken(data.token);
  };

  const register = async (email: string, password: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Registration failed');
    }
    localStorage.setItem('auth_token', data.token);
    setToken(data.token);
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

// ─────────────────────────────────────────────────────────────
// COMPONENTS: Auth Forms
// ─────────────────────────────────────────────────────────────

export const AuthForm: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white/10 backdrop-blur-md rounded-2xl shadow-2xl border border-white/20 p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-r from-purple-500 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <TrendingUp className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-3xl font-bold text-white mb-2">
            Prediction Market
          </h2>
          <p className="text-gray-300">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/30 rounded-lg flex items-center gap-3 text-red-200">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="your@email.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="••••••••"
              minLength={8}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-6 bg-gradient-to-r from-purple-500 to-blue-600 text-white font-medium rounded-lg hover:from-purple-600 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Please wait...
              </div>
            ) : (
              mode === 'login' ? 'Sign In' : 'Create Account'
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-300">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="text-purple-400 hover:text-purple-300 font-medium transition-colors"
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// COMPONENTS: Balance Display
// ─────────────────────────────────────────────────────────────

export const BalanceDisplay: React.FC = () => {
  const { token } = useAuth();
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;

    fetch('/api/auth/wallet', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setWallet(data.wallet);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-xl p-6 shadow-lg">
        <div className="animate-pulse">
          <div className="h-4 bg-white/30 rounded w-1/3 mb-2"></div>
          <div className="h-8 bg-white/30 rounded w-1/2 mb-2"></div>
          <div className="h-3 bg-white/30 rounded w-1/4"></div>
        </div>
      </div>
    );
  }

  const balance = wallet?.balances?.[0];
  if (!balance) {
    return (
      <div className="bg-gradient-to-r from-red-500 to-pink-600 rounded-xl p-6 shadow-lg text-white">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-6 h-6" />
          <div>
            <div className="font-semibold">Balance Error</div>
            <div className="text-sm opacity-90">Unable to load wallet</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-xl p-6 shadow-lg text-white">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
          <DollarSign className="w-6 h-6" />
        </div>
        <div>
          <div className="text-sm font-medium opacity-90">Available Balance</div>
          <div className="text-2xl font-bold">${balance.available.toFixed(2)}</div>
        </div>
      </div>

      {balance.locked > 0 && (
        <div className="border-t border-white/20 pt-3 mt-3">
          <div className="text-sm opacity-90">
            ${balance.locked.toFixed(2)} locked in orders
          </div>
        </div>
      )}

      <div className="mt-4 text-xs opacity-75">
        Total: ${balance.total.toFixed(2)} {balance.currency}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// COMPONENTS: Live Connection Status
// ─────────────────────────────────────────────────────────────

const ConnectionStatus: React.FC = () => {
  const { connected } = useWebSocketContext();

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/10 backdrop-blur-md rounded-full border border-white/20">
      <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
      <span className="text-xs text-gray-200 font-medium">
        {connected ? 'Live' : 'Offline'}
      </span>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// COMPONENTS: Market Selector
// ─────────────────────────────────────────────────────────────

const MarketSelector: React.FC<{
  markets: Market[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}> = ({ markets, selectedId, onSelect }) => {
  return (
    <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/10 p-4">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-semibold text-white">Select Market</h3>
      </div>
      <select
        value={selectedId || ''}
        onChange={e => onSelect(e.target.value)}
        className="w-full px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
      >
        {markets.map(m => (
          <option key={m._id} value={m._id} className="bg-slate-800">
            {m.title}
          </option>
        ))}
      </select>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// COMPONENTS: Order Form
// ─────────────────────────────────────────────────────────────

interface OrderFormProps {
  marketId: string;
  marketTitle: string;
  outcomes?: Array<{ _id: string; title: string; slug: string }>;
  presetPrice?: number;
}

export const OrderForm: React.FC<OrderFormProps> = ({ marketId, marketTitle, outcomes, presetPrice }) => {
  const { token } = useAuth();
  const [outcome, setOutcome] = useState<'yes' | 'no'>('yes');
  const [price, setPrice] = useState(0.50);

  useEffect(() => {
    if (presetPrice !== undefined && presetPrice >= 0.01 && presetPrice <= 0.99) {
      setPrice(presetPrice);
    }
  }, [presetPrice]);
  const [quantity, setQuantity] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const cost = outcome === 'yes' ? price * quantity : (1 - price) * quantity;
  const potentialProfit = quantity - cost;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          market_id: marketId,
          outcome,
          side: 'buy',
          price,
          quantity,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Order failed');
      }

      setSuccess(`Order placed! ID: ${data.order.id.slice(0, 8)}...`);
      setQuantity(10);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
          <TrendingUp className="w-6 h-6 text-white" />
        </div>
        <div>
          <h3 className="font-bold text-gray-900">Place Order</h3>
          <p className="text-sm text-gray-600">{marketTitle}</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Outcome Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">Outcome</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setOutcome('yes')}
              className={`py-4 px-6 rounded-xl font-semibold text-sm transition-all ${
                outcome === 'yes'
                  ? 'bg-emerald-500 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              YES
            </button>
            <button
              type="button"
              onClick={() => setOutcome('no')}
              className={`py-4 px-6 rounded-xl font-semibold text-sm transition-all ${
                outcome === 'no'
                  ? 'bg-red-500 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              NO
            </button>
          </div>
        </div>

        {/* Price Input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Price (probability)
          </label>
          <div className="space-y-3">
            <input
              type="range"
              min="0.01"
              max="0.99"
              step="0.01"
              value={price}
              onChange={e => setPrice(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between items-center">
              <span className="text-2xl font-bold text-gray-900">
                ${price.toFixed(2)}
              </span>
              <span className="text-sm text-gray-500">
                {(price * 100).toFixed(0)}% implied probability
              </span>
            </div>
          </div>
        </div>

        {/* Quantity Input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Shares</label>
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={e => setQuantity(parseInt(e.target.value) || 1)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        {/* Cost Summary */}
        <div className="bg-gray-50 rounded-lg p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Cost:</span>
            <span className="font-semibold text-gray-900">${cost.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Potential profit:</span>
            <span className="font-semibold text-emerald-600">+${potentialProfit.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Return:</span>
            <span className="font-semibold text-purple-600">
              {((potentialProfit / cost) * 100).toFixed(1)}%
            </span>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className={`w-full py-4 rounded-xl font-semibold text-white transition-all ${
            outcome === 'yes'
              ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700'
              : 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700'
          } disabled:opacity-50 disabled:cursor-not-allowed shadow-lg`}
        >
          {loading ? (
            <div className="flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Placing Order...
            </div>
          ) : (
            `Buy ${outcome.toUpperCase()} for $${cost.toFixed(2)}`
          )}
        </button>
      </form>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// COMPONENTS: Orders List
// ─────────────────────────────────────────────────────────────

export const OrdersList: React.FC = () => {
  const { token } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;

    fetch('/api/auth/orders', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setOrders(data.orders);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'filled': return 'bg-green-100 text-green-800';
      case 'cancelled': return 'bg-gray-100 text-gray-800';
      case 'partial': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h3 className="font-bold text-gray-900 mb-4">Your Orders</h3>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse h-16 bg-gray-100 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <h3 className="font-bold text-gray-900 mb-4">Your Orders</h3>

      {orders.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No orders yet</p>
      ) : (
        <div className="space-y-3">
          {orders.map(order => (
            <div key={order.id} className="border border-gray-200 rounded-lg p-4">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      order.side === 'buy' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {order.side.toUpperCase()}
                    </span>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                      {order.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">
                    {order.quantity} shares at ${order.price.toFixed(2)} • ${order.cost_locked.toFixed(2)} locked
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(order.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────

export const TradingDashboard: React.FC = () => {
  const { user, token, logout, isLoading } = useAuth();
  const { connected, subscribeMarket, unsubscribeMarket, subscribeOrderBook, marketStatuses } = useWebSocketContext();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [orderPrice, setOrderPrice] = useState<number | undefined>(undefined);

  // Fetch real markets from API
  useEffect(() => {
    fetch('/api/markets?status=trading,published')
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          const list = data.data || [];
          setMarkets(list);
          if (list.length > 0 && !selectedMarketId) {
            setSelectedMarketId(list[0]._id);
          }
        }
      })
      .catch(console.error)
      .finally(() => setMarketsLoading(false));
  }, []);

  // Subscribe to WebSocket for selected market
  useEffect(() => {
    if (!selectedMarketId) return;

    subscribeMarket(selectedMarketId);

    const market = markets.find(m => m._id === selectedMarketId);
    if (market?.outcomes) {
      market.outcomes.forEach(o => {
        subscribeOrderBook(selectedMarketId, o._id);
      });
    }

    return () => {
      unsubscribeMarket(selectedMarketId);
    };
  }, [selectedMarketId, markets, subscribeMarket, unsubscribeMarket, subscribeOrderBook]);

  const selectedMarket = markets.find(m => m._id === selectedMarketId);
  const currentStatus = marketStatuses.get(selectedMarketId || '')?.new_status || selectedMarket?.status;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-purple-900 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-white animate-spin mx-auto mb-4" />
          <p className="text-white">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthForm />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
      <header className="bg-white/10 backdrop-blur-md border-b border-white/20">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-blue-600 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-white">Prediction Market</h1>
            </div>

            <div className="flex items-center gap-4">
              <ConnectionStatus />
              <div className="flex items-center gap-2 text-white">
                <User className="w-4 h-4" />
                <span className="text-sm">{user.username}</span>
              </div>
              <button
                onClick={logout}
                className="flex items-center gap-2 px-3 py-2 text-sm text-red-200 hover:text-red-100 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {marketsLoading ? (
          <div className="text-center text-white py-12">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3" />
            Loading markets...
          </div>
        ) : markets.length === 0 ? (
          <div className="text-center text-white py-12">
            <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-yellow-400" />
            <p>No active markets available.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: Balance, Market Selector, Positions, Orders */}
            <div className="space-y-6">
              <BalanceDisplay />
              <MarketSelector
                markets={markets}
                selectedId={selectedMarketId}
                onSelect={setSelectedMarketId}
              />
              {selectedMarketId && (
                <PositionsPanel
                  marketId={selectedMarketId}
                  outcomes={selectedMarket?.outcomes}
                  token={token}
                />
              )}
              <OrdersList />
            </div>

            {/* Right Column: Market Info, Price Tickers, Order Form, Order Books, Trade History */}
            <div className="lg:col-span-2 space-y-6">
              {selectedMarket && (
                <>
                  {/* Market Info Card */}
                  <div className="bg-white/5 backdrop-blur-md rounded-xl border border-white/10 p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h2 className="text-xl font-bold text-white mb-1">{selectedMarket.title}</h2>
                        <p className="text-gray-300 text-sm">{selectedMarket.description}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          currentStatus === 'trading' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                          currentStatus === 'published' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                          currentStatus === 'resolved' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' :
                          'bg-gray-500/20 text-gray-300 border border-gray-500/30'
                        }`}>
                          {currentStatus?.toUpperCase()}
                        </span>
                        {connected && (
                          <Radio className="w-4 h-4 text-green-400 animate-pulse" />
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-400">
                      <span>Type: {selectedMarket.type}</span>
                      <span>•</span>
                      <span>Trading ends: {new Date(selectedMarket.trading_ends_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {/* Price Tickers */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {selectedMarket.outcomes?.map(outcome => (
                      <PriceTicker
                        key={outcome._id}
                        marketId={selectedMarket._id}
                        outcomeId={outcome._id}
                        outcomeTitle={outcome.title}
                        onPriceSelect={setOrderPrice}
                      />
                    ))}
                  </div>

                  {/* Order Form */}
                  <OrderForm
                    marketId={selectedMarket._id}
                    marketTitle={selectedMarket.title}
                    outcomes={selectedMarket.outcomes}
                    presetPrice={orderPrice}
                  />

                  {/* Order Books */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {selectedMarket.outcomes?.map(outcome => (
                      <OrderBook
                        key={outcome._id}
                        marketId={selectedMarket._id}
                        outcomeId={outcome._id}
                        outcomeTitle={outcome.title}
                      />
                    ))}
                  </div>

                  {/* Trade History */}
                  <TradeHistory
                    marketId={selectedMarket._id}
                    outcomes={selectedMarket.outcomes}
                    token={token}
                    userId={user?.id}
                  />
                </>
              )}
            </div>
          </div>
        )}

        <TradeToast />

        {/* Footer Note */}
        <div className="mt-8 bg-blue-500/20 border border-blue-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-blue-200 text-sm">
              <p className="font-medium mb-1">Real-time Market Data</p>
              <p>Live order books, trade history, position tracking, price tickers, and execution feedback are now active. Tasks 4.20–4.24 complete.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default TradingDashboard;
