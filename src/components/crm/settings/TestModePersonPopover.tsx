'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Building2, Clock, ExternalLink, KeyRound, Loader2, LogIn, Mail, Phone, ShieldCheck, UserRound, X } from 'lucide-react';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import { PERMISSION_SCOPE_GROUPS, getPermissionLabel } from '@/lib/permissionCatalog';
import { systemLabel } from '@/lib/ui/systemLabels';
import { departmentLabel } from '@/lib/CRM/meetings/teamAvailability';

/*
 * Ustawienia → „Tryb testowy” (`TestModePanel`, `docs/test-mode.md`): karta pracownika nad listą — większe zdjęcie, dział,
 * poziom dostępu, rola, przełożony, kontakt służbowy, ostatnia aktywność i uprawnienia (nazwy jak w CRM, `permissionCatalog`),
 * „Otwórz kartę pracownika” (nowa karta przeglądarki) i „Wejdź jako”. Dane: `test_mode_targets` (tylko administrator).
 */

type AvatarPosition = { posX: number; posY: number; scale: number };
type AvatarMetadata = {
  desktop?: { src?: string; position?: AvatarPosition; objectFit?: string };
  mobile?: { src?: string; position?: AvatarPosition; objectFit?: string };
} | null;

export type TestModeEmployeeTarget = {
  kind: 'employee';
  id: string;
  name: string | null;
  nickname: string | null;
  avatar_url: string | null;
  occupation: string | null;
  department: string | null;
  role: string | null;
  access_level: string | null;
  permissions: number;
  /** Od migracji `20261202120000_test_mode_target_details.sql`. */
  email?: string | null;
  phone?: string | null;
  avatar_metadata?: AvatarMetadata;
  permission_keys?: string[] | null;
  supervisor?: string | null;
  last_active_at?: string | null;
};

