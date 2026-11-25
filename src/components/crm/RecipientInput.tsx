'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Building2, History, Loader2, User, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import {
  RECIPIENT_KIND_LABELS, RECIPIENT_SUGGESTION_DELAY, RECIPIENT_SUGGESTION_LIMIT, insertRecipient, recipientDetail,
  recipientQueryReady, recipientSuggestionFromRow, recipientToken, type RecipientSuggestion, type RecipientSuggestionKind,
} from '@/lib/CRM/messages/recipientSuggestions';

/*
 * Pole adresatów („Do”, „DW”, „UDW”) z podpowiedziami jak w Thunderbirdzie: przy wpisywaniu imienia, nazwiska, fragmentu
 * adresu albo nazwy firmy lista pokazuje kontakty, organizacje, pracowników i osoby z korespondencji (funkcja bazy
 * `email_recipient_suggestions`, uprawnienia osoby — RLS) z powiązaniem: organizacja i liczba wiadomości.
 * ↑ / ↓ — wybór, Enter lub Tab — wstawienie adresu (z „, ” na następny), Esc — zamknięcie listy. Kilka adresów po przecinku.
 */

const KIND_ICONS: Record<RecipientSuggestionKind, typeof User> = {
  contact: UserRound,
  organization: Building2,
  employee: User,
  correspondence: History,
};

export default function RecipientInput({
  value, onChange, disabled = false, placeholder, className, ariaLabel, autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const ticket = useRef(0);
  const [caret, setCaret] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<RecipientSuggestion[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const token = recipientToken(value, caret);
  const query = token.query;

  useEffect(() => {
    if (!focused || dismissed || !recipientQueryReady(query)) {
      ticket.current += 1;
      setSuggestions([]);
      setLoading(false);
      return;
    }
    const current = ++ticket.current;
    const timer = setTimeout(() => {
      setLoading(true);
      void (async () => {
        const { data, error } = await supabase.rpc('email_recipient_suggestions', { p_query: query, p_limit: RECIPIENT_SUGGESTION_LIMIT });
        if (current !== ticket.current) return;
        setLoading(false);
        if (error) {
          // Bez podpowiedzi (np. przed migracją bazy) pole działa jak zwykłe pole adresu.
          setSuggestions([]);
          return;
        }
        const rows = ((data || []) as Array<Record<string, unknown>>)
          .map(recipientSuggestionFromRow)
          .filter((item): item is RecipientSuggestion => Boolean(item));
        setSuggestions(rows);
        setActive(0);
      })();
    }, RECIPIENT_SUGGESTION_DELAY);
    return () => clearTimeout(timer);
  }, [query, focused, dismissed]);

  const open = focused && !dismissed && suggestions.length > 0 && recipientQueryReady(query);

  const choose = (suggestion: RecipientSuggestion) => {
    const next = insertRecipient(value, token, suggestion.email);
    onChange(next.value);
    setSuggestions([]);
    setCaret(next.caret);
    ticket.current += 1;
    requestAnimationFrame(() => {
      const field = input.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(next.caret, next.caret);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => (index + step + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      choose(suggestions[Math.min(active, suggestions.length - 1)]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
    }
  };

  return (
    <div className="relative">
      <input
        ref={input}
        type="text"
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onChange={(event) => {
          setDismissed(false);
          setCaret(event.target.selectionStart);
          onChange(event.target.value);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setDismissed(false);
          // Zostawiony separator po ostatnim adresie („a@b.pl, ”) — bez znaczenia przy wysyłce, ale porządkujemy pole.
          if (/[,;]\s*$/.test(value)) onChange(value.replace(/[\s,;]+$/, ''));
        }}
        onKeyDown={onKeyDown}
        className={className}
      />
      {focused && loading && !open && recipientQueryReady(query) && (
        <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#d3bb73]/60" aria-hidden />
      )}
      {open && (
        <ul id={listId} role="listbox" aria-label="Podpowiedzi adresatów"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-[#d3bb73]/25 bg-[#0f1119] py-1 shadow-2xl">
          {suggestions.map((suggestion, index) => {
            const Icon = KIND_ICONS[suggestion.kind];
            const detail = recipientDetail(suggestion);
            return (
              <li key={suggestion.email} id={`${listId}-${index}`} role="option" aria-selected={index === active}
                onMouseDown={(event) => { event.preventDefault(); choose(suggestion); }}
                onMouseEnter={() => setActive(index)}
                className={`flex cursor-pointer items-start gap-3 px-3 py-2 text-sm ${index === active ? 'bg-[#d3bb73]/15' : ''}`}>
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#d3bb73]" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[#e5e4e2]">
                    {suggestion.name || suggestion.email}
                    {suggestion.name && <span className="text-[#e5e4e2]/55"> &lt;{suggestion.email}&gt;</span>}
                  </span>
                  {detail && <span className="block truncate text-xs text-[#e5e4e2]/45">{detail}</span>}
                </span>
                <span className="shrink-0 rounded-full border border-[#d3bb73]/20 px-2 py-0.5 text-[10px] text-[#d3bb73]/80">
                  {RECIPIENT_KIND_LABELS[suggestion.kind]}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
