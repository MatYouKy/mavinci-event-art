import { configureStore } from '@reduxjs/toolkit';
import { api } from './api/api';
import { eventsApi } from '../app/crm/events/store/api/eventsApi';
import { analyticsApi } from './api/analyticsApi';
import { tasksApi } from './api/tasksApi';
import authReducer from './slices/authSlice';
import contactsReducer from './slices/contactsSlice';
import equipmentReducer from './slices/equipmentSlice';
import { equipmentApi } from '@/app/crm/equipment/store/equipmentApi';
import customIconsReducer from './slices/customIconSlice';
import { offerWizardApi } from '@/app/crm/offers/api/OfferWizzardApi';
import offerWizardReducer from '@/app/crm/offers/store/OfferWizzardSlice';
import { eventCategoriesApi } from '@/app/crm/event-categories/store/eventCategoriesApi';
import { clientsApi } from '@/app/crm/contacts/store/clientsApi';
import { locationsApi } from '@/app/crm/locations/locationsApi';
import { employeesApi } from '@/app/crm/employees/store/employeeApi';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    contacts: contactsReducer,
    equipment: equipmentReducer,
    customIcons: customIconsReducer,
    offerWizard: offerWizardReducer,
    [api.reducerPath]: api.reducer,
    [eventCategoriesApi.reducerPath]: eventCategoriesApi.reducer,
    [eventsApi.reducerPath]: eventsApi.reducer,
    [offerWizardApi.reducerPath]: offerWizardApi.reducer,
    [equipmentApi.reducerPath]: equipmentApi.reducer,
    [analyticsApi.reducerPath]: analyticsApi.reducer,
    [clientsApi.reducerPath]: clientsApi.reducer,
    [locationsApi.reducerPath]: locationsApi.reducer,
    [employeesApi.reducerPath]: employeesApi.reducer,
    [tasksApi.reducerPath]: tasksApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .concat(api.middleware)
      .concat(eventCategoriesApi.middleware)
      .concat(eventsApi.middleware)
      .concat(offerWizardApi.middleware)
      .concat(equipmentApi.middleware)
      .concat(analyticsApi.middleware)
      .concat(clientsApi.middleware)
      .concat(locationsApi.middleware)
      .concat(employeesApi.middleware)
      .concat(tasksApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
