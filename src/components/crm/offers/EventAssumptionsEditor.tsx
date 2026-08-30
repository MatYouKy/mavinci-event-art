'use client';

import {
  EVENT_ASSUMPTION_OPTIONS,
  EventAssumptionItem,
  EventAssumptionKey,
  getEventAssumptionOption,
} from '@/lib/CRM/Offers/eventAssumptions';

export function EventAssumptionsEditor({
  value,
  onChange,
}: {
  value: EventAssumptionItem[];
  onChange: (items: EventAssumptionItem[]) => void;
}) {
  const updateItem = (index: number, nextItem: EventAssumptionItem) => {
    onChange(value.map((item, itemIndex) => (itemIndex === index ? nextItem : item)));
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-[#e5e4e2]">Trzy najważniejsze założenia biznesowe</p>
        <p className="mt-1 text-xs leading-5 text-[#e5e4e2]/45">
          Wybierz informacje istotne dla tej konkretnej realizacji. Te trzy odpowiedzi pojawią się również w ofercie PDF.
        </p>
      </div>

      {value.map((item, index) => {
        const option = getEventAssumptionOption(item.key);
        const selectedKeys = new Set(value.map((entry) => entry.key));
        return (
          <div key={`${index}-${item.key}`} className="rounded-lg border border-[#d3bb73]/15 bg-[#0f1118] p-3">
            <div className="mb-2 flex items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/15 text-xs font-semibold text-[#d3bb73]">
                {index + 1}
              </span>
              <select
                value={item.key}
                onChange={(event) => {
                  const key = event.target.value as EventAssumptionKey;
                  const nextOption = getEventAssumptionOption(key);
                  updateItem(index, {
                    key,
                    label: key === 'custom' ? '' : nextOption.label,
                    value: nextOption.defaultValue || '',
                    badge_value: nextOption.defaultBadgeValue || '',
                  });
                }}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#161927] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
              >
                {EVENT_ASSUMPTION_OPTIONS.map((candidate) => (
                  <option
                    key={candidate.key}
                    value={candidate.key}
                    disabled={candidate.key !== 'custom'
                      && candidate.key !== item.key
                      && selectedKeys.has(candidate.key)}
                  >
                    {candidate.label}
                  </option>
                ))}
              </select>
            </div>

            {item.key === 'custom' && (
              <div className="mb-3">
                <label className="mb-1.5 block text-xs text-[#d3bb73]">
                  Własny tytuł założenia
                </label>
                <input
                  value={item.label === option.label ? '' : item.label}
                  onChange={(event) => updateItem(index, {
                    ...item,
                    label: event.target.value.slice(0, 80),
                  })}
                  maxLength={80}
                  placeholder="np. Energia na parkiecie"
                  className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#090b13] px-3 py-2 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/50 focus:outline-none"
                />
              </div>
            )}

            <label className="mb-1.5 block text-xs text-[#d3bb73]">
              Wartość w burgundowym znaczniku <span className="text-[#e5e4e2]/35">(opcjonalnie)</span>
            </label>
            <div className="mb-3 flex items-center gap-3">
              <input
                value={item.badge_value || ''}
                onChange={(event) => updateItem(index, {
                  ...item,
                  badge_value: event.target.value.toLocaleUpperCase('pl-PL').slice(0, 7),
                })}
                maxLength={7}
                placeholder={`Puste pole = 0${index + 1}`}
                className="w-44 rounded-lg border border-[#d3bb73]/15 bg-[#090b13] px-3 py-2 text-sm uppercase text-[#e5e4e2] placeholder:normal-case placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/50 focus:outline-none"
              />
              <span className="text-xs leading-5 text-[#e5e4e2]/40">
                Np. „180”, „6 H”, „100%” lub „WOW”. Gdy pole jest puste, pojawi się numer sekcji 0{index + 1}.
              </span>
            </div>

            <label className="mb-1.5 block text-xs text-[#d3bb73]">{option.question}</label>
            {option.multiline ? (
              <textarea
                value={item.value}
                onChange={(event) => updateItem(index, { ...item, value: event.target.value })}
                rows={3}
                placeholder={option.placeholder}
                className="w-full resize-y rounded-lg border border-[#d3bb73]/15 bg-[#090b13] px-3 py-2 text-sm leading-5 text-[#e5e4e2] placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/50 focus:outline-none"
              />
            ) : (
              <input
                value={item.value}
                onChange={(event) => updateItem(index, { ...item, value: event.target.value })}
                placeholder={option.placeholder}
                className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#090b13] px-3 py-2 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/50 focus:outline-none"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
