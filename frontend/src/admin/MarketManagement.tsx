import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { 
  Plus, 
  RefreshCw, 
  Eye, 
  Play, 
  Pause, 
  Trash2,
  Calendar,
  Target,
  BarChart3,
  CheckCircle,
  XCircle,
  AlertTriangle
} from 'lucide-react';

interface Event {
  _id: string;
  title: string;
  description: string;
  auction_id?: string;
  slug: string;
  status: 'draft' | 'published' | 'trading' | 'resolved' | 'cancelled';
  created_at: string;
  auction?: {
    title: string;
    make: string;
    model: string;
    year: number;
  };
}

interface Market {
  _id: string;
  event_id: string;
  title: string;
  description: string;
  type: 'threshold' | 'bucket';
  threshold_value?: number;
  bucket_ranges?: Array<{ min: number; max?: number; label: string }>;
  status: 'draft' | 'published' | 'trading' | 'resolved' | 'cancelled';
  trading_starts_at: string;
  trading_ends_at: string;
  created_at: string;
  event?: Event;
  outcomes?: Array<{
    _id: string;
    title: string;
    slug: string;
    sort_order: number;
  }>;
}

interface Auction {
  _id: string;
  title: string;
  make: string;
  model: string;
  year: number;
  status: string;
}

const MarketManagement: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'markets' | 'events'>('markets');
  const [markets, setMarkets] = useState<Market[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [showCreateMarket, setShowCreateMarket] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);

  // Form states
  const [eventForm, setEventForm] = useState({
    title: '',
    description: '',
    auction_id: ''
  });

  const [marketForm, setMarketForm] = useState({
    event_id: '',
    title: '',
    description: '',
    type: 'threshold' as 'threshold' | 'bucket',
    threshold_value: '',
    bucket_ranges: [] as Array<{ min: number; max?: number; label: string }>,
    trading_starts_at: '',
    trading_ends_at: ''
  });

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [marketsRes, eventsRes, auctionsRes] = await Promise.all([
        fetch('/api/markets'),
        fetch('/api/admin/events'),
        fetch('/api/auctions')
      ]);

      if (marketsRes.ok) {
        const marketsData = await marketsRes.json();
        setMarkets(marketsData.data || []);
      }

      if (eventsRes.ok) {
        const eventsData = await eventsRes.json();
        setEvents(eventsData.data || []);
      }

      if (auctionsRes.ok) {
        const auctionsData = await auctionsRes.json();
        setAuctions(auctionsData.data || []);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Create Event
  const createEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/admin/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...eventForm,
          admin_user_id: '507f1f77bcf86cd799439011' // Mock admin ID
        })
      });

      if (response.ok) {
        setEventForm({ title: '', description: '', auction_id: '' });
        setShowCreateEvent(false);
        loadData();
      }
    } catch (error) {
      console.error('Error creating event:', error);
    }
  };

  // Create Market
  const createMarket = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const marketData = {
        ...marketForm,
        threshold_value: marketForm.threshold_value ? Number(marketForm.threshold_value) : undefined,
        trading_starts_at: new Date(marketForm.trading_starts_at).toISOString(),
        trading_ends_at: new Date(marketForm.trading_ends_at).toISOString(),
        admin_user_id: '507f1f77bcf86cd799439011' // Mock admin ID
      };

      const response = await fetch('/api/admin/markets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(marketData)
      });

      if (response.ok) {
        setMarketForm({
          event_id: '',
          title: '',
          description: '',
          type: 'threshold',
          threshold_value: '',
          bucket_ranges: [],
          trading_starts_at: '',
          trading_ends_at: ''
        });
        setShowCreateMarket(false);
        loadData();
      }
    } catch (error) {
      console.error('Error creating market:', error);
    }
  };

  // Publish/Unpublish Market
  const toggleMarketStatus = async (marketId: string, currentStatus: string) => {
    try {
      const action = currentStatus === 'draft' ? 'publish' : 'unpublish';
      const response = await fetch(`/api/admin/markets/${marketId}/${action}`, {
        method: 'POST'
      });

      if (response.ok) {
        loadData();
      }
    } catch (error) {
      console.error('Error updating market status:', error);
    }
  };

  const getStatusBadge = (status: string) => {
    const config = {
      draft: { color: 'bg-gray-100 text-gray-700', label: 'Draft' },
      published: { color: 'bg-green-100 text-green-700', label: 'Published' },
      trading: { color: 'bg-blue-100 text-blue-700', label: 'Trading' },
      resolved: { color: 'bg-purple-100 text-purple-700', label: 'Resolved' },
      cancelled: { color: 'bg-red-100 text-red-700', label: 'Cancelled' }
    };

    const { color, label } = config[status as keyof typeof config] || config.draft;

    return (
      <Badge className={color}>
        {label}
      </Badge>
    );
  };

  const getTypeIcon = (type: string) => {
    return type === 'threshold' ? (
      <Target className="h-4 w-4 text-indigo-600" />
    ) : (
      <BarChart3 className="h-4 w-4 text-orange-600" />
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Market Management</h1>
          <p className="text-gray-600 mt-1">Create and manage prediction markets and events</p>
        </div>
        <Button onClick={loadData} variant="outline" disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('markets')}
            className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'markets'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Markets ({markets.length})
          </button>
          <button
            onClick={() => setActiveTab('events')}
            className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'events'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Events ({events.length})
          </button>
        </nav>
      </div>

      {/* Markets Tab */}
      {activeTab === 'markets' && (
        <div className="space-y-6">
          {/* Create Market Button */}
          <div className="flex justify-between items-center">
            <div className="text-sm text-gray-600">
              Manage prediction markets and their trading periods
            </div>
            <Button onClick={() => setShowCreateMarket(true)} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-2" />
              Create Market
            </Button>
          </div>

          {/* Markets List */}
          <div className="space-y-4">
            {markets.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <Target className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600">No markets created yet</p>
                  <p className="text-sm text-gray-400 mt-1">Create your first prediction market</p>
                </CardContent>
              </Card>
            ) : (
              markets.map((market) => (
                <Card key={market._id}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          {getTypeIcon(market.type)}
                          <h3 className="text-lg font-semibold text-gray-900">{market.title}</h3>
                          {getStatusBadge(market.status)}
                          <Badge variant="outline" className={
                            market.type === 'threshold' ? 'border-indigo-200 text-indigo-700' : 'border-orange-200 text-orange-700'
                          }>
                            {market.type === 'threshold' ? 'Yes/No' : 'Multiple Choice'}
                          </Badge>
                        </div>
                        
                        <p className="text-gray-600 mb-3">{market.description}</p>
                        
                        <div className="grid grid-cols-2 gap-4 text-sm text-gray-500">
                          <div>
                            <span className="font-medium">Event:</span> {market.event?.title || 'Unknown Event'}
                          </div>
                          <div>
                            <span className="font-medium">Trading Period:</span> {' '}
                            {new Date(market.trading_starts_at).toLocaleDateString()} - {' '}
                            {new Date(market.trading_ends_at).toLocaleDateString()}
                          </div>
                          {market.type === 'threshold' && market.threshold_value && (
                            <div>
                              <span className="font-medium">Threshold:</span> {market.threshold_value}
                            </div>
                          )}
                          <div>
                            <span className="font-medium">Outcomes:</span> {market.outcomes?.length || 0}
                          </div>
                        </div>

                        {/* Outcomes Preview */}
                        {market.outcomes && market.outcomes.length > 0 && (
                          <div className="mt-3">
                            <div className="flex flex-wrap gap-2">
                              {market.outcomes.slice(0, 4).map((outcome) => (
                                <span key={outcome._id} className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">
                                  {outcome.title}
                                </span>
                              ))}
                              {market.outcomes.length > 4 && (
                                <span className="px-2 py-1 text-gray-400 text-xs">
                                  +{market.outcomes.length - 4} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center space-x-2 ml-4">
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => setSelectedMarket(market)}
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          Preview
                        </Button>
                        
                        {market.status === 'draft' && (
                          <Button
                            size="sm"
                            onClick={() => toggleMarketStatus(market._id, market.status)}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <Play className="h-3 w-3 mr-1" />
                            Publish
                          </Button>
                        )}

                        {market.status === 'published' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => toggleMarketStatus(market._id, market.status)}
                          >
                            <Pause className="h-3 w-3 mr-1" />
                            Unpublish
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      )}

      {/* Events Tab */}
      {activeTab === 'events' && (
        <div className="space-y-6">
          {/* Create Event Button */}
          <div className="flex justify-between items-center">
            <div className="text-sm text-gray-600">
              Events are the foundation for prediction markets
            </div>
            <Button onClick={() => setShowCreateEvent(true)} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-2" />
              Create Event
            </Button>
          </div>

          {/* Events List */}
          <div className="space-y-4">
            {events.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <Calendar className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-600">No events created yet</p>
                  <p className="text-sm text-gray-400 mt-1">Create your first event to enable market creation</p>
                </CardContent>
              </Card>
            ) : (
              events.map((event) => (
                <Card key={event._id}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3 mb-2">
                          <Calendar className="h-5 w-5 text-blue-600" />
                          <h3 className="text-lg font-semibold text-gray-900">{event.title}</h3>
                          {getStatusBadge(event.status)}
                        </div>
                        
                        <p className="text-gray-600 mb-3">{event.description}</p>
                        
                        {event.auction && (
                          <div className="text-sm text-gray-500 mb-2">
                            <span className="font-medium">Linked Auction:</span> {' '}
                            {event.auction.year} {event.auction.make} {event.auction.model}
                          </div>
                        )}
                        
                        <div className="text-xs text-gray-400">
                          Created: {new Date(event.created_at).toLocaleDateString()}
                        </div>
                      </div>

                      <div className="ml-4 text-right">
                        <div className="text-sm font-medium text-gray-900">
                          {markets.filter(m => m.event_id === event._id).length} markets
                        </div>
                        <div className="text-xs text-gray-500">associated</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      )}

      {/* Create Event Modal */}
      {showCreateEvent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle>Create New Event</CardTitle>
              <CardDescription>
                Events serve as the foundation for prediction markets
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={createEvent} className="space-y-4">
                <div>
                  <Label htmlFor="event-title">Event Title</Label>
                  <Input
                    id="event-title"
                    value={eventForm.title}
                    onChange={(e) => setEventForm({...eventForm, title: e.target.value})}
                    placeholder="e.g., 2024 Presidential Election"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="event-description">Description</Label>
                  <Textarea
                    id="event-description"
                    value={eventForm.description}
                    onChange={(e) => setEventForm({...eventForm, description: e.target.value})}
                    placeholder="Describe the event..."
                    rows={3}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="event-auction">Link to Auction (Optional)</Label>
                  <Select 
                    value={eventForm.auction_id}
                    onValueChange={(value) => setEventForm({...eventForm, auction_id: value})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select an auction..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">No auction</SelectItem>
                      {auctions.map(auction => (
                        <SelectItem key={auction._id} value={auction._id}>
                          {auction.year} {auction.make} {auction.model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex space-x-3">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setShowCreateEvent(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" className="flex-1">
                    Create Event
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Create Market Modal */}
      {showCreateMarket && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>Create New Market</CardTitle>
              <CardDescription>
                Configure a prediction market with specific outcomes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={createMarket} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="market-event">Event</Label>
                    <Select 
                      value={marketForm.event_id}
                      onValueChange={(value) => setMarketForm({...marketForm, event_id: value})}
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select event..." />
                      </SelectTrigger>
                      <SelectContent>
                        {events.map(event => (
                          <SelectItem key={event._id} value={event._id}>
                            {event.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="market-type">Market Type</Label>
                    <Select 
                      value={marketForm.type}
                      onValueChange={(value: 'threshold' | 'bucket') => setMarketForm({...marketForm, type: value})}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="threshold">Threshold (Yes/No)</SelectItem>
                        <SelectItem value="bucket">Bucket (Multiple Choice)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label htmlFor="market-title">Market Title</Label>
                  <Input
                    id="market-title"
                    value={marketForm.title}
                    onChange={(e) => setMarketForm({...marketForm, title: e.target.value})}
                    placeholder="e.g., Will X candidate win the election?"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="market-description">Description</Label>
                  <Textarea
                    id="market-description"
                    value={marketForm.description}
                    onChange={(e) => setMarketForm({...marketForm, description: e.target.value})}
                    placeholder="Describe what this market predicts..."
                    rows={3}
                    required
                  />
                </div>

                {marketForm.type === 'threshold' && (
                  <div>
                    <Label htmlFor="threshold-value">Threshold Value</Label>
                    <Input
                      id="threshold-value"
                      type="number"
                      value={marketForm.threshold_value}
                      onChange={(e) => setMarketForm({...marketForm, threshold_value: e.target.value})}
                      placeholder="e.g., 270"
                      required
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="trading-starts">Trading Starts</Label>
                    <Input
                      id="trading-starts"
                      type="datetime-local"
                      value={marketForm.trading_starts_at}
                      onChange={(e) => setMarketForm({...marketForm, trading_starts_at: e.target.value})}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="trading-ends">Trading Ends</Label>
                    <Input
                      id="trading-ends"
                      type="datetime-local"
                      value={marketForm.trading_ends_at}
                      onChange={(e) => setMarketForm({...marketForm, trading_ends_at: e.target.value})}
                      required
                    />
                  </div>
                </div>

                <div className="flex space-x-3">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setShowCreateMarket(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" className="flex-1">
                    Create Market
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Market Preview Modal */}
      {selectedMarket && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Market Preview</CardTitle>
                  <CardDescription>How this market will appear to users</CardDescription>
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setSelectedMarket(null)}
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  {getTypeIcon(selectedMarket.type)}
                  <h2 className="text-xl font-bold">{selectedMarket.title}</h2>
                  {getStatusBadge(selectedMarket.status)}
                </div>
                
                <p className="text-gray-600">{selectedMarket.description}</p>
                
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium text-gray-700">Trading Period:</span>
                      <div className="text-gray-600">
                        {new Date(selectedMarket.trading_starts_at).toLocaleDateString()} - {' '}
                        {new Date(selectedMarket.trading_ends_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Type:</span>
                      <div className="text-gray-600">
                        {selectedMarket.type === 'threshold' ? 'Yes/No (Threshold)' : 'Multiple Choice (Bucket)'}
                      </div>
                    </div>
                    {selectedMarket.threshold_value && (
                      <div>
                        <span className="font-medium text-gray-700">Threshold:</span>
                        <div className="text-gray-600">{selectedMarket.threshold_value}</div>
                      </div>
                    )}
                  </div>
                </div>

                {selectedMarket.outcomes && selectedMarket.outcomes.length > 0 && (
                  <div>
                    <h3 className="font-medium text-gray-900 mb-2">Outcomes</h3>
                    <div className="space-y-2">
                      {selectedMarket.outcomes.map((outcome) => (
                        <div key={outcome._id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                          <span className="font-medium">{outcome.title}</span>
                          <span className="text-sm text-gray-500">No trading yet</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default MarketManagement;