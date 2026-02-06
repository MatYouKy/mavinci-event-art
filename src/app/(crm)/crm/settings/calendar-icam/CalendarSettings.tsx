'use client';

import React, { useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';
import { X, Link as LinkIcon, Copy as CopyIcon, Smartphone, CalendarDays } from 'lucide-react';

export const CalendarSettings = () => {
  const { showSnackbar } = useSnackbar();

  const [icalUrl, setIcalUrl] = useState('');
  const [icalWebcalUrl, setIcalWebcalUrl] = useState('');
  const [icalLoading, setIcalLoading] = useState(false);

  const [showIosModal, setShowIosModal] = useState(false);
  const [showAndroidModal, setShowAndroidModal] = useState(false);

  const getAccessToken = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session?.access_token;
  };

  const fetchIcalUrl = async () => {
    try {
      setIcalLoading(true);

      const accessToken = await getAccessToken();
      if (!accessToken) {
        showSnackbar('Brak sesji użytkownika – zaloguj się ponownie', 'error');
        return;
      }

      const res = await fetch('/bridge/events/calendar/ical/ical-token', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      const json = await res.json();
      if (!res.ok) throw json;

      const token = json.token as string;
      const origin = window.location.origin;

      const httpsUrl = `${origin}/bridge/events/calendar/ical/${token}`;
      const webcalUrl = httpsUrl.replace(/^https:\/\//, 'webcal://');

      setIcalUrl(httpsUrl);
      setIcalWebcalUrl(webcalUrl);

      showSnackbar('Link iCal wygenerowany', 'success');
    } catch (e) {
      console.error('fetchIcalUrl error', e);
      showSnackbar('Nie udało się wygenerować linku iCal', 'error');
    } finally {
      setIcalLoading(false);
    }
  };

  const copyIcalUrl = async () => {
    if (!icalUrl) return;
    await navigator.clipboard.writeText(icalUrl);
    showSnackbar('Link iCal skopiowany', 'success');
  };

  const openIcalUrl = () => {
    if (!icalUrl) return;
    window.open(icalUrl, '_blank', 'noreferrer');
  };

  // ✅ Actions w ResponsiveActionBar
  const actions: Action[] = [
    {
      label: icalLoading ? 'Generuję...' : 'Wygeneruj link',
      onClick: fetchIcalUrl,
      icon: <LinkIcon className="w-4 h-4" />,
      variant: 'primary',
      disabled: icalLoading,
    },
    {
      label: 'Skopiuj',
      onClick: copyIcalUrl,
      icon: <CopyIcon className="w-4 h-4" />,
      disabled: !icalUrl,
      show: Boolean(icalUrl), // ✅ pokaż dopiero po wygenerowaniu
    },
    {
      label: 'Otwórz',
      onClick: openIcalUrl,
      icon: <CalendarDays className="w-4 h-4" />,
      disabled: !icalUrl,
      show: Boolean(icalUrl), // ✅ pokaż dopiero po wygenerowaniu
    },
    {
      label: 'Instrukcja iPhone (iOS)',
      onClick: () => setShowIosModal(true),
      icon: <Smartphone className="w-4 h-4" />,
      disabled: !icalUrl,
      show: Boolean(icalUrl), // ✅ dopiero po wygenerowaniu
    },
    {
      label: 'Instrukcja Android / Google',
      onClick: () => setShowAndroidModal(true),
      icon: <Smartphone className="w-4 h-4" />,
      disabled: !icalUrl,
      show: Boolean(icalUrl), // ✅ dopiero po wygenerowaniu
    },
  ];

  return (
    <>
      <div className="mb-6 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-[#e5e4e2]">
              Subskrypcja kalendarza (iPhone / Google)
            </p>
            <p className="text-xs text-[#e5e4e2]/60">
              Jeden link – zawsze aktualny kalendarz wydarzeń i spotkań.
            </p>
          </div>

          {/* ✅ ResponsiveActionBar - obsłuży mobile dropdown */}
          <ResponsiveActionBar actions={actions}  />
        </div>

        {icalUrl && (
          <div className="mt-3 break-all rounded-lg bg-[#13161f] p-3 text-xs text-[#e5e4e2]/80">
            {icalUrl}
          </div>
        )}
      </div>

      {/* iOS MODAL */}
      {showIosModal && (
        <Modal onClose={() => setShowIosModal(false)} title="Jak dodać kalendarz na iPhone (iOS)">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Otwórz <b>Ustawienia</b></li>
            <li>Wejdź w <b>Kalendarz → Konta</b></li>
            <li>Wybierz <b>Dodaj konto → Inne</b></li>
            <li>Kliknij <b>Dodaj subskrybowany kalendarz</b></li>
            <li>Wklej link (najlepiej webcal):</li>
          </ol>

          <div className="mt-3 rounded bg-[#13161f] p-2 text-xs break-all">
            {icalWebcalUrl || icalUrl}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(icalWebcalUrl || icalUrl);
                showSnackbar('Skopiowano link dla iOS', 'success');
              }}
              className="rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#1c1f33]"
            >
              Skopiuj link iOS
            </button>
          </div>

          <p className="mt-3 text-xs text-[#e5e4e2]/60">
            iPhone odświeża subskrypcję automatycznie (czasem z opóźnieniem).
          </p>
        </Modal>
      )}

      {/* ANDROID / GOOGLE MODAL */}
      {showAndroidModal && (
        <Modal onClose={() => setShowAndroidModal(false)} title="Jak dodać kalendarz Google (Android)">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Otwórz <b>Google Calendar</b> w przeglądarce (na komputerze najwygodniej)</li>
            <li>Po lewej kliknij <b>+</b> obok „Inne kalendarze”</li>
            <li>Wybierz <b>Z adresu URL</b></li>
            <li>Wklej link:</li>
          </ol>

          <div className="mt-3 rounded bg-[#13161f] p-2 text-xs break-all">{icalUrl}</div>

          <div className="mt-3 flex gap-2">
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(icalUrl);
                showSnackbar('Skopiowano link', 'success');
              }}
              className="rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#1c1f33]"
            >
              Skopiuj link
            </button>
          </div>

          <p className="mt-3 text-xs text-[#e5e4e2]/60">
            Synchronizacja Google może potrwać kilka minut (czasem dłużej).
          </p>
        </Modal>
      )}
    </>
  );
};

/* ===== Modal ===== */

const Modal = ({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        // klik w tło zamyka
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-medium text-[#e5e4e2]">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-[#d3bb73]/10">
            <X className="h-5 w-5 text-[#e5e4e2]" />
          </button>
        </div>
        <div className="text-[#e5e4e2]">{children}</div>
      </div>
    </div>
  );
};