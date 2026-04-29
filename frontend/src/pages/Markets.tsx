import React, { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { 
  Search, 
  TrendingUp, 
  Clock, 
  Target, 
  BarChart3,
  ExternalLink,
  Calendar,
  Gavel,
  Users,
  DollarSign,
  Filter
} from 'lucide-react';

interface Market {
  _id: string;
  title: string;
  description: string;
  type: 'threshold' | 'bucket';
  threshold_value?: number;
  status: 'published' | 'trading' | 'resolved';
  trading_starts_at: string;
  trading_ends_at: string;
  created_at: string;
  event?: {
    _id: string;
    title: string;
    description: string;
  };
  auction?: {
    _id: string;
    title: string;
    make: string;
    model: string;
    year: number;
    current_bid: number;
    status: string;
  };
  outcomes?: Array<{
    _id: string;
    title: string;
    sort_order: number;
  }>;
}

const MarketCard: React.FC<{ market: Market }> = ({ market }) => {
  const timeUntilTrading = new Date(market.trading_ends_at).getTime() - Date.now();
  const isActive = timeUntilTrading > 0 && market.status === 'trading';
  const isUpcoming = new Date(market.trading_starts_at).getTime() > Date.now();

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'published': return 'bg-blue-100 text-blue-700';
      case 'trading': return 'bg-green-100 text-green-700';
      case 'resolved': return 'bg-purple-100 text-purple-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const formatTimeRemaining = (ms: number) => {
    if (ms <= 0) return 'Ended';
    
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h`;
    return '< 1h';
  };

  return (
    <Card className="group hover:shadow-lg transition-all duration-200 border-l-4 border-l-blue-500">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center space-x-2">
            {market.type === 'threshold' ? (
              <Target className="h-5 w-5 text-indigo-600" />
            ) : (
              <BarChart3 className="h-5 w-5 text-orange-600" />
            )}
            <Badge className={getStatusColor(market.status)}>
              {market.status === 'published' ? 'Coming Soon' : 
               market.status === 'trading' ? 'Live' : 'Resolved'}
            </Badge>
            <Badge variant="outline" className={
              market.type === 'threshold' ? 'border-indigo-200 text-indigo-700' : 'border-orange-200 text-orange-700'
            }>
              {market.type === 'threshold' ? 'Yes/No' : 'Multiple Choice'}
            </Badge>
          </div>
          
          {isActive && (
            <div className="text-right">
              <div className="text-sm font-medium text-green-600">
                {formatTimeRemaining(timeUntilTrading)}
              </div>
              <div className="text-xs text-gray-500">remaining</div>
            </div>
          )}
        </div>

        <CardTitle className="text-lg group-hover:text-blue-600 transition-colors">
          {market.title}
        </CardTitle>
        
        <CardDescription className="line-clamp-2">
          {market.description}
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Event and Auction Info */}
        <div className="space-y-2 mb-4">
          {market.event && (
            <div className="flex items-center text-sm text-gray-600">
              <Calendar className="h-4 w-4 mr-2 text-gray-400" />
              <span className="font-medium">Event:</span>
              <span className="ml-1 truncate">{market.event.title}</span>
            </div>
          )}
          
          {market.auction && (
            <div className="flex items-center text-sm text-gray-600">
              <Gavel className="h-4 w-4 mr-2 text-gray-400" />
              <span className="font-medium">Auction:</span>
              <span className="ml-1 truncate">
                {market.auction.year} {market.auction.make} {market.auction.model}
              </span>
              {market.auction.current_bid > 0 && (
                <span className="ml-auto font-mono text-green-600">
                  ${market.auction.current_bid.toLocaleString()}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Outcomes Preview */}
        {market.outcomes && market.outcomes.length > 0 && (
          <div className="mb-4">
            <div className="text-xs text-gray-500 mb-2 uppercase tracking-wide font-medium">
              Outcomes ({market.outcomes.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {market.outcomes.slice(0, 3).map((outcome) => (
                <span 
                  key={outcome._id} 
                  className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full"
                >
                  {outcome.title}
                </span>
              ))}
              {market.outcomes.length > 3 && (
                <span className="px-2 py-1 text-gray-400 text-xs">
                  +{market.outcomes.length - 3} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Trading Info */}
        <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
          <div className="flex items-center">
            <Clock className="h-3 w-3 mr-1" />
            Trading: {new Date(market.trading_starts_at).toLocaleDateString()} - {' '}
            {new Date(market.trading_ends_at).toLocaleDateString()}
          </div>
        </div>

        {/* Action Button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4 text-xs text-gray-400">
            <div className="flex items-center">
              <Users className="h-3 w-3 mr-1" />
              <span>--</span>
            </div>
            <div className="flex items-center">
              <DollarSign className="h-3 w-3 mr-1" />
              <span>--</span>
            </div>
          </div>
          
          <Link to={`/markets/${market._id}`}>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
              {isUpcoming ? 'View Details' :
               isActive ? 'Trade Now' : 
               market.status === 'resolved' ? 'View Results' : 'View Market'}
              <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
};

const MarketListPage: React.FC = () => {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  useEffect(() => {
    loadMarkets();
  }, []);

  const loadMarkets = async () => {
    setLoading(true);
    try {
      const url = statusFilter === 'all' 
        ? '/api/markets?status=published,trading,resolved'
        : `/api/markets?status=${statusFilter}`;
      
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setMarkets(data.data || []);
      }
    } catch (error) {
      console.error('Error loading markets:', error);
    } finally {
      setLoading(false);
    }
  };

  const searchMarkets = async () => {
    if (!searchQuery.trim()) {
      loadMarkets();
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/markets/search?q=${encodeURIComponent(searchQuery)}`);
      if (response.ok) {
        const data = await response.json();
        setMarkets(data.data || []);
      }
    } catch (error) {
      console.error('Error searching markets:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    searchMarkets();
  };

  const filteredMarkets = markets.filter(market => {
    if (typeFilter !== 'all' && market.type !== typeFilter) return false;
    return true;
  });

  const getMarketCounts = () => {
    const published = markets.filter(m => m.status === 'published').length;
    const trading = markets.filter(m => m.status === 'trading').length;
    const resolved = markets.filter(m => m.status === 'resolved').length;
    return { published, trading, resolved, total: markets.length };
  };

  const counts = getMarketCounts();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <TrendingUp className="h-8 w-8 text-blue-600 mr-3" />
            <h1 className="text-4xl font-bold text-gray-900">Prediction Markets</h1>
          </div>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Trade on the outcomes of car auctions and other events with real-world results
          </p>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-gray-900">{counts.total}</div>
              <div className="text-sm text-gray-600">Total Markets</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{counts.trading}</div>
              <div className="text-sm text-gray-600">Live Trading</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{counts.published}</div>
              <div className="text-sm text-gray-600">Coming Soon</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-purple-600">{counts.resolved}</div>
              <div className="text-sm text-gray-600">Resolved</div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filters */}
        <Card className="mb-8">
          <CardContent className="p-6">
            <form onSubmit={handleSearch} className="mb-4">
              <div className="flex gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    type="text"
                    placeholder="Search markets by title, car make/model, or auction details..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Button type="submit">Search</Button>
              </div>
            </form>

            <div className="flex flex-wrap gap-4">
              <div className="flex items-center space-x-2">
                <Filter className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Filters:</span>
              </div>
              
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">Status:</span>
                <div className="flex gap-1">
                  {['all', 'published', 'trading', 'resolved'].map(status => (
                    <Button
                      key={status}
                      size="sm"
                      variant={statusFilter === status ? 'default' : 'outline'}
                      onClick={() => setStatusFilter(status)}
                      className="text-xs"
                    >
                      {status === 'all' ? 'All' : 
                       status === 'published' ? 'Coming Soon' :
                       status === 'trading' ? 'Live' : 'Resolved'}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-600">Type:</span>
                <div className="flex gap-1">
                  {['all', 'threshold', 'bucket'].map(type => (
                    <Button
                      key={type}
                      size="sm"
                      variant={typeFilter === type ? 'default' : 'outline'}
                      onClick={() => setTypeFilter(type)}
                      className="text-xs"
                    >
                      {type === 'all' ? 'All' :
                       type === 'threshold' ? 'Yes/No' : 'Multiple Choice'}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Markets Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="h-3 bg-gray-200 rounded"></div>
                    <div className="h-3 bg-gray-200 rounded w-2/3"></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredMarkets.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <TrendingUp className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No Markets Found</h3>
              <p className="text-gray-600 mb-4">
                {searchQuery ? 'Try adjusting your search terms or filters' : 'No markets are currently available'}
              </p>
              {searchQuery && (
                <Button onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('all');
                  setTypeFilter('all');
                  loadMarkets();
                }} variant="outline">
                  Clear Search
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredMarkets.map(market => (
              <MarketCard key={market._id} market={market} />
            ))}
          </div>
        )}

        {/* Load More */}
        {filteredMarkets.length >= 20 && (
          <div className="text-center mt-8">
            <Button variant="outline" onClick={loadMarkets}>
              Load More Markets
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

const MarketDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [market, setMarket] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      loadMarket(id);
    }
  }, [id]);

  const loadMarket = async (marketId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/markets/${marketId}`);
      if (response.ok) {
        const data = await response.json();
        setMarket(data.data);
      }
    } catch (error) {
      console.error('Error loading market:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <TrendingUp className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading market details...</p>
        </div>
      </div>
    );
  }

  if (!market) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Market Not Found</h1>
          <p className="text-gray-600 mb-4">The requested market could not be found.</p>
          <Link to="/markets">
            <Button>Back to Markets</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <div className="mb-6">
          <Link to="/markets" className="text-blue-600 hover:text-blue-800 text-sm">
            ← Back to Markets
          </Link>
        </div>

        {/* Market Header */}
        <Card className="mb-8">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-3 mb-3">
                  {market.type === 'threshold' ? (
                    <Target className="h-6 w-6 text-indigo-600" />
                  ) : (
                    <BarChart3 className="h-6 w-6 text-orange-600" />
                  )}
                  <Badge className={
                    market.status === 'published' ? 'bg-blue-100 text-blue-700' :
                    market.status === 'trading' ? 'bg-green-100 text-green-700' :
                    'bg-purple-100 text-purple-700'
                  }>
                    {market.status === 'published' ? 'Coming Soon' :
                     market.status === 'trading' ? 'Live Trading' : 'Resolved'}
                  </Badge>
                  <Badge variant="outline">
                    {market.type === 'threshold' ? 'Yes/No' : 'Multiple Choice'}
                  </Badge>
                </div>

                <CardTitle className="text-3xl text-gray-900 mb-3">
                  {market.title}
                </CardTitle>
                
                <CardDescription className="text-lg">
                  {market.description}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Event Info */}
              {market.event && (
                <div className="bg-blue-50 rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-2 flex items-center">
                    <Calendar className="h-5 w-5 mr-2" />
                    Event
                  </h4>
                  <p className="font-medium">{market.event.title}</p>
                  <p className="text-sm text-gray-600">{market.event.description}</p>
                </div>
              )}

              {/* Auction Info */}
              {market.auction && (
                <div className="bg-green-50 rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-2 flex items-center">
                    <Gavel className="h-5 w-5 mr-2" />
                    Linked Auction
                  </h4>
                  <p className="font-medium">
                    {market.auction.year} {market.auction.make} {market.auction.model}
                  </p>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-sm text-gray-600">Current Bid:</span>
                    <span className="font-mono font-bold text-green-600">
                      ${market.auction.current_bid?.toLocaleString() || '0'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Trading Period */}
            <div className="mt-6 bg-gray-50 rounded-lg p-4">
              <h4 className="font-semibold text-gray-900 mb-2 flex items-center">
                <Clock className="h-5 w-5 mr-2" />
                Trading Period
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Starts:</span>
                  <div className="font-medium">
                    {new Date(market.trading_starts_at).toLocaleString()}
                  </div>
                </div>
                <div>
                  <span className="text-gray-600">Ends:</span>
                  <div className="font-medium">
                    {new Date(market.trading_ends_at).toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Outcomes */}
        {market.outcomes && market.outcomes.length > 0 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Market Outcomes</CardTitle>
              <CardDescription>
                These are the possible outcomes for this prediction market
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {market.outcomes
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((outcome) => (
                    <div 
                      key={outcome._id}
                      className="flex items-center justify-between p-4 border-2 border-gray-200 rounded-lg hover:border-blue-300 transition-colors"
                    >
                      <div>
                        <div className="font-medium text-gray-900">{outcome.title}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-semibold text-gray-900">--</div>
                        <div className="text-xs text-gray-500">probability</div>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Trading Interface Placeholder */}
        <Card>
          <CardHeader>
            <CardTitle>Trading</CardTitle>
            <CardDescription>
              Market trading interface will be available when trading begins
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-gray-500">
              <TrendingUp className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>Trading interface coming in Sprint 3</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export { MarketListPage, MarketDetailPage };