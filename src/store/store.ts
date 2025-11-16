import { configureStore } from '@reduxjs/toolkit';
import { api } from './api/api';
import { eventsApi } from './api/eventsApi';
import { analyticsApi } from './api/analyticsApi';
import authReducer from './slices/authSlice';
import contactsReducer from './slices/contactsSlice';
import equipmentReducer from './slices/equipmentSlice';
import { equipmentApi } from '@/app/crm/equipment/store/equipmentApi';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    contacts: contactsReducer,
    equipment: equipmentReducer,
    [api.reducerPath]: api.reducer,
    [eventsApi.reducerPath]: eventsApi.reducer,
    [equipmentApi.reducerPath]: equipmentApi.reducer,
    [analyticsApi.reducerPath]: analyticsApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .concat(api.middleware)
      .concat(eventsApi.middleware)
      .concat(equipmentApi.middleware)
      .concat(analyticsApi.middleware)
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
