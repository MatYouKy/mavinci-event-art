'use client';

import { useState, useEffect } from 'react';
import { Shield, AlertTriangle, FileText, Wrench, Clock, X } from 'lucide-react';

interface VehicleAlert {
  id: string;
  alert_type: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  icon: string;
  is_blocking: boolean;
  due_date: string | null;
  created_at: string;
}

interface VehicleAlertsWidgetProps {
  vehicleId: string;
  onAlertClick?: (alert: VehicleAlert) => void;
}

const VehicleAlertsWidget = ({ vehicleId, onAlertClick }: VehicleAlertsWidgetProps) => {
  const [alerts, setAlerts] = useState<VehicleAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchAlerts();

    // Subscribe to realtime changes
    const setupSubscription = async () => {
      const { createClient } = await import('@/lib/supabase');
      const supabase = createClient();

      const channel = supabase
        .channel(`vehicle_alerts_${vehicleId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'vehicle_alerts',
            filter: `vehicle_id=eq.${vehicleId}`,
          },
          () => {
            fetchAlerts();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    };

    setupSubscription();
  }, [vehicleId]);

  const fetchAlerts = async () => {
    try {
      const { createClient } = await import('@/lib/supabase');
      const supabase = createClient();

      const { data, error } = await supabase
        .from('vehicle_alerts')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('is_active', true)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching alerts:', error);
        setAlerts([]);
      } else {
        setAlerts(data || []);
      }
    } catch (error) {
      console.error('Error:', error);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  };

  const getIcon = (iconName: string) => {
    const icons: Record<string, any> = {
      Shield,
      AlertTriangle,
      FileText,
      Wrench,
      Clock
    };
    const IconComponent = icons[iconName] || AlertTriangle;
    return <IconComponent className="w-5 h-5" />;
  };

  const getPriorityStyles = (priority: string) => {
    switch (priority) {
      case 'critical':
        return 'bg-red-500/20 border-red-500/50 text-red-400';
      case 'high':
        return 'bg-orange-500/20 border-orange-500/50 text-orange-400';
      case 'medium':
        return 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400';
      case 'low':
        return 'bg-blue-500/20 border-blue-500/50 text-blue-400';
      default:
        return 'bg-[#e5e4e2]/10 border-[#e5e4e2]/30 text-[#e5e4e2]';
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'critical':
        return 'Krytyczny';
      case 'high':
        return 'Wysoki';
      case 'medium':
        return 'Średni';
      case 'low':
        return 'Niski';
      default:
        return priority;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[#e5e4e2]/60">
        <Clock className="w-4 h-4 animate-spin" />
        Ładowanie alertów...
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400">
        <Shield className="w-5 h-5" />
        <span className="font-medium">Brak aktywnych alertów</span>
      </div>
    );
  }

  const blockingAlertsCount = alerts.filter(a => a.is_blocking).length;

  return (
    <div className="space-y-2">
      {/* Header z podsumowaniem */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-4 px-4 py-3 bg-[#e5e4e2]/5 border border-[#e5e4e2]/20 rounded-lg hover:bg-[#e5e4e2]/10 transition-colors"
      >
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-400" />
          <div className="text-left">
            <div className="font-medium text-[#e5e4e2]">
              Aktywne alerty: {alerts.length}
            </div>
            {blockingAlertsCount > 0 && (
              <div className="text-sm text-red-400">
                {blockingAlertsCount} blokujących
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {alerts.slice(0, 3).map((alert) => (
            <span
              key={alert.id}
              className={`px-2 py-1 rounded text-xs ${getPriorityStyles(alert.priority)}`}
            >
              {getPriorityLabel(alert.priority)}
            </span>
          ))}
          <X
            className={`w-5 h-5 text-[#e5e4e2]/60 transition-transform ${
              expanded ? 'rotate-45' : ''
            }`}
          />
        </div>
      </button>

      {/* Rozwinięta lista alertów */}
      {expanded && (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              onClick={() => onAlertClick?.(alert)}
              className={`p-4 border rounded-lg cursor-pointer hover:bg-[#e5e4e2]/5 transition-colors ${getPriorityStyles(
                alert.priority
              )}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  {getIcon(alert.icon)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium">{alert.title}</h4>
                    {alert.is_blocking && (
                      <span className="px-2 py-0.5 bg-red-500/30 text-red-300 text-xs rounded border border-red-500/50">
                        🔒 Blokuje
                      </span>
                    )}
                  </div>
                  <p className="text-sm opacity-90">{alert.message}</p>
                  {alert.due_date && (
                    <p className="text-xs mt-2 opacity-75 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Termin: {new Date(alert.due_date).toLocaleDateString('pl-PL')}
                    </p>
                  )}
                </div>
                <div>
                  <span className={`text-xs px-2 py-1 rounded border ${getPriorityStyles(alert.priority)}`}>
                    {getPriorityLabel(alert.priority)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VehicleAlertsWidget;
