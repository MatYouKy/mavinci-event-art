import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { supabase } from '@/lib/supabase';

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
  baseQuery: fakeBaseQuery(),
  tagTypes: ['TasksList', 'TaskDetail', 'TaskComments', 'TaskAttachments'],
  keepUnusedDataFor: 300,
  endpoints: (builder) => ({
    getTasksList: builder.query<TaskListItem[], void>({
      async queryFn() {
        try {
          const { data: tasks, error } = await supabase
            .from('tasks')
            .select(`
              id,
              title,
              description,
              priority,
              status,
              board_column,
              order_index,
              due_date,
              created_by,
              created_at,
              updated_at,
              thumbnail_url,
              currently_working_by
            `)
            .eq('is_private', false)
            .is('event_id', null);

          if (error) return { error: error as any };

          const tasksWithDetails = await Promise.all(
            (tasks || []).map(async (task) => {
              const [assigneesResult, workingEmployeeResult, commentsCountResult] = await Promise.all([
                supabase
                  .from('task_assignees')
                  .select(`
                    employee_id,
                    employees:employees(
                      name,
                      surname,
                      avatar_url,
                      avatar_metadata
                    )
                  `)
                  .eq('task_id', task.id),

                task.currently_working_by
                  ? supabase
                      .from('employees')
                      .select('name, surname, avatar_url, avatar_metadata')
                      .eq('id', task.currently_working_by)
                      .maybeSingle()
                  : Promise.resolve({ data: null }),

                supabase
                  .from('task_comments')
                  .select('*', { count: 'exact', head: true })
                  .eq('task_id', task.id)
              ]);

              return {
                ...task,
                task_assignees: assigneesResult.data || [],
                currently_working_employee: workingEmployeeResult.data,
                comments_count: commentsCountResult.count || 0,
              } as TaskListItem;
            })
          );

          const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
          const sortedTasks = tasksWithDetails.sort((a, b) => {
            const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
            if (priorityDiff !== 0) return priorityDiff;

            if (a.due_date && b.due_date) {
              return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
            }
            if (a.due_date) return -1;
            if (b.due_date) return 1;

            return a.order_index - b.order_index;
          });

          return { data: sortedTasks };
        } catch (error: any) {
          return { error: { status: 'CUSTOM_ERROR', error: error.message } };
        }
      },
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: 'TasksList' as const, id })),
              { type: 'TasksList', id: 'LIST' },
            ]
          : [{ type: 'TasksList', id: 'LIST' }],
    }),

    getTaskById: builder.query<TaskDetail, string>({
      async queryFn(taskId) {
        try {
          const { data: task, error } = await supabase
            .from('tasks')
            .select('*')
            .eq('id', taskId)
            .maybeSingle();

          if (error) return { error: error as any };
          if (!task) return { error: { status: 404, data: 'Task not found' } };

          const [assigneesResult, creatorResult, commentsResult, attachmentsResult, workingEmployeeResult] = await Promise.all([
            supabase
              .from('task_assignees')
              .select(`
                employee_id,
                employees:employees(
                  name,
                  surname,
                  avatar_url,
                  avatar_metadata
                )
              `)
              .eq('task_id', taskId),

            task.created_by
              ? supabase
                  .from('employees')
                  .select('name, surname, avatar_url, avatar_metadata')
                  .eq('id', task.created_by)
                  .maybeSingle()
              : Promise.resolve({ data: null }),

            supabase
              .from('task_comments')
              .select(`
                id,
                task_id,
                employee_id,
                content,
                created_at,
                employees:employees(
                  name,
                  surname,
                  avatar_url,
                  avatar_metadata
                )
              `)
              .eq('task_id', taskId)
              .order('created_at', { ascending: true }),

            supabase
              .from('task_attachments')
              .select(`
                id,
                task_id,
                event_file_id,
                is_linked,
                file_name,
                file_url,
                file_type,
                file_size,
                uploaded_by,
                created_at,
                employees:employees(
                  name,
                  surname,
                  avatar_url,
                  avatar_metadata
                )
              `)
              .eq('task_id', taskId)
              .order('created_at', { ascending: false }),

            task.currently_working_by
              ? supabase
                  .from('employees')
                  .select('name, surname, avatar_url, avatar_metadata')
                  .eq('id', task.currently_working_by)
                  .maybeSingle()
              : Promise.resolve({ data: null })
          ]);

          const taskDetail: TaskDetail = {
            ...task,
            task_assignees: assigneesResult.data || [],
            creator: creatorResult.data,
            comments: commentsResult.data || [],
            attachments: attachmentsResult.data || [],
            currently_working_employee: workingEmployeeResult.data,
            comments_count: commentsResult.data?.length || 0,
          };

          return { data: taskDetail };
        } catch (error: any) {
          return { error: { status: 'CUSTOM_ERROR', error: error.message } };
        }
      },
      providesTags: (result, error, id) => [{ type: 'TaskDetail', id }],
    }),

    createTask: builder.mutation<
      TaskListItem,
      {
        title: string;
        description?: string | null;
        priority: 'low' | 'medium' | 'high' | 'urgent';
        board_column: string;
        due_date?: string | null;
        assigned_employees: string[];
        created_by?: string;
      }
    >({
      async queryFn(taskData) {
        try {
          const { data: task, error } = await supabase
            .from('tasks')
            .insert({
              title: taskData.title,
              description: taskData.description || null,
              priority: taskData.priority,
              board_column: taskData.board_column,
              due_date: taskData.due_date || null,
              status: 'todo',
              is_private: false,
              event_id: null,
              owner_id: null,
              created_by: taskData.created_by,
            })
            .select()
            .single();

          if (error) return { error: error as any };

          if (taskData.assigned_employees.length > 0) {
            const assignees = taskData.assigned_employees.map((employee_id) => ({
              task_id: task.id,
              employee_id,
              assigned_by: taskData.created_by,
            }));

            const { error: assignError } = await supabase
              .from('task_assignees')
              .insert(assignees);

            if (assignError) return { error: assignError as any };
          }

          return { data: { ...task, task_assignees: [], comments_count: 0 } };
        } catch (error: any) {
          return { error: { status: 'CUSTOM_ERROR', error: error.message } };
        }
      },
      invalidatesTags: [{ type: 'TasksList', id: 'LIST' }],
    }),

    updateTask: builder.mutation<
      void,
      {
        id: string;
        title?: string;
        description?: string | null;
        priority?: 'low' | 'medium' | 'high' | 'urgent';
        board_column?: string;
        due_date?: string | null;
        currently_working_by?: string | null;
        assigned_employees?: string[];
        assigned_by?: string;
      }
    >({
      async queryFn({ id, assigned_employees, assigned_by, ...updates }) {
        try {
          if (Object.keys(updates).length > 0) {
            const { error } = await supabase
              .from('tasks')
              .update(updates)
              .eq('id', id);

            if (error) return { error: error as any };
          }

          if (assigned_employees !== undefined) {
            await supabase.from('task_assignees').delete().eq('task_id', id);

            if (assigned_employees.length > 0) {
              const assignees = assigned_employees.map((employee_id) => ({
                task_id: id,
                employee_id,
                assigned_by,
              }));

              const { error: assignError } = await supabase
                .from('task_assignees')
                .insert(assignees);

              if (assignError) return { error: assignError as any };
            }
          }

          return { data: undefined };
        } catch (error: any) {
          return { error: { status: 'CUSTOM_ERROR', error: error.message } };
        }
      },
      invalidatesTags: (result, error, { id }) => [
        { type: 'TasksList', id: 'LIST' },
        { type: 'TaskDetail', id },
      ],
    }),

    deleteTask: builder.mutation<void, string>({
      async queryFn(taskId) {
        try {
          const { error } = await supabase
            .from('tasks')
            .delete()
            .eq('id', taskId);

          if (error) return { error: error as any };

          return { data: undefined };
        } catch (error: any) {
          return { error: { status: 'CUSTOM_ERROR', error: error.message } };
        }
      },
      invalidatesTags: (result, error, id) => [
        { type: 'TasksList', id: 'LIST' },
        { type: 'TaskDetail', id },
      ],
    }),

    addComment: builder.mutation<void, { task_id: string; employee_id: string; content: string }>({
      async queryFn(commentData) {
        try {
          const { error } = await supabase
            .from('task_comments')
            .insert(commentData);

          if (error) return { error: error as any };

          return { data: undefined };
        } catch (error: any) {
          return { error: { status: 'CUSTOM_ERROR', error: error.message } };
        }
      },
      invalidatesTags: (result, error, { task_id }) => [
        { type: 'TaskDetail', id: task_id },
        { type: 'TaskComments', id: task_id },
      ],
    }),

    deleteComment: builder.mutation<void, { commentId: string; taskId: string }>({
      async queryFn({ commentId }) {
        try {
          const { error } = await supabase
            .from('task_comments')
            .delete()
            .eq('id', commentId);

          if (error) return { error: error as any };

          return { data: undefined };
        } catch (error: any) {
          return { error: { status: 'CUSTOM_ERROR', error: error.message } };
        }
      },
      invalidatesTags: (result, error, { taskId }) => [
        { type: 'TaskDetail', id: taskId },
        { type: 'TaskComments', id: taskId },
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
  useAddCommentMutation,
  useDeleteCommentMutation,
} = tasksApi;
