// PRZYKŁAD UŻYCIA: Messages Prefetch System
// Ten plik zawiera przykłady użycia systemu prefetchingu dla wiadomości

import MessagesPrefetchButton from './MessagesPrefetchButton';
import PrefetchLink from './PrefetchLink';
import { Mail, Inbox } from 'lucide-react';

// ==========================================
// PRZYKŁAD 1: Przycisk w nawigacji (główny)
// ==========================================
export function NavigationExample() {
  return (
    <nav className="space-y-2">
      <MessagesPrefetchButton
        className="flex items-center gap-3 w-full rounded-lg px-4 py-3 text-white hover:bg-[#d3bb73]/10 transition-colors"
        onClick={() => console.log('Prefetching messages...')}
      >
        <Mail className="h-5 w-5" />
        <span>Wiadomości</span>
      </MessagesPrefetchButton>
    </nav>
  );
}

// ==========================================
// PRZYKŁAD 2: Link z prefetchem
// ==========================================
export function DashboardLinkExample() {
  return (
    <div className="bg-[#1c1f33] p-6 rounded-lg">
      <h3 className="text-xl font-bold text-white mb-4">Nowe wiadomości</h3>
      <p className="text-[#e5e4e2]/60 mb-4">Masz 5 nieprzeczytanych wiadomości</p>

      <PrefetchLink
        href="/crm/messages"
        prefetchType="messages"
        className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-3 rounded-lg hover:bg-[#c5ad65] transition-colors"
      >
        <Mail className="h-5 w-5" />
        <span>Przejdź do wiadomości</span>
      </PrefetchLink>
    </div>
  );
}

// ==========================================
// PRZYKŁAD 3: Quick Action Card
// ==========================================
export function QuickActionCard() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <MessagesPrefetchButton
        className="flex flex-col items-center justify-center p-6 bg-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/10 transition-colors"
      >
        <Mail className="h-12 w-12 text-[#d3bb73] mb-2" />
        <span className="text-white font-semibold">Wiadomości</span>
        <span className="text-xs text-[#e5e4e2]/60 mt-1">3 nowe</span>
      </MessagesPrefetchButton>

      <button className="flex flex-col items-center justify-center p-6 bg-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/10 transition-colors">
        <Inbox className="h-12 w-12 text-[#d3bb73] mb-2" />
        <span className="text-white font-semibold">Inbox</span>
      </button>
    </div>
  );
}

// ==========================================
// PRZYKŁAD 4: Badge z licznikiem (używany w Navigation)
// ==========================================
export function BadgeExample() {
  const unreadCount = 5;

  return (
    <MessagesPrefetchButton
      className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-[#d3bb73]/10 transition-colors relative"
    >
      <div className="relative">
        <Mail className="h-5 w-5 text-white" />
        {unreadCount > 0 && (
          <div className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </div>
        )}
      </div>
      <span className="text-white">Wiadomości</span>
    </MessagesPrefetchButton>
  );
}

// ==========================================
// PRZYKŁAD 5: Custom onClick Handler
// ==========================================
export function CustomHandlerExample() {
  const handlePrefetch = () => {
    console.log('Rozpoczynam prefetch...');
    // Możesz dodać własną logikę, np.:
    // - Analytics tracking
    // - Pre-loading innych zasobów
    // - Pokazanie tooltipa
  };

  return (
    <MessagesPrefetchButton
      onClick={handlePrefetch}
      className="bg-[#d3bb73] text-[#1c1f33] px-6 py-3 rounded-lg hover:bg-[#c5ad65]"
    >
      Otwórz wiadomości
    </MessagesPrefetchButton>
  );
}

// ==========================================
// PRZYKŁAD 6: Mobile Card
// ==========================================
export function MobileCardExample() {
  return (
    <div className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] rounded-xl p-4 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-white">Wiadomości</h3>
          <p className="text-xs text-[#e5e4e2]/60">5 nieprzeczytanych</p>
        </div>
        <Mail className="h-8 w-8 text-[#d3bb73]" />
      </div>

      <MessagesPrefetchButton
        className="w-full bg-[#d3bb73] text-[#1c1f33] py-2 rounded-lg font-semibold hover:bg-[#c5ad65] transition-colors"
      >
        Otwórz
      </MessagesPrefetchButton>
    </div>
  );
}

// ==========================================
// PRZYKŁAD 7: Lista z ikonami
// ==========================================
export function IconListExample() {
  const menuItems = [
    { key: 'messages', label: 'Wiadomości', icon: Mail, badge: 5 },
    { key: 'inbox', label: 'Inbox', icon: Inbox, badge: 0 },
  ];

  return (
    <div className="space-y-2">
      {menuItems.map((item) => (
        <div key={item.key}>
          {item.key === 'messages' ? (
            <MessagesPrefetchButton
              className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-white hover:bg-[#d3bb73]/10 transition-colors"
            >
              <item.icon className="h-5 w-5" />
              <span className="flex-1">{item.label}</span>
              {item.badge > 0 && (
                <span className="bg-red-500 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
                  {item.badge}
                </span>
              )}
            </MessagesPrefetchButton>
          ) : (
            <button className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-white hover:bg-[#d3bb73]/10 transition-colors">
              <item.icon className="h-5 w-5" />
              <span className="flex-1">{item.label}</span>
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
