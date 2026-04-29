import { useEffect, useState, useCallback, useRef } from 'react';
import { api_fetch } from '@/lib/api';

interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  message: string;
  timestamp: string;
  mongodb: string;
}

export function HealthIndicator() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkHealth = useCallback(async (isMounted: { current: boolean }) => {
    if (!isMounted.current) return;
    
    setIsChecking(true);
    
    try {
      const response = await api_fetch('/api/health');
      if (!response.ok) throw new Error('Health check failed');
      
      const data = await response.json();
      if (isMounted.current) {
        setHealth({
          status: data.status === 'healthy' ? 'healthy' : 'unhealthy',
          message: data.message || 'Server is available',
          timestamp: data.timestamp,
          mongodb: data.mongodb || 'unknown'
        });
      }
    } catch {
      if (isMounted.current) {
        setHealth({
          status: 'unhealthy',
          message: 'Cannot connect to backend',
          timestamp: new Date().toISOString(),
          mongodb: 'unknown'
        });
      }
    } finally {
      if (isMounted.current) {
        setIsChecking(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;

    const isMounted = { current: true };

    // Check immediately
    checkHealth(isMounted);

    // Then check every 10 seconds
    intervalRef.current = setInterval(() => checkHealth(isMounted), 10000);

    return () => {
      isMounted.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isActive, checkHealth]);

  const getStatus = () => {
    if (!isActive) return { text: 'Ping', color: 'bg-gray-400', pulse: true };
    if (isChecking) return { text: 'Ping', color: 'bg-amber-500', pulse: true };
    if (health?.status === 'healthy') return { text: 'Pong', color: 'bg-green-500', pulse: false };
    return { text: 'Not Connected', color: 'bg-red-500', pulse: true };
  };

  const status = getStatus();
  const isClickable = !isActive;

  return (
    <div className="flex items-center">
      <button
        onClick={isClickable ? () => setIsActive(true) : undefined}
        disabled={!isClickable}
        className={`flex items-center py-2 px-3 bg-transparent border-none ${
          isClickable ? 'cursor-pointer opacity-70' : 'cursor-default opacity-100'
        }`}
      >
        <div className="relative w-4 h-4 flex items-center justify-center mr-3">
          {/* Ping effect */}
          {status.pulse && (
            <div className={`absolute w-4 h-4 rounded-full ${status.color} animate-ping`} />
          )}

          {/* Main dot */}
          <div className={`w-4 h-4 rounded-full ${status.color} ${status.pulse ? 'animate-pulse-slow' : ''}`} />
        </div>

        <span className="text-sm text-gray-600 font-medium">
          {status.text}
        </span>
      </button>
    </div>
  );
}