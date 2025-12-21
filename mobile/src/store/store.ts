import { configureStore } from '@reduxjs/toolkit';
import { calendarApi } from '../../../src/store/api/calendarApi';
import { tasksApi } from '../../../src/store/api/tasksApi';

export const store = configureStore({
  reducer: {
    [calendarApi.reducerPath]: calendarApi.reducer,
    [tasksApi.reducerPath]: tasksApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .concat(calendarApi.middleware)
      .concat(tasksApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
