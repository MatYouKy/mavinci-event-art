import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';

interface ActivityStatusIndicatorProps {
  lastActiveAt?: string | null;
  size?: 'sm' | 'md' | 'lg';
  showTooltip?: boolean;
}

type ActivityStatus = 'online' | 'away' | 'offline';

export function ActivityStatusIndicator({
  lastActiveAt,
  size = 'md',
  showTooltip = true,
}: ActivityStatusIndicatorProps) {
  const [status, setStatus] = useState<ActivityStatus>('offline');

  useEffect(() => {
    const calculateStatus = () => {
      if (!lastActiveAt) {
        setStatus('offline');
        return;
      }

      const lastActive = new Date(lastActiveAt);
      const now = new Date();
      const minutesInactive = (now.getTime() - lastActive.getTime()) / 1000 / 60;

      if (minutesInactive < 1) {
        setStatus('online');
      } else if (minutesInactive < 30) {
        setStatus('away');
      } else {
        setStatus('offline');
      }
    };

    calculateStatus();

    const interval = setInterval(calculateStatus, 10000);

    return () => clearInterval(interval);
  }, [lastActiveAt]);

  const sizeClasses = {
    sm: 'h-2 w-2',
    md: 'h-3 w-3',
    lg: 'h-4 w-4',
  };

  const statusConfig = {
    online: {
      color: 'bg-green-500',
      ring: 'ring-green-500/20',
      label: 'Online',
      description: 'Aktywny teraz',
    },
    away: {
      color: 'bg-yellow-500',
      ring: 'ring-yellow-500/20',
      label: 'Nieaktywny',
      description: 'Nieaktywny od 10 min',
    },
    offline: {
      color: 'bg-gray-500',
      ring: 'ring-gray-500/20',
      label: 'Offline',
      description: 'Nieaktywny > 30 min',
    },
  };

  const config = statusConfig[status];

  if (!showTooltip) {
    return (
      <div
        className={`${sizeClasses[size]} ${config.color} ${config.ring} rounded-full ring-2 ring-offset-1 ring-offset-[#1c1f33]`}
      />
    );
  }

  return (
    <div className="group relative">
      <div
        className={`${sizeClasses[size]} ${config.color} ${config.ring} rounded-full ring-2 ring-offset-1 ring-offset-[#1c1f33]`}
      />
      <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden -translate-x-1/2 group-hover:block">
        <div className="whitespace-nowrap rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-xs text-[#e5e4e2] shadow-xl">
          <div className="font-semibold">{config.label}</div>
          <div className="text-[#e5e4e2]/60">{config.description}</div>
          <div className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-4 border-transparent border-t-[#0f1119]" />
        </div>
      </div>
    </div>
  );
}
