'use client';

import { useState } from 'react';
import { Lock, Mail } from 'lucide-react';
import { Formik, Form } from 'formik';
import * as Yup from 'yup';
import { useRouter } from 'next/navigation';
import { useLoginUserMutation } from '../store/api/api';
import { useAppDispatch } from '../store/hooks';
import { setCredentials } from '../store/slices/authSlice';
import { FormInput } from './formik/FormInput';

const validationSchema = Yup.object({
  user_email: Yup.string().email('Nieprawidłowy email').required('Email jest wymagany'),
  user_password: Yup.string().min(6, 'Minimum 6 znaków').required('Hasło jest wymagane'),
});

export default function AdminLogin() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const [loginUser, { isLoading, error }] = useLoginUserMutation();
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (values: { user_email: string; user_password: string }) => {
    try {
      setErrorMessage('');
      const data = await loginUser(values).unwrap();
      dispatch(setCredentials(data));
      router.push('/admin/dashboard');
    } catch (err: any) {
      setErrorMessage(err?.data?.message || 'Nieprawidłowy email lub hasło');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1c1f33] px-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] p-8 shadow-2xl">
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#d3bb73]/10">
              <Lock className="h-8 w-8 text-[#d3bb73]" />
            </div>
            <h2 className="mb-2 text-3xl font-light text-[#e5e4e2]">Panel Administracyjny</h2>
            <p className="font-light text-[#e5e4e2]/60">Zaloguj się aby zarządzać treścią</p>
          </div>

          <Formik
            initialValues={{ user_email: '', user_password: '' }}
            validationSchema={validationSchema}
            onSubmit={handleSubmit}
          >
            {() => (
              <Form className="space-y-6">
                <div>
                  <label
                    htmlFor="user_email"
                    className="mb-2 block text-sm font-light text-[#e5e4e2]"
                  >
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-[#d3bb73]/60" />
                    <div className="pl-10">
                      <FormInput name="user_email" type="email" placeholder="admin@example.com" />
                    </div>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="user_password"
                    className="mb-2 block text-sm font-light text-[#e5e4e2]"
                  >
                    Hasło
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-[#d3bb73]/60" />
                    <div className="pl-10">
                      <FormInput name="user_password" type="password" placeholder="••••••••" />
                    </div>
                  </div>
                </div>

                {errorMessage && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                    <p className="text-center text-sm text-red-400">{errorMessage}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full rounded-lg bg-[#d3bb73] py-3 font-medium text-[#1c1f33] transition-all duration-300 hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
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
