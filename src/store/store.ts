import { configureStore } from '@reduxjs/toolkit';
import { api } from './api/api';
import { eventsApi } from './api/eventsApi';
import authReducer from './slices/authSlice';
import contactsReducer from './slices/contactsSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    contacts: contactsReducer,
    [api.reducerPath]: api.reducer,
    [eventsApi.reducerPath]: eventsApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .concat(api.middleware)
      .concat(eventsApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
