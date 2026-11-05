'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mail, MessageCircle, MessageSquare, Phone, UserRound } from 'lucide-react';
import { sellerPhoneHref, sellerWhatsAppHref, type SellerPortalManager } from '@/lib/seller/portal';
import { writeSellerWelcome } from '@/lib/seller/welcome';

const actionBase = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition';
const action = `${actionBase} bg-white/[0.05] text-[#e5e4e2]/85 hover:bg-[#d3bb73]/15 hover:text-[#d3bb73]`;
const primaryAction = `${actionBase} bg-[#d3bb73]/15 text-[#d3bb73] hover:bg-[#d3bb73]/25`;

function ManagerPhoto({ manager }: { manager: SellerPortalManager }) {
  const [failed, setFailed] = useState(false);
  const initials = manager.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  const url = manager.photo_url && /^https?:\/\//i.test(manager.photo_url) ? manager.photo_url : null;
  if (url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element -- external CRM avatar URL, size is fixed.
    return <img src={url} alt="" onError={() => setFailed(true)} className="h-16 w-16 shrink-0 rounded-full object-cover" />;
  }
  return <span aria-hidden="true" className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/15 text-lg font-medium text-[#d3bb73]">{initials || <UserRound className="h-7 w-7" />}</span>;
}

/** "Twój opiekun" — the MAVINCI account manager assigned in CRM. */
export default function SellerManagerCard({ manager, partnerId, compact = false }: {
  manager: SellerPortalManager | null | undefined;
  /** Marks the "Poznaj swojego opiekuna" onboarding step as done. */
  partnerId?: string;
  /** Header variant on the conversations page ("Napisz" scrolls to the chat). */
  compact?: boolean;
}) {
  const contacted = () => { if (partnerId) writeSellerWelcome(partnerId, { manager: true }); };
  if (!manager?.name) {
    return <section aria-labelledby="seller-manager-title" className="rounded-xl bg-[#1c1f33] p-5 text-[#e5e4e2]">
      <p id="seller-manager-title" className="text-xs uppercase tracking-[0.18em] text-[#d3bb73]">Twój opiekun</p>
      <p className="mt-3 text-sm">Opiekun zostanie przypisany wkrótce.</p>
      <p className="mt-1 text-xs leading-5 text-white/55">Do tego czasu napisz do zespołu MAVINCI — wiadomość trafi do osób odpowiedzialnych za współpracę z hotelami.</p>
      <Link href={compact ? '#seller-chat' : '/seller/messages'} onClick={contacted} className={`${primaryAction} mt-4`}><MessageSquare className="h-4 w-4" />Napisz do MAVINCI</Link>
    </section>;
  }
  const phoneHref = sellerPhoneHref(manager.phone);
  const whatsAppHref = sellerWhatsAppHref(manager.phone);
  return <section aria-labelledby="seller-manager-title" className="rounded-xl bg-[#1c1f33] p-5 text-[#e5e4e2]">
    <div className="flex items-center gap-4">
      <ManagerPhoto manager={manager} />
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-[0.18em] text-[#d3bb73]">Twój opiekun</p>
        <h2 id="seller-manager-title" className="mt-1 break-words text-lg font-light">{manager.name}</h2>
        <p className="text-xs text-white/50">{manager.position || 'Opiekun współpracy MAVINCI'}</p>
      </div>
    </div>
    {!compact && <div className="mt-3 space-y-1 text-sm">
      {manager.phone && <p className="break-all text-white/70">{manager.phone}</p>}
      {manager.email && <p className="break-all text-white/70">{manager.email}</p>}
    </div>}
    <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <Link href={compact ? '#seller-chat' : '/seller/messages'} onClick={contacted} className={primaryAction}><MessageSquare className="h-4 w-4" />Napisz</Link>
      {phoneHref && <a href={phoneHref} onClick={contacted} className={action}><Phone className="h-4 w-4" />Zadzwoń</a>}
      {whatsAppHref && <a href={whatsAppHref} target="_blank" rel="noopener noreferrer" onClick={contacted} className={action}><MessageCircle className="h-4 w-4" />WhatsApp</a>}
      {manager.email && <a href={`mailto:${manager.email}`} onClick={contacted} className={action}><Mail className="h-4 w-4" />E-mail</a>}
    </div>
  </section>;
}
