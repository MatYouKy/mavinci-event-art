'use client';

import { useState, useEffect } from 'react';
import { X, Send, Mail, Phone, User, MessageSquare } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useFormTracking } from '@/hooks/useFormTracking';

interface ContactFormProps {
  isOpen: boolean;
  onClose: () => void;
  sourcePage: string;
  sourceSection?: string;
  defaultCity?: string;
  defaultEventType?: string;
}

export default function ContactFormWithTracking({
  isOpen,
  onClose,
  sourcePage,
  sourceSection = '',
  defaultCity = '',
  defaultEventType = '',
}: ContactFormProps) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    message: '',
    city: defaultCity,
    eventType: defaultEventType,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const { trackFormStart, trackFieldFilled, trackFormComplete, trackFormAbandoned } =
    useFormTracking({
      formName: 'contact-form',
      enabled: isOpen,
    });

  useEffect(() => {
    if (isOpen) {
      setFormData((prev) => ({
        ...prev,
        city: defaultCity,
        eventType: defaultEventType,
      }));
      setSubmitSuccess(false);
      setSubmitError('');
      trackFormStart();
    } else if (formData.name || formData.email || formData.phone || formData.message) {
      trackFormAbandoned();
    }
  }, [isOpen, defaultCity, defaultEventType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError('');

    try {
      const urlParams = new URLSearchParams(window.location.search);

      const submissionData = {
        name: formData.name,
        email: formData.email,
        phone: formData.phone || null,
        message: formData.message,
        source_page: sourcePage,
        source_section: sourceSection || null,
        city_interest: formData.city || null,
        event_type: formData.eventType || null,
        utm_source: urlParams.get('utm_source') || null,
        utm_medium: urlParams.get('utm_medium') || null,
        utm_campaign: urlParams.get('utm_campaign') || null,
        referrer: document.referrer || null,
        user_agent: navigator.userAgent || null,
        status: 'new',
      };

      const { error } = await supabase.from('contact_form_submissions').insert([submissionData]);

      if (error) throw error;

      trackFormComplete(formData);
      setSubmitSuccess(true);

      setTimeout(() => {
        setFormData({
          name: '',
          email: '',
          phone: '',
          message: '',
          city: defaultCity,
          eventType: defaultEventType,
        });
        setTimeout(onClose, 1500);
      }, 2000);
    } catch (error) {
      console.error('Error submitting form:', error);
      setSubmitError('Wystąpił błąd podczas wysyłania formularza. Spróbuj ponownie.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md">
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#d3bb73]/30 bg-gradient-to-br from-[#1c1f33] to-[#0f1119] shadow-2xl">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />

        <div className="p-6 md:p-8">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#d3bb73]/10">
                <Mail className="h-6 w-6 text-[#d3bb73]" />
              </div>
              <div>
                <h2 className="text-2xl font-light text-[#e5e4e2]">Skontaktuj się z nami</h2>
                <p className="text-sm text-[#e5e4e2]/60">{sourcePage}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {submitSuccess ? (
            <div className="py-12 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
                <svg
                  className="h-8 w-8 text-green-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="mb-2 text-xl font-light text-[#e5e4e2]">Dziękujemy za kontakt!</h3>
              <p className="text-[#e5e4e2]/60">Odpowiemy najszybciej jak to możliwe.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-2 flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <User className="h-4 w-4" />
                  Imię i nazwisko *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => {
                    setFormData({ ...formData, name: e.target.value });
                    if (e.target.value) trackFieldFilled('name');
                  }}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-[#e5e4e2] transition-colors focus:border-[#d3bb73] focus:outline-none"
                  placeholder="Jan Kowalski"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                    <Mail className="h-4 w-4" />
                    Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => {
                      setFormData({ ...formData, email: e.target.value });
                      if (e.target.value) trackFieldFilled('email');
                    }}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-[#e5e4e2] transition-colors focus:border-[#d3bb73] focus:outline-none"
                    placeholder="jan@example.com"
                  />
                </div>

                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                    <Phone className="h-4 w-4" />
                    Telefon
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => {
                      setFormData({ ...formData, phone: e.target.value });
                      if (e.target.value) trackFieldFilled('phone');
                    }}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-[#e5e4e2] transition-colors focus:border-[#d3bb73] focus:outline-none"
                    placeholder="+48 123 456 789"
                  />
                </div>
              </div>

              {sourcePage.includes('kasyno') && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/70">Miasto eventu</label>
                    <select
                      value={formData.city}
                      onChange={(e) => {
                        setFormData({ ...formData, city: e.target.value });
                        if (e.target.value) trackFieldFilled('city');
                      }}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-[#e5e4e2] transition-colors focus:border-[#d3bb73] focus:outline-none"
                    >
                      <option value="">Wybierz miasto</option>
                      <option value="Warszawa">Warszawa</option>
                      <option value="Kraków">Kraków</option>
                      <option value="Wrocław">Wrocław</option>
                      <option value="Poznań">Poznań</option>
                      <option value="Gdańsk">Gdańsk / Trójmiasto</option>
                      <option value="Katowice">Katowice / Śląsk</option>
                      <option value="Łódź">Łódź</option>
                      <option value="Szczecin">Szczecin</option>
                      <option value="Lublin">Lublin</option>
                      <option value="Inne">Inne miasto</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/70">Typ eventu</label>
                    <select
                      value={formData.eventType}
                      onChange={(e) => setFormData({ ...formData, eventType: e.target.value })}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-[#e5e4e2] transition-colors focus:border-[#d3bb73] focus:outline-none"
                    >
                      <option value="">Wybierz typ</option>
                      <option value="Kasyno eventowe">Kasyno eventowe</option>
                      <option value="Event firmowy">Event firmowy</option>
                      <option value="Gala">Gala</option>
                      <option value="Integracja">Integracja pracownicza</option>
                      <option value="Wieczór tematyczny">Wieczór tematyczny</option>
                      <option value="Inne">Inne</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="mb-2 flex items-center gap-2 text-sm text-[#e5e4e2]/70">
                  <MessageSquare className="h-4 w-4" />
                  Wiadomość *
                </label>
                <textarea
                  required
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  rows={5}
                  className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-[#e5e4e2] transition-colors focus:border-[#d3bb73] focus:outline-none"
                  placeholder="Opisz swoje potrzeby..."
                />
              </div>

              {submitError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  {submitError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-[#d3bb73] px-8 py-3 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#1c1f33]/30 border-t-[#1c1f33]" />
                    Wysyłanie...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Wyślij wiadomość
                  </>
                )}
              </button>

              <p className="text-center text-xs text-[#e5e4e2]/40">
                * Pola wymagane. Twoje dane są bezpieczne i nie będą udostępniane osobom trzecim.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
