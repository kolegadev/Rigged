import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search, TrendingUp, Clock, Car, DollarSign, Users, ArrowRight } from 'lucide-react';

interface Auction {
  _id: string;
  title: string;
  make: string;
  model: string;
  year: number;
  current_bid: number;
  bid_count: number;
  end_date: string;
  status: string;
}

interface Market {
  _id: string;
  title: string;
  description: string;
  type: 'threshold' | 'bucket';
  threshold_value?: number;
  status: string;
  trading_ends_at: string;
  auction: Auction;
  outcomes: Array<{
    _id: string;
    title: string;
    sort_order: number;
  }>;
}

export default function HomePage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [marketsResponse, auctionsResponse] = await Promise.all([
        fetch('/api/markets?status=trading,published'),
        fetch('/api/auctions')
      ]);

      if (marketsResponse.ok) {
        const marketsData = await marketsResponse.json();
        setMarkets(marketsData.data || []);
      }

      if (auctionsResponse.ok) {
        const auctionsData = await auctionsResponse.json();
        setAuctions(auctionsData.data || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatTimeRemaining = (endDate: string) => {
    const end = new Date(endDate);
    const now = new Date();
    const diff = end.getTime() - now.getTime();

    if (diff <= 0) return 'Ended';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'trading':
      case 'active':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'published':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'ended':
      case 'closed':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-cyan-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading prediction markets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-cyan-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {/* Header */}
      <header className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="bg-indigo-600 rounded-lg p-2">
                <TrendingUp className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                  Auction Predictions
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Trade on car auction outcomes
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  type="text"
                  placeholder="Search markets..."
                  className="pl-10 w-64"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Button className="bg-indigo-600 hover:bg-indigo-700">
                Connect Wallet
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border-0 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center space-x-3">
                <div className="bg-blue-100 dark:bg-blue-900 rounded-lg p-3">
                  <TrendingUp className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{markets.length}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Active Markets</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border-0 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center space-x-3">
                <div className="bg-green-100 dark:bg-green-900 rounded-lg p-3">
                  <Car className="h-6 w-6 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{auctions.length}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Live Auctions</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border-0 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center space-x-3">
                <div className="bg-purple-100 dark:bg-purple-900 rounded-lg p-3">
                  <DollarSign className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">$2.4M</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Total Volume</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border-0 shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center space-x-3">
                <div className="bg-orange-100 dark:bg-orange-900 rounded-lg p-3">
                  <Users className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">1,247</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Active Traders</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Active Markets */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Active Prediction Markets
              </h2>
              <div className="flex items-center space-x-3">
                <Badge className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
                  {markets.length} Markets
                </Badge>
                <Link to="/markets">
                  <Button variant="outline" size="sm" className="flex items-center">
                    Browse All Markets
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </Link>
              </div>
            </div>

            <div className="space-y-4">
              {markets.length === 0 ? (
                <Card className="bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border-0 shadow-lg">
                  <CardContent className="p-8 text-center">
                    <TrendingUp className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500 dark:text-gray-400">
                      No active markets yet. New prediction markets will appear here when available.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                markets.map((market) => (
                  <Card key={market._id} className="bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border-0 shadow-lg hover:shadow-xl transition-shadow cursor-pointer">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-lg mb-2 text-gray-900 dark:text-white">
                            {market.title}
                          </CardTitle>
                          <CardDescription className="text-gray-600 dark:text-gray-300">
                            {market.description}
                          </CardDescription>
                        </div>
                        <Badge className={getStatusColor(market.status)}>
                          {market.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-2">
                          <Car className="h-4 w-4 text-gray-400" />
                          <span className="text-sm text-gray-600 dark:text-gray-300">
                            {market.auction?.make} {market.auction?.model} {market.auction?.year}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Clock className="h-4 w-4 text-gray-400" />
                          <span className="text-sm text-gray-600 dark:text-gray-300">
                            {formatTimeRemaining(market.trading_ends_at)}
                          </span>
                        </div>
                      </div>

                      {market.type === 'threshold' && (
                        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 mb-4">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">
                            Threshold: {formatCurrency(market.threshold_value || 0)}
                          </p>
                        </div>
                      )}

                      <div className="flex items-center space-x-2">
                        {market.outcomes?.map((outcome) => (
                          <Badge key={outcome._id} variant="outline" className="text-xs">
                            {outcome.title}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>

          {/* Live Auctions Sidebar */}
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Live Auctions
              </h2>
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                {auctions.length} Live
              </Badge>
            </div>

            <div className="space-y-4">
              {auctions.length === 0 ? (
                <Card className="bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border-0 shadow-lg">
                  <CardContent className="p-6 text-center">
                    <Car className="h-8 w-8 text-gray-400 mx-auto mb-3" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No live auctions at the moment.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                auctions.map((auction) => (
                  <Card key={auction._id} className="bg-white/60 dark:bg-gray-800/60 backdrop-blur-sm border-0 shadow-lg">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-medium text-gray-900 dark:text-white text-sm">
                            {auction.year} {auction.make} {auction.model}
                          </h3>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {auction.bid_count} bids
                          </p>
                        </div>
                        <Badge className={`${getStatusColor(auction.status)} text-xs`}>
                          {auction.status}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-lg font-bold text-gray-900 dark:text-white">
                            {formatCurrency(auction.current_bid || 0)}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            Current bid
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium text-gray-900 dark:text-white">
                            {formatTimeRemaining(auction.end_date)}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            remaining
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}