const when = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('pl-PL', {
    timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

/** Uprawnienia pracownika pogrupowane jak w edytorze uprawnień CRM; nieznane — „Inne”. */
function permissionGroups(keys: string[]) {
  const owned = new Set(keys);
  const known = new Set<string>();
  const groups = PERMISSION_SCOPE_GROUPS.map((group) => {
    const scopes = group.scopes.filter((scope) => owned.has(scope.key) && !known.has(scope.key));
    scopes.forEach((scope) => known.add(scope.key));
    return { key: group.key, label: group.label, scopes: scopes.map((scope) => ({ key: scope.key, label: scope.label, description: scope.description })) };
  }).filter((group) => group.scopes.length > 0);
  const other = keys.filter((key) => !known.has(key));
  if (other.length) groups.push({ key: 'other', label: 'Inne', scopes: other.map((key) => ({ key, label: getPermissionLabel(key), description: key })) });
  return groups;
}

type Props = {
  person: TestModeEmployeeTarget;
  /** Karta pracownika na liście — popover pojawia się pod nią (albo nad, gdy brak miejsca). */
  anchor: HTMLElement;
  entering: boolean;
  disabled: boolean;
  onEnter: () => void;
  onClose: () => void;
  /** Najechanie / zjechanie kursorem (otwarcie po najechaniu zamyka się po zjechaniu z karty i popovera). */
  onHover: (inside: boolean) => void;
};

export default function TestModePersonPopover({ person, anchor, entering, disabled, onEnter, onClose, onHover }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const name = person.name || person.nickname || 'Pracownik';
  const keys = useMemo(() => (Array.isArray(person.permission_keys) ? person.permission_keys : []), [person.permission_keys]);
  const groups = useMemo(() => permissionGroups(keys), [keys]);
  const lastActive = when(person.last_active_at);

  useLayoutEffect(() => {
    const place = () => {
      const card = ref.current;
      if (!card) return;
      const rect = anchor.getBoundingClientRect();
      const margin = 8;
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      let top = rect.bottom + 8;
      if (top + height > window.innerHeight - margin && rect.top - 8 - height >= margin) top = rect.top - 8 - height;
      top = Math.max(margin, Math.min(top, window.innerHeight - margin - height));
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - margin - width));
      setPosition((previous) => (previous && previous.top === top && previous.left === left ? previous : { top, left }));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = new ResizeObserver(place);
    if (ref.current) observer.observe(ref.current);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer.disconnect();
    };
  }, [anchor]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || ref.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [anchor, onClose]);

  if (typeof document === 'undefined') return null;

  const rows: Array<{ icon: typeof Mail; label: string; value: ReactNode }> = [
    { icon: Building2, label: 'Dział', value: departmentLabel(person.department) },
    { icon: ShieldCheck, label: 'Poziom dostępu', value: person.access_level || '—' },
    { icon: UserRound, label: 'Rola', value: person.role ? systemLabel(person.role, 'role') : '—' },
    { icon: UserRound, label: 'Przełożony', value: person.supervisor || '—' },
    {
      icon: Mail, label: 'E-mail',
      value: person.email ? <a href={`mailto:${person.email}`} className="text-[#d3bb73] hover:underline">{person.email}</a> : '—',
    },
    {
      icon: Phone, label: 'Telefon',
      value: person.phone ? <a href={`tel:${person.phone.replace(/\s+/g, '')}`} className="text-[#d3bb73] hover:underline">{person.phone}</a> : '—',
    },
    { icon: Clock, label: 'Ostatnio aktywny', value: lastActive || 'brak danych' },
  ];

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Pracownik: ${name}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{ top: position?.top ?? -9999, left: position?.left ?? -9999, visibility: position ? 'visible' : 'hidden' }}
      className="fixed z-[9000] w-[380px] max-w-[calc(100vw-16px)] rounded-xl border border-[#d3bb73]/25 bg-[#1c1f33] text-[#e5e4e2] shadow-2xl shadow-black/60"
    >
      <button type="button" onClick={onClose} aria-label="Zamknij"
        className="absolute right-2 top-2 rounded-md p-1 text-[#e5e4e2]/50 hover:bg-white/10 hover:text-[#e5e4e2]">
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-center gap-4 border-b border-white/10 p-4 pr-10">
        <EmployeeAvatar employeeId={person.id} avatarUrl={person.avatar_url} avatarMetadata={person.avatar_metadata ?? null} employeeName={name} size={112} />
        <div className="min-w-0">
          <p className="text-base font-medium leading-tight">{name}</p>
          {person.nickname && person.nickname !== name ? <p className="text-sm text-[#e5e4e2]/60">„{person.nickname}”</p> : null}
          {person.occupation ? <p className="mt-1 text-sm text-[#d3bb73]/90">{person.occupation}</p> : null}
        </div>
      </div>

      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 px-4 py-3 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="flex items-center gap-1.5 text-[#e5e4e2]/50"><row.icon className="h-3.5 w-3.5" aria-hidden />{row.label}</dt>
            <dd className="min-w-0 truncate">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-white/10 px-4 py-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-[#e5e4e2]/50">
          <KeyRound className="h-3.5 w-3.5" aria-hidden />Uprawnienia ({person.permissions})
        </p>
        {groups.length === 0 ? (
          <p className="text-sm text-[#e5e4e2]/50">
            {person.permission_keys === undefined ? 'Lista uprawnień po migracji 20261202120000_test_mode_target_details.sql.' : 'Brak dodatkowych uprawnień — tylko to, co daje poziom dostępu.'}
          </p>
        ) : (
          <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
            {groups.map((group) => (
              <div key={group.key}>
                <p className="mb-1 text-xs text-[#d3bb73]/80">{group.label}</p>
                <div className="flex flex-wrap gap-1">
                  {group.scopes.map((scope) => (
                    <span key={scope.key} title={scope.description} className="rounded-md bg-white/5 px-1.5 py-0.5 text-xs text-[#e5e4e2]/80">{scope.label}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 p-3">
        <button type="button" onClick={() => window.open(`/crm/employees/${person.id}`, '_blank', 'noopener,noreferrer')}
          className="flex items-center gap-1.5 rounded-lg border border-[#d3bb73]/30 px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10">
          <ExternalLink className="h-3.5 w-3.5" />Otwórz kartę pracownika
        </button>
        <button type="button" onClick={onEnter} disabled={disabled}
          className="flex items-center gap-1.5 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-xs font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50">
          {entering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}Wejdź jako
        </button>
      </div>
    </div>,
    document.body,
  );
}
