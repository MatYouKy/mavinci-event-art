import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';


export interface TaskListItem {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: string;
  board_column: string;
  order_index: number;
  due_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  thumbnail_url: string | null;
  currently_working_by: string | null;
  currently_working_employee?: {
    name: string;
    surname: string;
    avatar_url: string | null;
    avatar_metadata?: any;
  } | null;
  task_assignees: {
    employee_id: string;
    employees: {
      name: string;
      surname: string;
      avatar_url: string | null;
      avatar_metadata?: any;
    };
  }[];
  comments_count?: number;
}

export interface TaskDetail extends TaskListItem {
  event_id: string | null;
  is_private: boolean;
  creator?: {
    name: string;
    surname: string;
    avatar_url: string | null;
    avatar_metadata?: any;
  };
  comments: {
    id: string;
    task_id: string;
    employee_id: string;
    content: string;
    created_at: string;
    employees: {
      name: string;
      surname: string;
      avatar_url: string | null;
      avatar_metadata?: any;
    };
  }[];
  attachments: {
    id: string;
    task_id: string;
    event_file_id: string | null;
    is_linked: boolean;
    file_name: string;
    file_url: string | null;
    file_type: string;
    file_size: number;
    uploaded_by: string;
    created_at: string;
    employees: {
      name: string;
      surname: string;
      avatar_url: string | null;
      avatar_metadata?: any;
    };
  }[];
}

export const tasksApi = createApi({
  reducerPath: 'tasksApi',
  baseQuery: fetchBaseQuery({
    baseUrl: '/api',
    credentials: 'include',
  }),
  tagTypes: ['TasksList', 'TaskDetail', 'TaskComments', 'TaskAttachments'],
  keepUnusedDataFor: 300,
  endpoints: (builder) => ({
    getTasksList: builder.query<TaskListItem[], void>({
      query: () => ({ url: 'tasks', method: 'GET' }),
      providesTags: (result) =>
        result
          ? [
              ...result.map((task: TaskListItem) => ({ type: 'TasksList' as const, id: task.id })),
              { type: 'TasksList', id: 'LIST' },
            ]
          : [{ type: 'TasksList', id: 'LIST' }],
    }),

    getTaskById: builder.query<TaskDetail, string>({
      query: (id) => ({ url: `tasks/${id}`, method: 'GET' }),
      providesTags: (_r, _e, id) => [{ type: 'TaskDetail', id }],
    }),

    createTask: builder.mutation<TaskListItem, any>({
      query: (body) => ({ url: 'tasks', method: 'POST', body }),
      invalidatesTags: [{ type: 'TasksList', id: 'LIST' }],
    }),

    updateTask: builder.mutation<void, { id: string } & Record<string, any>>({
      query: ({ id, ...body }) => ({ url: `tasks/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, { id }) => [
        { type: 'TasksList', id: 'LIST' },
        { type: 'TaskDetail', id },
      ],
    }),

    deleteTask: builder.mutation<void, string>({
      query: (id) => ({ url: `tasks/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => [
        { type: 'TasksList', id: 'LIST' },
        { type: 'TaskDetail', id },
      ],
    }),

    addComment: builder.mutation<
      any,
      { task_id: string; employee_id: string; content: string }
    >({
      query: ({ task_id, ...body }) => ({
        url: `tasks/${task_id}/comments`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_r, _e, { task_id }) => [
        { type: 'TaskDetail', id: task_id },
        { type: 'TaskComments', id: task_id },
      ],
    }),

    deleteComment: builder.mutation<void, { commentId: string; taskId: string }>({
      query: ({ commentId, taskId }) => ({
        url: `tasks/${taskId}/comments/${commentId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (_r, _e, { taskId }) => [
        { type: 'TaskDetail', id: taskId },
        { type: 'TaskComments', id: taskId },
      ],
    }),

    deleteAttachment: builder.mutation<
      void,
      { attachmentId: string; taskId: string; fileUrl: string | null; isLinked: boolean }
    >({
      query: ({ attachmentId, taskId, fileUrl, isLinked }) => {
        const params = new URLSearchParams();
        if (fileUrl) params.set('fileUrl', fileUrl);
        params.set('isLinked', isLinked.toString());
        return {
          url: `tasks/${taskId}/attachments/${attachmentId}?${params.toString()}`,
          method: 'DELETE',
        };
      },
      invalidatesTags: (_r, _e, { taskId }) => [
        { type: 'TaskDetail', id: taskId },
        { type: 'TaskAttachments', id: taskId },
      ],
    }),
  }),
});

export const {
  useGetTasksListQuery,
  useGetTaskByIdQuery,
  useCreateTaskMutation,
  useUpdateTaskMutation,
  useDeleteTaskMutation,
  useLazyGetTasksListQuery,
  useLazyGetTaskByIdQuery,
  useAddCommentMutation,
  useDeleteCommentMutation,
  useDeleteAttachmentMutation,
} = tasksApi;
