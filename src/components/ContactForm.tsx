'use client';

import { useState, useEffect } from 'react';
import { Formik, Form, Field, ErrorMessage } from 'formik';
import * as Yup from 'yup';
import { Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';

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
}

const validationSchema = Yup.object({
  name: Yup.string()
    .min(2, 'Imię musi mieć co najmniej 2 znaki')
    .required('Pole wymagane'),
  email: Yup.string()
    .email('Nieprawidłowy adres email')
    .required('Pole wymagane'),
  phone: Yup.string()
    .matches(/^[+]?[\d\s-()]+$/, 'Nieprawidłowy numer telefonu'),
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
  customDescription
}: ContactFormProps) {
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isError, setIsError] = useState(false);
  const [sourcePage, setSourcePage] = useState('/');

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
  };

  const handleSubmit = async (values: ContactFormData, { resetForm }: any) => {
    setIsLoading(true);
    setIsError(false);
    try {
      const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';

      const { error } = await supabase
        .from('contact_messages')
        .insert([
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
            priority: category === 'event_inquiry' ? 'high' : 'normal',
            user_agent: userAgent,
          }
        ]);

      if (error) throw error;

      setIsSuccess(true);
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
        <h3 className="text-2xl font-light text-[#e5e4e2] mb-2">{getFormTitle()}</h3>
        <p className="text-[#e5e4e2]/70 text-sm">{getFormDescription()}</p>
      </div>

      <Formik
        initialValues={initialValues}
        validationSchema={validationSchema}
        onSubmit={handleSubmit}
      >
        {({ errors, touched }) => (
          <Form className="space-y-6">
            <div>
              <label htmlFor="name" className="block text-[#e5e4e2] text-sm font-light mb-2">
                Imię i nazwisko *
              </label>
              <Field
                type="text"
                id="name"
                name="name"
                onFocus={() => setFocusedField('name')}
                onBlur={() => setFocusedField(null)}
                className={`w-full px-4 py-3 bg-[#1c1f33]/50 border rounded-xl text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none transition-all duration-300 ${
                  focusedField === 'name'
                    ? 'border-[#d3bb73] shadow-lg shadow-[#d3bb73]/20 scale-[1.02]'
                    : errors.name && touched.name
                    ? 'border-red-500/50'
                    : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                }`}
                placeholder="Jan Kowalski"
              />
              <ErrorMessage name="name" component="div" className="text-red-400 text-sm mt-1" />
            </div>

            <div className="grid sm:grid-cols-2 gap-6">
              <div>
                <label htmlFor="email" className="block text-[#e5e4e2] text-sm font-light mb-2">
                  Email *
                </label>
                <Field
                  type="email"
                  id="email"
                  name="email"
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                  className={`w-full px-4 py-3 bg-[#1c1f33]/50 border rounded-xl text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none transition-all duration-300 ${
                    focusedField === 'email'
                      ? 'border-[#d3bb73] shadow-lg shadow-[#d3bb73]/20 scale-[1.02]'
                      : errors.email && touched.email
                      ? 'border-red-500/50'
                      : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                  }`}
                  placeholder="jan@przykład.pl"
                />
                <ErrorMessage name="email" component="div" className="text-red-400 text-sm mt-1" />
              </div>

              <div>
                <label htmlFor="phone" className="block text-[#e5e4e2] text-sm font-light mb-2">
                  Telefon
                </label>
                <Field
                  type="tel"
                  id="phone"
                  name="phone"
                  onFocus={() => setFocusedField('phone')}
                  onBlur={() => setFocusedField(null)}
                  className={`w-full px-4 py-3 bg-[#1c1f33]/50 border rounded-xl text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none transition-all duration-300 ${
                    focusedField === 'phone'
                      ? 'border-[#d3bb73] shadow-lg shadow-[#d3bb73]/20 scale-[1.02]'
                      : errors.phone && touched.phone
                      ? 'border-red-500/50'
                      : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                  }`}
                  placeholder="+48 123 456 789"
                />
                <ErrorMessage name="phone" component="div" className="text-red-400 text-sm mt-1" />
              </div>
            </div>

            {category === 'team_join' && (
              <div>
                <label htmlFor="company" className="block text-[#e5e4e2] text-sm font-light mb-2">
                  Obecna firma (opcjonalnie)
                </label>
                <Field
                  type="text"
                  id="company"
                  name="company"
                  onFocus={() => setFocusedField('company')}
                  onBlur={() => setFocusedField(null)}
                  className={`w-full px-4 py-3 bg-[#1c1f33]/50 border rounded-xl text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none transition-all duration-300 ${
                    focusedField === 'company'
                      ? 'border-[#d3bb73] shadow-lg shadow-[#d3bb73]/20 scale-[1.02]'
                      : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                  }`}
                  placeholder="Nazwa firmy"
                />
              </div>
            )}

            {(category === 'general' || category === 'event_inquiry') && (
              <div>
                <label htmlFor="eventType" className="block text-[#e5e4e2] text-sm font-light mb-2">
                  {category === 'event_inquiry' ? 'Typ eventu *' : 'Typ eventu'}
                </label>
                <Field
                  as="select"
                  id="eventType"
                  name="eventType"
                  onFocus={() => setFocusedField('eventType')}
                  onBlur={() => setFocusedField(null)}
                  className={`w-full px-4 py-3 bg-[#1c1f33]/50 border rounded-xl text-[#e5e4e2] focus:outline-none transition-all duration-300 ${
                    focusedField === 'eventType'
                      ? 'border-[#d3bb73] shadow-lg shadow-[#d3bb73]/20 scale-[1.02]'
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

            {(category === 'general' || category === 'event_inquiry' || category === 'services') && (
              <div>
                <label htmlFor="company" className="block text-[#e5e4e2] text-sm font-light mb-2">
                  Nazwa firmy (opcjonalnie)
                </label>
                <Field
                  type="text"
                  id="company"
                  name="company"
                  onFocus={() => setFocusedField('company')}
                  onBlur={() => setFocusedField(null)}
                  className={`w-full px-4 py-3 bg-[#1c1f33]/50 border rounded-xl text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none transition-all duration-300 ${
                    focusedField === 'company'
                      ? 'border-[#d3bb73] shadow-lg shadow-[#d3bb73]/20 scale-[1.02]'
                      : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                  }`}
                  placeholder="Nazwa firmy"
                />
              </div>
            )}

            <div>
              <label htmlFor="message" className="block text-[#e5e4e2] text-sm font-light mb-2">
                Wiadomość *
              </label>
              <Field
                as="textarea"
                id="message"
                name="message"
                rows={5}
                onFocus={() => setFocusedField('message')}
                onBlur={() => setFocusedField(null)}
                className={`w-full px-4 py-3 bg-[#1c1f33]/50 border rounded-xl text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none resize-none transition-all duration-300 ${
                  focusedField === 'message'
                    ? 'border-[#d3bb73] shadow-lg shadow-[#d3bb73]/20 scale-[1.02]'
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
              <ErrorMessage name="message" component="div" className="text-red-400 text-sm mt-1" />
            </div>

            {isSuccess && (
              <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-xl text-green-400 text-sm">
                Dziękujemy! Twoja wiadomość została wysłana. Skontaktujemy się wkrótce.
              </div>
            )}

            {isError && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
                Wystąpił błąd podczas wysyłania wiadomości. Spróbuj ponownie.
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="group w-full sm:w-auto px-8 py-4 bg-[#d3bb73] text-[#1c1f33] rounded-full font-medium hover:bg-[#d3bb73]/90 transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-[#d3bb73]/40 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Wysyłanie...' : 'Wyślij Wiadomość'}
              <Send className="w-5 h-5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform duration-300" />
            </button>
          </Form>
        )}
      </Formik>
    </div>
  );
}
