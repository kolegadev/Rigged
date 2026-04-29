import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Settings, 
  BarChart3, 
  Users, 
  Gavel, 
  TrendingUp, 
  AlertTriangle,
  Plus,
  RefreshCw,
  CheckCircle,
  Clock
} from 'lucide-react';
import MarketManagement from './MarketManagement';

interface AdminStats {
  total_users: number;
  active_markets: number;
  pending_resolutions: number;
  total_volume: number;
  daily_trades: number;
  risk_flags: number;
}

interface Auction {
  _id: string;
  bat_id: string;
  title: string;
  make: string;
  model: string;
  year: number;
  current_bid: number;
  status: string;
  created_at: string;
}

interface Market {
  _id: string;
  title: string;
  type: 'threshold' | 'bucket';
  status: string;
  trading_ends_at: string;
  threshold_value?: number;
  auction?: Auction;
}

const AdminSidebar: React.FC = () => {
  const location = useLocation();
  
  const navigation = [
    { name: 'Dashboard', href: '/admin', icon: BarChart3 },
    { name: 'Auctions', href: '/admin/auctions', icon: Gavel },
    { name: 'Markets', href: '/admin/markets', icon: TrendingUp },
    { name: 'Users', href: '/admin/users', icon: Users },
    { name: 'Risk Flags', href: '/admin/risk', icon: AlertTriangle },
    { name: 'Settings', href: '/admin/settings', icon: Settings },
  ];

  return (
    <div className="w-64 bg-gray-900 text-white h-screen fixed left-0 top-0 overflow-y-auto">
      <div className="p-6">
        <div className="flex items-center space-x-3 mb-8">
          <div className="bg-blue-600 rounded-lg p-2">
            <TrendingUp className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Admin Panel</h1>
            <p className="text-sm text-gray-400">Prediction Marketplace</p>
          </div>
        </div>

        <nav className="space-y-2">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.name}
                to={item.href}
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg transition-colors ${
                  isActive 
                    ? 'bg-blue-600 text-white' 
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <item.icon className="h-5 w-5" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
};

const AdminDashboard: React.FC = () => {
  const [stats] = useState<AdminStats>({
    total_users: 1247,
    active_markets: 8,
    pending_resolutions: 3,
    total_volume: 2400000,
    daily_trades: 156,
    risk_flags: 2
  });

  const recentActivity = [
    { type: 'market_created', message: 'New market created: 2020 Tesla Model S price prediction', time: '2 minutes ago' },
    { type: 'user_flagged', message: 'User suspicious_trader_123 flagged for unusual volume', time: '15 minutes ago' },
    { type: 'auction_imported', message: 'Imported 1965 Porsche 911 auction from BaT', time: '1 hour ago' },
    { type: 'market_resolved', message: 'Ferrari market resolved: Final price $425,000', time: '2 hours ago' }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <Button onClick={() => window.location.reload()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="bg-blue-100 rounded-lg p-3">
                <Users className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total_users.toLocaleString()}</p>
                <p className="text-sm text-gray-600">Total Users</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="bg-green-100 rounded-lg p-3">
                <TrendingUp className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.active_markets}</p>
                <p className="text-sm text-gray-600">Active Markets</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="bg-yellow-100 rounded-lg p-3">
                <Clock className="h-6 w-6 text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.pending_resolutions}</p>
                <p className="text-sm text-gray-600">Pending Resolutions</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="bg-purple-100 rounded-lg p-3">
                <BarChart3 className="h-6 w-6 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">${(stats.total_volume / 1000000).toFixed(1)}M</p>
                <p className="text-sm text-gray-600">Total Volume</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="bg-indigo-100 rounded-lg p-3">
                <TrendingUp className="h-6 w-6 text-indigo-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.daily_trades}</p>
                <p className="text-sm text-gray-600">Today's Trades</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-3">
              <div className="bg-red-100 rounded-lg p-3">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.risk_flags}</p>
                <p className="text-sm text-gray-600">Risk Flags</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest system events and administrative actions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recentActivity.map((activity, index) => (
              <div key={index} className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
                <div className="flex-shrink-0">
                  {activity.type === 'market_created' && <Plus className="h-5 w-5 text-green-600" />}
                  {activity.type === 'user_flagged' && <AlertTriangle className="h-5 w-5 text-red-600" />}
                  {activity.type === 'auction_imported' && <Gavel className="h-5 w-5 text-blue-600" />}
                  {activity.type === 'market_resolved' && <CheckCircle className="h-5 w-5 text-green-600" />}
                </div>
                <div className="flex-grow">
                  <p className="text-sm font-medium text-gray-900">{activity.message}</p>
                  <p className="text-xs text-gray-500">{activity.time}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

const AdminAuctions: React.FC = () => {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [loading, setLoading] = useState(true);
  const [importUrl, setImportUrl] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string; type: 'success' | 'error' } | null>(null);
  const [urlValidation, setUrlValidation] = useState<{ isValid: boolean; errors: string[] } | null>(null);

  useEffect(() => {
    fetchAuctions();
  }, []);

  const fetchAuctions = async () => {
    try {
      const response = await fetch('/api/auctions');
      if (response.ok) {
        const data = await response.json();
        setAuctions(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching auctions:', error);
    } finally {
      setLoading(false);
    }
  };

  const validateUrl = async (url: string) => {
    if (!url.trim()) {
      setUrlValidation(null);
      return;
    }

    try {
      const response = await fetch('/api/auctions/admin/validate-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();
      if (data.success) {
        setUrlValidation({
          isValid: data.data.isValid,
          errors: data.data.errors || [],
        });
      }
    } catch (error) {
      console.error('Error validating URL:', error);
      setUrlValidation({
        isValid: false,
        errors: ['Failed to validate URL'],
      });
    }
  };

  const importAuction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importUrl.trim() || urlValidation?.isValid === false) return;

    setImportLoading(true);
    setImportResult(null);

    try {
      const response = await fetch('/api/auctions/admin/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          url: importUrl,
          skipValidation: false
        }),
      });

      const data = await response.json();

      if (data.success) {
        setImportResult({
          success: true,
          message: `Successfully imported: ${data.auction?.title || 'auction'}`,
          type: 'success',
        });
        setImportUrl('');
        setUrlValidation(null);
        // Refresh auctions list
        fetchAuctions();
      } else {
        setImportResult({
          success: false,
          message: data.error || 'Import failed',
          type: 'error',
        });
      }
    } catch (error) {
      setImportResult({
        success: false,
        message: 'Network error during import',
        type: 'error',
      });
    } finally {
      setImportLoading(false);
    }
  };

  const pollAuction = async (auctionId: string) => {
    try {
      const response = await fetch(`/api/auctions/${auctionId}/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      if (data.success) {
        // Refresh auctions to show updated data
        fetchAuctions();
      }
    } catch (error) {
      console.error('Error polling auction:', error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Auction Management</h1>
        <Button onClick={fetchAuctions} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Import Form */}
      <Card>
        <CardHeader>
          <CardTitle>Import BaT Auction</CardTitle>
          <CardDescription>
            Import an auction from Bring a Trailer by pasting the listing URL
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={importAuction} className="space-y-4">
            <div>
              <Label htmlFor="import-url">BaT Auction URL</Label>
              <Input
                id="import-url"
                type="url"
                placeholder="https://bringatrailer.com/listing/..."
                value={importUrl}
                onChange={(e) => {
                  setImportUrl(e.target.value);
                  validateUrl(e.target.value);
                }}
                className={urlValidation?.isValid === false ? 'border-red-500' : ''}
              />
              {urlValidation?.errors.length > 0 && (
                <div className="mt-2 space-y-1">
                  {urlValidation.errors.map((error, index) => (
                    <p key={index} className="text-sm text-red-600">{error}</p>
                  ))}
                </div>
              )}
              {urlValidation?.isValid && (
                <p className="mt-2 text-sm text-green-600">✓ Valid BaT URL format</p>
              )}
            </div>

            <div className="flex space-x-3">
              <Button 
                type="submit" 
                disabled={importLoading || !importUrl.trim() || urlValidation?.isValid === false}
                className="flex items-center"
              >
                {importLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Import Auction
                  </>
                )}
              </Button>
            </div>

            {importResult && (
              <div className={`p-3 rounded-lg ${
                importResult.type === 'success' 
                  ? 'bg-green-50 text-green-800' 
                  : 'bg-red-50 text-red-800'
              }`}>
                <p className="text-sm font-medium">{importResult.message}</p>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Auctions List */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Auctions</CardTitle>
          <CardDescription>Recently imported BaT auctions</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-4">
              <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2" />
              Loading auctions...
            </div>
          ) : auctions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Gavel className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>No auctions imported yet</p>
              <p className="text-sm">Use the import form above to add your first auction</p>
            </div>
          ) : (
            <div className="space-y-3">
              {auctions.map((auction) => (
                <div key={auction._id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex-grow">
                    <div className="flex items-center space-x-3">
                      <div>
                        <p className="font-medium text-gray-900">{auction.title}</p>
                        <div className="flex items-center space-x-4 text-sm text-gray-600">
                          <span>{auction.year} {auction.make} {auction.model}</span>
                          <span>•</span>
                          <span>Current: ${auction.current_bid?.toLocaleString() || '0'}</span>
                          <span>•</span>
                          <span>BaT ID: {auction.bat_id}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Badge className={
                      auction.status === 'active' ? 'bg-green-100 text-green-800' : 
                      auction.status === 'closed' ? 'bg-gray-100 text-gray-800' :
                      'bg-yellow-100 text-yellow-800'
                    }>
                      {auction.status}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => pollAuction(auction._id)}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Poll
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export const AdminApp: React.FC = () => {
  return (
    <div className="flex h-screen bg-gray-100">
      <AdminSidebar />
      
      <div className="flex-1 ml-64 overflow-y-auto">
        <div className="p-8">
          <Routes>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/auctions" element={<AdminAuctions />} />
            <Route path="/admin/markets" element={<MarketManagement />} />
            <Route path="/admin/users" element={<div className="text-center py-8">Users Management (Coming Soon)</div>} />
            <Route path="/admin/risk" element={<div className="text-center py-8">Risk Management (Coming Soon)</div>} />
            <Route path="/admin/settings" element={<div className="text-center py-8">Settings (Coming Soon)</div>} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
};