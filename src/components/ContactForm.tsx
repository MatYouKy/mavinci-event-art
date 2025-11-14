'use client';

import { useState, useEffect } from 'react';
import { Formik, Form, Field, ErrorMessage } from 'formik';
import * as Yup from 'yup';
import { Send, Upload, FileText, X as XIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import confetti from 'canvas-confetti';
import { useDialog } from '@/contexts/DialogContext';

export interface ContactFormProps {
  category?: string;
  subject?: string;
  customTitle?: string;
  customDescription?: string;
}

export interface ContactFormData {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  eventType?: string;
  message: string;
  cvFile?: File | null;
}

const validationSchema = Yup.object({
  name: Yup.string().min(2, 'Imię musi mieć co najmniej 2 znaki').required('Pole wymagane'),
  email: Yup.string().email('Nieprawidłowy adres email').required('Pole wymagane'),
  phone: Yup.string().matches(/^[+]?[\d\s-()]+$/, 'Nieprawidłowy numer telefonu'),
  company: Yup.string(),
  eventType: Yup.string(),
  message: Yup.string()
    .min(10, 'Wiadomość musi mieć co najmniej 10 znaków')
    .required('Pole wymagane'),
});

export default function ContactForm({
  category = 'general',
  subject,
  customTitle,
  customDescription,
}: ContactFormProps) {
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isError, setIsError] = useState(false);
  const [sourcePage, setSourcePage] = useState('/');
  const { showAlert } = useDialog();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setSourcePage(window.location.pathname);
    }
  }, []);

  const initialValues: ContactFormData = {
    name: '',
    email: '',
    phone: '',
    company: '',
    eventType: '',
    message: '',
    cvFile: null,
  };

  const handleSubmit = async (values: ContactFormData, { resetForm }: any) => {
    setIsLoading(true);
    setIsError(false);
    try {
      const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';

      let cvUrl = null;
      let cvFilename = null;

      // Check if CV file was uploaded (from DOM input)
      if (category === 'team_join') {
        const fileInput = document.getElementById('cvFileUpload') as HTMLInputElement;
        const file = fileInput?.files?.[0];

        if (file) {
          console.log('[ContactForm] Uploading CV:', file.name);

          // Upload directly to Supabase Storage
          const fileName = `cv-uploads/${Date.now()}-${Math.random().toString(36).substring(7)}-${file.name}`;

          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('site-images')
            .upload(fileName, file, {
              cacheControl: '3600',
              upsert: false,
            });

          if (uploadError) {
            console.error('[ContactForm] CV upload error:', uploadError);
            throw new Error('Nie udało się przesłać pliku CV');
          }

          const { data: urlData } = supabase.storage
            .from('site-images')
            .getPublicUrl(uploadData.path);

          cvUrl = urlData.publicUrl;
          cvFilename = file.name;
          console.log('[ContactForm] CV uploaded:', cvUrl);
        }
      }

      const { error } = await supabase.from('contact_messages').insert([
        {
          name: values.name,
          email: values.email,
          phone: values.phone || null,
          company: values.company || null,
          category: category,
          source_page: sourcePage,
          subject: subject || `${category} - ${values.eventType || 'Nowa wiadomość'}`,
          message: values.message,
          status: 'new',
          priority: category === 'event_inquiry' || category === 'team_join' ? 'high' : 'normal',
          user_agent: userAgent,
          cv_url: cvUrl,
          cv_filename: cvFilename,
        },
      ]);

      if (error) throw error;

      setIsSuccess(true);

      // Trigger confetti animation
      const duration = 3000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };

      const randomInRange = (min: number, max: number) => {
        return Math.random() * (max - min) + min;
      };

      const interval: any = setInterval(() => {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);

        confetti({
          ...defaults,
          particleCount,
          origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
          colors: ['#d3bb73', '#e5e4e2', '#1c1f33'],
        });
        confetti({
          ...defaults,
          particleCount,
          origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
          colors: ['#d3bb73', '#e5e4e2', '#1c1f33'],
        });
      }, 250);

      resetForm();
      setTimeout(() => setIsSuccess(false), 5000);
    } catch (error) {
      console.error('Failed to submit form:', error);
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  };

  const getFormTitle = () => {
    if (customTitle) return customTitle;
    switch (category) {
      case 'team_join':
        return 'Dołącz do Zespołu';
      case 'event_inquiry':
        return 'Zapytaj o Event';
      case 'portfolio':
        return 'Zapytaj o Realizację';
      case 'services':
        return 'Zapytaj o Usługę';
      default:
        return 'Skontaktuj się z nami';
    }
  };

  const getFormDescription = () => {
    if (customDescription) return customDescription;
    switch (category) {
      case 'team_join':
        return 'Chcesz dołączyć do naszego zespołu? Wypełnij formularz, a my skontaktujemy się z Tobą.';
      case 'event_inquiry':
        return 'Masz pytanie o organizację eventu? Opisz swoje potrzeby, a my przygotujemy ofertę.';
      case 'portfolio':
        return 'Zainteresowała Cię jedna z naszych realizacji? Napisz do nas!';
      case 'services':
        return 'Chcesz dowiedzieć się więcej o naszych usługach? Skontaktuj się z nami!';
      default:
        return 'Wypełnij formularz, a my skontaktujemy się z Tobą najszybciej jak to możliwe.';
    }
  };

  return (
    <div className="animate-[fadeInRight_0.8s_ease-out]">
      <div className="mb-6">
        <h3 className="mb-2 text-2xl font-light text-[#e5e4e2]">{getFormTitle()}</h3>
        <p className="text-sm text-[#e5e4e2]/70">{getFormDescription()}</p>
      </div>

      <Formik
        initialValues={initialValues}
        validationSchema={validationSchema}
        onSubmit={handleSubmit}
      >
        {({ errors, touched }) => (
          <Form className="space-y-6">
            <div>
              <label htmlFor="name" className="mb-2 block text-sm font-light text-[#e5e4e2]">
                Imię i nazwisko *
              </label>
              <Field
                type="text"
                id="name"
                name="name"
                onFocus={() => setFocusedField('name')}
                onBlur={() => setFocusedField(null)}
                className={`w-full rounded-xl border bg-[#1c1f33]/50 px-4 py-3 text-[#e5e4e2] placeholder-[#e5e4e2]/40 transition-all duration-300 focus:outline-none ${
                  focusedField === 'name'
                    ? 'scale-[1.02] border-[#d3bb73] shadow-lg shadow-[#d3bb73]/20'
                    : errors.name && touched.name
                      ? 'border-red-500/50'
                      : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                }`}
                placeholder="Jan Kowalski"
              />
              <ErrorMessage name="name" component="div" className="mt-1 text-sm text-red-400" />
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-light text-[#e5e4e2]">
                  Email *
                </label>
                <Field
                  type="email"
                  id="email"
                  name="email"
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                  className={`w-full rounded-xl border bg-[#1c1f33]/50 px-4 py-3 text-[#e5e4e2] placeholder-[#e5e4e2]/40 transition-all duration-300 focus:outline-none ${
                    focusedField === 'email'
                      ? 'scale-[1.02] border-[#d3bb73] shadow-lg shadow-[#d3bb73]/20'
                      : errors.email && touched.email
                        ? 'border-red-500/50'
                        : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                  }`}
                  placeholder="jan@przykład.pl"
                />
                <ErrorMessage name="email" component="div" className="mt-1 text-sm text-red-400" />
              </div>

              <div>
                <label htmlFor="phone" className="mb-2 block text-sm font-light text-[#e5e4e2]">
                  Telefon
                </label>
                <Field
                  type="tel"
                  id="phone"
                  name="phone"
                  onFocus={() => setFocusedField('phone')}
                  onBlur={() => setFocusedField(null)}
                  className={`w-full rounded-xl border bg-[#1c1f33]/50 px-4 py-3 text-[#e5e4e2] placeholder-[#e5e4e2]/40 transition-all duration-300 focus:outline-none ${
                    focusedField === 'phone'
                      ? 'scale-[1.02] border-[#d3bb73] shadow-lg shadow-[#d3bb73]/20'
                      : errors.phone && touched.phone
                        ? 'border-red-500/50'
                        : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                  }`}
                  placeholder="+48 123 456 789"
                />
                <ErrorMessage name="phone" component="div" className="mt-1 text-sm text-red-400" />
              </div>
            </div>

            {category === 'team_join' && (
              <>
                <div>
                  <label htmlFor="company" className="mb-2 block text-sm font-light text-[#e5e4e2]">
                    Obecna firma (opcjonalnie)
                  </label>
                  <Field
                    type="text"
                    id="company"
                    name="company"
                    onFocus={() => setFocusedField('company')}
                    onBlur={() => setFocusedField(null)}
                    className={`w-full rounded-xl border bg-[#1c1f33]/50 px-4 py-3 text-[#e5e4e2] placeholder-[#e5e4e2]/40 transition-all duration-300 focus:outline-none ${
                      focusedField === 'company'
                        ? 'scale-[1.02] border-[#d3bb73] shadow-lg shadow-[#d3bb73]/20'
                        : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                    }`}
                    placeholder="Nazwa firmy"
                  />
                </div>

                {/* CV Upload Field - handled outside Formik */}
                <div>
                  <label className="mb-2 block text-sm font-light text-[#e5e4e2]">
                    CV / Portfolio (opcjonalnie)
                  </label>
                  <div className="relative">
                    <input
                      type="file"
                      id="cvFileUpload"
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          if (file.size > 10 * 1024 * 1024) {
                            showAlert(
                              'Plik jest zbyt duży. Maksymalny rozmiar to 10MB.',
                              'Plik zbyt duży',
                              'warning',
                            );
                            e.target.value = '';
                            return;
                          }
                        }
                      }}
                      className="w-full rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]/50 px-4 py-3 text-sm text-[#e5e4e2] transition-all duration-300 file:mr-4 file:cursor-pointer file:rounded-full file:border-0 file:bg-[#d3bb73] file:px-4 file:py-2 file:text-sm file:font-medium file:text-[#1c1f33] hover:file:bg-[#d3bb73]/90 focus:border-[#d3bb73] focus:outline-none"
                    />
                  </div>
                  <p className="mt-1 text-xs text-[#e5e4e2]/50">
                    Prześlij swoje CV lub portfolio. Akceptujemy pliki PDF, DOC, DOCX, JPG, PNG (max
                    10MB)
                  </p>
                </div>
              </>
            )}

            {(category === 'general' || category === 'event_inquiry') && (
              <div>
                <label htmlFor="eventType" className="mb-2 block text-sm font-light text-[#e5e4e2]">
                  {category === 'event_inquiry' ? 'Typ eventu *' : 'Typ eventu'}
                </label>
                <Field
                  as="select"
                  id="eventType"
                  name="eventType"
                  onFocus={() => setFocusedField('eventType')}
                  onBlur={() => setFocusedField(null)}
                  className={`w-full rounded-xl border bg-[#1c1f33]/50 px-4 py-3 text-[#e5e4e2] transition-all duration-300 focus:outline-none ${
                    focusedField === 'eventType'
                      ? 'scale-[1.02] border-[#d3bb73] shadow-lg shadow-[#d3bb73]/20'
                      : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                  }`}
                >
                  <option value="">Wybierz typ eventu</option>
                  <option value="conference">Konferencja</option>
                  <option value="gala">Gala</option>
                  <option value="corporate">Event Korporacyjny</option>
                  <option value="trade">Targi</option>
                  <option value="team">Team Building</option>
                  <option value="integration">Integracja</option>
                  <option value="other">Inne</option>
                </Field>
              </div>
            )}

            {(category === 'general' ||
              category === 'event_inquiry' ||
              category === 'services') && (
              <div>
                <label htmlFor="company" className="mb-2 block text-sm font-light text-[#e5e4e2]">
                  Nazwa firmy (opcjonalnie)
                </label>
                <Field
                  type="text"
                  id="company"
                  name="company"
                  onFocus={() => setFocusedField('company')}
                  onBlur={() => setFocusedField(null)}
                  className={`w-full rounded-xl border bg-[#1c1f33]/50 px-4 py-3 text-[#e5e4e2] placeholder-[#e5e4e2]/40 transition-all duration-300 focus:outline-none ${
                    focusedField === 'company'
                      ? 'scale-[1.02] border-[#d3bb73] shadow-lg shadow-[#d3bb73]/20'
                      : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                  }`}
                  placeholder="Nazwa firmy"
                />
              </div>
            )}

            <div>
              <label htmlFor="message" className="mb-2 block text-sm font-light text-[#e5e4e2]">
                Wiadomość *
              </label>
              <Field
                as="textarea"
                id="message"
                name="message"
                rows={5}
                onFocus={() => setFocusedField('message')}
                onBlur={() => setFocusedField(null)}
                className={`w-full resize-none rounded-xl border bg-[#1c1f33]/50 px-4 py-3 text-[#e5e4e2] placeholder-[#e5e4e2]/40 transition-all duration-300 focus:outline-none ${
                  focusedField === 'message'
                    ? 'scale-[1.02] border-[#d3bb73] shadow-lg shadow-[#d3bb73]/20'
                    : errors.message && touched.message
                      ? 'border-red-500/50'
                      : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                }`}
                placeholder={
                  category === 'team_join'
                    ? 'Opowiedz nam o swoim doświadczeniu i dlaczego chcesz dołączyć do naszego zespołu...'
                    : category === 'event_inquiry'
                      ? 'Opisz swój event: data, liczba gości, lokalizacja, wymagania...'
                      : 'Napisz swoją wiadomość...'
                }
              />
              <ErrorMessage name="message" component="div" className="mt-1 text-sm text-red-400" />
            </div>

            {isSuccess && (
              <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-400">
                Dziękujemy! Twoja wiadomość została wysłana. Skontaktujemy się wkrótce.
              </div>
            )}

            {isError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
                Wystąpił błąd podczas wysyłania wiadomości. Spróbuj ponownie.
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="group flex w-full items-center justify-center gap-2 rounded-full bg-[#d3bb73] px-8 py-4 font-medium text-[#1c1f33] transition-all duration-300 hover:scale-105 hover:bg-[#d3bb73]/90 hover:shadow-lg hover:shadow-[#d3bb73]/40 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {isLoading ? 'Wysyłanie...' : 'Wyślij Wiadomość'}
              <Send className="h-5 w-5 transition-transform duration-300 group-hover:-translate-y-1 group-hover:translate-x-1" />
            </button>
          </Form>
        )}
      </Formik>
    </div>
  );
}
