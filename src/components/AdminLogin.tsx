'use client';

import { useState } from 'react';
import { Lock, Mail } from 'lucide-react';
import { Formik, Form } from 'formik';
import * as Yup from 'yup';
import { useRouter } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';
import { FormInput } from './formik/FormInput';

const validationSchema = Yup.object({
  user_email: Yup.string()
    .email('Nieprawidłowy email')
    .required('Email jest wymagany'),
  user_password: Yup.string()
    .min(6, 'Minimum 6 znaków')
    .required('Hasło jest wymagane'),
});

export default function AdminLogin() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (values: { user_email: string; user_password: string }) => {
    try {
      setIsLoading(true);
      setErrorMessage('');

      const { error } = await signIn(values.user_email, values.user_password);

      if (error) {
        setErrorMessage(error.message || 'Nieprawidłowy email lub hasło');
      } else {
        router.push('/admin/dashboard');
      }
    } catch (err: any) {
      setErrorMessage('Wystąpił błąd podczas logowania');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1c1f33] flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-2xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#d3bb73]/10 mb-4">
              <Lock className="w-8 h-8 text-[#d3bb73]" />
            </div>
            <h2 className="text-3xl font-light text-[#e5e4e2] mb-2">Panel Administracyjny</h2>
            <p className="text-[#e5e4e2]/60 font-light">Zaloguj się aby zarządzać treścią</p>
          </div>

          <Formik
            initialValues={{ user_email: '', user_password: '' }}
            validationSchema={validationSchema}
            onSubmit={handleSubmit}
          >
            {() => (
              <Form className="space-y-6">
                <div>
                  <label htmlFor="user_email" className="block text-sm font-light text-[#e5e4e2] mb-2">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#d3bb73]/60 z-10" />
                    <div className="pl-10">
                      <FormInput
                        name="user_email"
                        type="email"
                        placeholder="admin@example.com"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label htmlFor="user_password" className="block text-sm font-light text-[#e5e4e2] mb-2">
                    Hasło
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#d3bb73]/60 z-10" />
                    <div className="pl-10">
                      <FormInput
                        name="user_password"
                        type="password"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>
                </div>

                {errorMessage && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <p className="text-red-400 text-sm text-center">{errorMessage}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? 'Logowanie...' : 'Zaloguj się'}
                </button>
              </Form>
            )}
          </Formik>
        </div>
      </div>
    </div>
  );
}
