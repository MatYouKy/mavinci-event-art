import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { LoginPayload, LoginResponse, ISnackbar } from '../../types/auth.types';
import { TeamMember, PortfolioProject } from '../../lib/supabase';

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: process.env.NEXT_PUBLIC_API_URL,
    prepareHeaders: (headers, { getState }) => {
      const token = (getState() as any).auth?.user_token;
      if (token) {
        headers.set('authorization', `Bearer ${token}`);
      }
      return headers;
    },
  }),
  tagTypes: ['TeamMembers', 'PortfolioProjects'],
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
    getTeamMembers: builder.query<TeamMember[], void>({
      query: () => '/team-members',
      providesTags: ['TeamMembers'],
    }),
    addTeamMember: builder.mutation<TeamMember, Partial<TeamMember>>({
      query: (body) => ({
        url: '/team-members',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['TeamMembers'],
    }),
    updateTeamMember: builder.mutation<TeamMember, { id: string; data: Partial<TeamMember> }>({
      query: ({ id, data }) => ({
        url: `/team-members/${id}`,
        method: 'PUT',
        body: data,
      }),
      invalidatesTags: ['TeamMembers'],
    }),
    deleteTeamMember: builder.mutation<void, string>({
      query: (id) => ({
        url: `/team-members/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['TeamMembers'],
    }),
    getPortfolioProjects: builder.query<PortfolioProject[], void>({
      query: () => '/portfolio-projects',
      providesTags: ['PortfolioProjects'],
    }),
    addPortfolioProject: builder.mutation<PortfolioProject, Partial<PortfolioProject>>({
      query: (body) => ({
        url: '/portfolio-projects',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['PortfolioProjects'],
    }),
    updatePortfolioProject: builder.mutation<
      PortfolioProject,
      { id: string; data: Partial<PortfolioProject> }
    >({
      query: ({ id, data }) => ({
        url: `/portfolio-projects/${id}`,
        method: 'PUT',
        body: data,
      }),
      invalidatesTags: ['PortfolioProjects'],
    }),
    deletePortfolioProject: builder.mutation<void, string>({
      query: (id) => ({
        url: `/portfolio-projects/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['PortfolioProjects'],
    }),
    uploadImage: builder.mutation<{ url: string }, FormData>({
      query: (formData) => ({
        url: '/upload/image',
        method: 'POST',
        body: formData,
      }),
    }),
  }),
});

export const {
  useLoginUserMutation,
  useSignupUserMutation,
  useConfirmRegistrationQuery,
  useGetTeamMembersQuery,
  useAddTeamMemberMutation,
  useUpdateTeamMemberMutation,
  useDeleteTeamMemberMutation,
  useGetPortfolioProjectsQuery,
  useAddPortfolioProjectMutation,
  useUpdatePortfolioProjectMutation,
  useDeletePortfolioProjectMutation,
  useUploadImageMutation,
} = api;
