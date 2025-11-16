'use client';

import { useState, useEffect } from 'react';
import { X, Send, Mail, Phone, User, MessageSquare } from 'lucide-react';
import { supabase } from '@/lib/supabase';

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

  useEffect(() => {
    if (isOpen) {
      setFormData(prev => ({
        ...prev,
        city: defaultCity,
        eventType: defaultEventType,
      }));
      setSubmitSuccess(false);
      setSubmitError('');
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

      const { error } = await supabase
        .from('contact_form_submissions')
        .insert([submissionData]);

      if (error) throw error;

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
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
      <div className="relative w-full max-w-2xl bg-gradient-to-br from-[#1c1f33] to-[#0f1119] border border-[#d3bb73]/30 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />

        <div className="p-6 md:p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-[#d3bb73]/10 rounded-full flex items-center justify-center">
                <Mail className="w-6 h-6 text-[#d3bb73]" />
              </div>
              <div>
                <h2 className="text-2xl font-light text-[#e5e4e2]">Skontaktuj się z nami</h2>
                <p className="text-sm text-[#e5e4e2]/60">{sourcePage}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {submitSuccess ? (
            <div className="py-12 text-center">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-xl font-light text-[#e5e4e2] mb-2">Dziękujemy za kontakt!</h3>
              <p className="text-[#e5e4e2]/60">Odpowiemy najszybciej jak to możliwe.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70 mb-2">
                  <User className="w-4 h-4" />
                  Imię i nazwisko *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none transition-colors"
                  placeholder="Jan Kowalski"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70 mb-2">
                    <Mail className="w-4 h-4" />
                    Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none transition-colors"
                    placeholder="jan@example.com"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70 mb-2">
                    <Phone className="w-4 h-4" />
                    Telefon
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none transition-colors"
                    placeholder="+48 123 456 789"
                  />
                </div>
              </div>

              {sourcePage.includes('kasyno') && (
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-[#e5e4e2]/70 mb-2 block">
                      Miasto eventu
                    </label>
                    <select
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none transition-colors"
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
                    <label className="text-sm text-[#e5e4e2]/70 mb-2 block">
                      Typ eventu
                    </label>
                    <select
                      value={formData.eventType}
                      onChange={(e) => setFormData({ ...formData, eventType: e.target.value })}
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none transition-colors"
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
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70 mb-2">
                  <MessageSquare className="w-4 h-4" />
                  Wiadomość *
                </label>
                <textarea
                  required
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  rows={5}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none transition-colors resize-none"
                  placeholder="Opisz swoje potrzeby..."
                />
              </div>

              {submitError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
                  {submitError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full flex items-center justify-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-[#1c1f33]/30 border-t-[#1c1f33] rounded-full animate-spin" />
                    Wysyłanie...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Wyślij wiadomość
                  </>
                )}
              </button>

              <p className="text-xs text-center text-[#e5e4e2]/40">
                * Pola wymagane. Twoje dane są bezpieczne i nie będą udostępniane osobom trzecim.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
