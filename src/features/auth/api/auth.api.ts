// src/features/auth/api/auth.api.ts
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import {
  ISnackbar,
  LoginPayload,
  LoginResponse,
  ResetPasswordPayload,
  BasicResponse,
} from '../auth.types';
console.log('process.env.NEXT_PUBLIC_SERVER_URL', process.env.NEXT_PUBLIC_SERVER_URL);

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: `${process.env.NEXT_PUBLIC_SERVER_URL}/api`,
    prepareHeaders: (headers, { getState }) => {
      const token = (getState() as any).auth?.token;
      if (token) headers.set('authorization', `Bearer ${token}`);
      return headers;
    },
  }),
  endpoints: (builder) => ({
    loginUser: builder.mutation<LoginResponse, LoginPayload>({
      query: (body) => ({
        url: '/users/auth/login',
        method: 'POST',
        body,
      }),
    }),

    signupUser: builder.mutation<LoginResponse, FormData>({
      query: (formData) => ({
        url: '/users/auth/signup',
        method: 'POST',
        body: formData,
      }),
    }),

    confirmRegistration: builder.query<ISnackbar, string>({
      query: (token) => ({
        url: `/users/auth/confirm?token=${token}`,
        method: 'GET',
      }),
    }),

    // ✉️ wyślij mail resetujący
    recoverPassword: builder.mutation<BasicResponse, { user_email: string }>({
      query: (body) => ({
        url: '/users/auth/recover',
        method: 'POST',
        body,
      }),
    }),

    // 🔒 ustaw nowe hasło na podstawie tokenu
    resetPassword: builder.mutation<BasicResponse, ResetPasswordPayload>({
      query: (body) => ({
        url: '/users/auth/reset-password',
        method: 'POST',
        body,
      }),
    }),
  }),
});

export const {
  useLoginUserMutation,
  useSignupUserMutation,
  useConfirmRegistrationQuery,
  useRecoverPasswordMutation, // NEW
  useResetPasswordMutation,   // NEW
} = api;