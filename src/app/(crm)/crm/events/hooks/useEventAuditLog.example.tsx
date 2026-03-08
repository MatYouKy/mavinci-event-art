/**
 * PRZYKŁAD UŻYCIA: useEventAuditLog
 *
 * Ten plik pokazuje kompletny przykład użycia hooka useEventAuditLog
 * do wyświetlania historii zmian wydarzenia w formie timeline z filtrami.
 */

'use client';

import { useState } from 'react';
import { useEventAuditLog, AuditActionType } from './useEventAuditLog';
import * as Icons from 'lucide-react';

interface EventAuditLogExampleProps {
  eventId: string;
}

export default function EventAuditLogExample({ eventId }: EventAuditLogExampleProps) {
  const {
    auditLog,
    groupedByDate,
    groupedByUser,
    stats,
    filterByAction,
    isLoading,
    error,
    refetch,
  } = useEventAuditLog(eventId);

  // Stany dla filtrów
  const [viewMode, setViewMode] = useState<'timeline' | 'byDate' | 'byUser' | 'stats'>('timeline');
  const [selectedActionFilter, setSelectedActionFilter] = useState<AuditActionType | 'all'>('all');

  // Obsługa błędu
  if (error) {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-4">
        <p className="text-red-800">Błąd podczas ładowania historii zmian</p>
        <button
          onClick={() => refetch()}
          className="mt-2 rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700"
        >
          Spróbuj ponownie
        </button>
      </div>
    );
  }

  // Ładowanie
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Icons.Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-500" />
          <p className="mt-2 text-gray-600">Ładowanie historii zmian...</p>
        </div>
      </div>
    );
  }

  // Filtrowanie
  const displayedAuditLog =
    selectedActionFilter === 'all' ? auditLog : filterByAction([selectedActionFilter]);

  // Najczęstsze akcje do filtrów
  const topActions: AuditActionType[] = ['create', 'update', 'delete', 'status_changed'];

  return (
    <div className="space-y-6">
      {/* Nagłówek z przyciskami widoku */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Historia zmian</h2>
          <p className="text-sm text-gray-600">
            {stats.totalEntries} zmian • {stats.uniqueUsers} użytkowników
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('timeline')}
            className={`rounded px-4 py-2 text-sm font-medium ${
              viewMode === 'timeline'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Icons.List className="inline h-4 w-4 mr-1" />
            Timeline
          </button>
          <button
            onClick={() => setViewMode('byDate')}
            className={`rounded px-4 py-2 text-sm font-medium ${
              viewMode === 'byDate'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Icons.Calendar className="inline h-4 w-4 mr-1" />
            Po dacie
          </button>
          <button
            onClick={() => setViewMode('byUser')}
            className={`rounded px-4 py-2 text-sm font-medium ${
              viewMode === 'byUser'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Icons.Users className="inline h-4 w-4 mr-1" />
            Po użytkowniku
          </button>
          <button
            onClick={() => setViewMode('stats')}
            className={`rounded px-4 py-2 text-sm font-medium ${
              viewMode === 'stats'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Icons.BarChart3 className="inline h-4 w-4 mr-1" />
            Statystyki
          </button>
        </div>
      </div>

      {/* Filtry akcji */}
      {viewMode === 'timeline' && (
        <div className="flex flex-wrap gap-2 rounded-lg bg-gray-50 p-4">
          <button
            onClick={() => setSelectedActionFilter('all')}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              selectedActionFilter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            Wszystkie ({stats.totalEntries})
          </button>

          {topActions.map((action) => {
            const count = stats.actionCounts[action] || 0;
            if (count === 0) return null;

            return (
              <button
                key={action}
                onClick={() => setSelectedActionFilter(action)}
                className={`rounded-full px-4 py-2 text-sm font-medium ${
                  selectedActionFilter === action
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                {action === 'create' && 'Utworzenia'}
                {action === 'update' && 'Aktualizacje'}
                {action === 'delete' && 'Usunięcia'}
                {action === 'status_changed' && 'Zmiany statusu'}
                {' '}({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Widok Timeline */}
      {viewMode === 'timeline' && (
        <div className="relative space-y-4">
          {/* Pionowa linia */}
          <div className="absolute left-4 top-0 h-full w-0.5 bg-gray-200" />

          {displayedAuditLog.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              Brak zmian do wyświetlenia
            </div>
          ) : (
            displayedAuditLog.map((entry) => {
              const IconComponent = (Icons as any)[entry.actionIcon] || Icons.Activity;
              const colorClasses = {
                green: 'bg-green-100 text-green-600 border-green-300',
                blue: 'bg-blue-100 text-blue-600 border-blue-300',
                red: 'bg-red-100 text-red-600 border-red-300',
                purple: 'bg-purple-100 text-purple-600 border-purple-300',
                orange: 'bg-orange-100 text-orange-600 border-orange-300',
                cyan: 'bg-cyan-100 text-cyan-600 border-cyan-300',
                teal: 'bg-teal-100 text-teal-600 border-teal-300',
                gray: 'bg-gray-100 text-gray-600 border-gray-300',
              };

              const colorClass = colorClasses[entry.actionColor as keyof typeof colorClasses] || colorClasses.gray;

              return (
                <div key={entry.id} className="relative flex items-start gap-4 pl-12">
                  {/* Ikona akcji */}
                  <div
                    className={`absolute left-0 flex h-8 w-8 items-center justify-center rounded-full ${colorClass}`}
                  >
                    <IconComponent className="h-4 w-4" />
                  </div>

                  {/* Zawartość */}
                  <div className="flex-1 rounded-lg border bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <span className={`font-semibold ${colorClass.split(' ')[1]}`}>
                          {entry.actionLabel}
                        </span>

                        {entry.entity_type && (
                          <span className="ml-2 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">
                            {entry.entity_type}
                          </span>
                        )}

                        <p className="mt-1 text-sm text-gray-700">
                          {entry.displayDescription}
                        </p>
                      </div>

                      <span className="ml-4 text-xs text-gray-400 whitespace-nowrap">
                        {entry.timeAgo}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                      <Icons.User className="h-3 w-3" />
                      <span className="font-medium">{entry.displayUser}</span>
                      <span>•</span>
                      <Icons.Clock className="h-3 w-3" />
                      <span>{entry.formattedDate}</span>
                    </div>

                    {/* Szczegóły zmian */}
                    {entry.hasChanges && (
                      <div className="mt-3 space-y-1 border-t pt-2">
                        {entry.old_value !== null && (
                          <div className="flex items-start gap-2 text-xs">
                            <Icons.Minus className="h-3 w-3 mt-0.5 text-red-500 flex-shrink-0" />
                            <div className="flex-1">
                              <span className="text-gray-500">Przed:</span>
                              <pre className="mt-1 overflow-x-auto rounded bg-red-50 p-2 font-mono text-red-700">
                                {typeof entry.old_value === 'object'
                                  ? JSON.stringify(entry.old_value, null, 2)
                                  : String(entry.old_value)}
                              </pre>
                            </div>
                          </div>
                        )}
                        {entry.new_value !== null && (
                          <div className="flex items-start gap-2 text-xs">
                            <Icons.Plus className="h-3 w-3 mt-0.5 text-green-500 flex-shrink-0" />
                            <div className="flex-1">
                              <span className="text-gray-500">Po:</span>
                              <pre className="mt-1 overflow-x-auto rounded bg-green-50 p-2 font-mono text-green-700">
                                {typeof entry.new_value === 'object'
                                  ? JSON.stringify(entry.new_value, null, 2)
                                  : String(entry.new_value)}
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Widok po dacie */}
      {viewMode === 'byDate' && (
        <div className="space-y-6">
          {Object.entries(groupedByDate).map(([date, entries]) => (
            <div key={date}>
              <div className="mb-3 flex items-center gap-3">
                <h3 className="text-lg font-semibold text-gray-900">{date}</h3>
                <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                  {entries.length} zmian
                </span>
              </div>

              <div className="space-y-2">
                {entries.map((entry) => {
                  const IconComponent = (Icons as any)[entry.actionIcon] || Icons.Activity;

                  return (
                    <div
                      key={entry.id}
                      className="flex items-start gap-3 rounded-lg bg-white p-3 shadow-sm border hover:shadow-md transition-shadow"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100">
                        <IconComponent className="h-4 w-4 text-gray-600" />
                      </div>

                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-gray-900">{entry.actionLabel}</span>
                          <span className="text-xs text-gray-400">{entry.timeAgo}</span>
                        </div>

                        <p className="mt-1 text-sm text-gray-600">{entry.displayDescription}</p>

                        <p className="mt-1 text-xs text-gray-500">
                          {entry.displayUser}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Widok po użytkowniku */}
      {viewMode === 'byUser' && (
        <div className="space-y-6">
          {Object.entries(groupedByUser)
            .sort((a, b) => b[1].length - a[1].length)
            .map(([userName, entries]) => (
              <div key={userName}>
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white font-semibold">
                    {userName.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{userName}</h3>
                    <p className="text-xs text-gray-500">{entries.length} zmian</p>
                  </div>
                </div>

                <div className="ml-13 space-y-2 border-l-2 border-gray-200 pl-4">
                  {entries.map((entry) => (
                    <div key={entry.id} className="rounded bg-gray-50 p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">
                          {entry.actionLabel}
                        </span>
                        <span className="text-xs text-gray-400">{entry.timeAgo}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-600">{entry.displayDescription}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Widok statystyk */}
      {viewMode === 'stats' && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 p-6">
            <Icons.Activity className="mb-2 h-8 w-8 text-blue-600" />
            <div className="text-3xl font-bold text-blue-900">{stats.totalEntries}</div>
            <div className="text-sm text-blue-700">Wszystkich zmian</div>
          </div>

          <div className="rounded-lg bg-gradient-to-br from-green-50 to-green-100 p-6">
            <Icons.Users className="mb-2 h-8 w-8 text-green-600" />
            <div className="text-3xl font-bold text-green-900">{stats.uniqueUsers}</div>
            <div className="text-sm text-green-700">Unikalnych użytkowników</div>
          </div>

          {stats.mostActiveUser && (
            <div className="rounded-lg bg-gradient-to-br from-purple-50 to-purple-100 p-6">
              <Icons.Award className="mb-2 h-8 w-8 text-purple-600" />
              <div className="text-lg font-bold text-purple-900">{stats.mostActiveUser}</div>
              <div className="text-sm text-purple-700">Najaktywniejszy</div>
            </div>
          )}

          <div className="col-span-full rounded-lg bg-white p-6 shadow-sm border">
            <h4 className="mb-4 flex items-center gap-2 font-semibold text-gray-900">
              <Icons.BarChart3 className="h-5 w-5" />
              Rozkład akcji
            </h4>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {Object.entries(stats.actionCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([action, count]) => (
                  <div key={action} className="rounded-lg bg-gray-50 p-3">
                    <div className="text-2xl font-bold text-gray-900">{count}</div>
                    <div className="text-xs text-gray-600">{action}</div>
                  </div>
                ))}
            </div>
          </div>

          {stats.lastChange && (
            <div className="col-span-full rounded-lg bg-gradient-to-br from-orange-50 to-orange-100 p-6">
              <div className="flex items-start gap-4">
                <Icons.Clock className="mt-1 h-8 w-8 flex-shrink-0 text-orange-600" />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-orange-900">Ostatnia zmiana</div>
                  <div className="mt-1 text-lg font-medium text-orange-800">
                    {stats.lastChange.actionLabel}: {stats.lastChange.displayDescription}
                  </div>
                  <div className="mt-2 text-sm text-orange-700">
                    {stats.lastChange.displayUser} • {stats.lastChange.timeAgo}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
