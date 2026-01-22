import { configureStore, combineReducers } from '@reduxjs/toolkit';

import { api } from './api/api';
import { eventsApi } from '../app/(crm)/crm/events/store/api/eventsApi';
import { analyticsApi } from './api/analyticsApi';
import { tasksApi } from './api/tasksApi';
import { calendarApi } from './api/calendarApi';
import { equipmentApi } from '@/app/(crm)/crm/equipment/store/equipmentApi';
import { offerWizardApi } from '@/app/(crm)/crm/offers/api/OfferWizzardApi';
import { eventCategoriesApi } from '@/app/(crm)/crm/event-categories/store/eventCategoriesApi';
import { clientsApi } from '@/app/(crm)/crm/contacts/store/clientsApi';
import { locationsApi } from '@/app/(crm)/crm/locations/locationsApi';
import { employeesApi } from '@/app/(crm)/crm/employees/store/employeeApi';
import { fleetApi } from '@/app/(crm)/crm/fleet/api/fleetApi';

import authReducer from './slices/authSlice';
import contactsReducer from './slices/contactsSlice';
import equipmentReducer from './slices/equipmentSlice';
import customIconsReducer from './slices/customIconSlice';
import offerWizardReducer from '@/app/(crm)/crm/offers/store/OfferWizzardSlice'; // <— UWAGA: u Ciebie to może być default export

export const rootReducer = combineReducers({
  auth: authReducer,
  contacts: contactsReducer,
  equipment: equipmentReducer,
  customIcons: customIconsReducer,
  offerWizard: offerWizardReducer as any,

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
  [calendarApi.reducerPath]: calendarApi.reducer,
  [fleetApi.reducerPath]: fleetApi.reducer,
});

export type RootState = ReturnType<typeof rootReducer>;

export const makeStore = (preloadedState?: Partial<RootState>) =>
  configureStore({
    reducer: rootReducer,
    preloadedState: preloadedState as any,
    middleware: (gDM) =>
      gDM({ serializableCheck: false })
        .concat(api.middleware)
        .concat(eventCategoriesApi.middleware)
        .concat(eventsApi.middleware)
        .concat(offerWizardApi.middleware)
        .concat(equipmentApi.middleware)
        .concat(analyticsApi.middleware)
        .concat(clientsApi.middleware)
        .concat(locationsApi.middleware)
        .concat(employeesApi.middleware)
        .concat(tasksApi.middleware)
        .concat(calendarApi.middleware)
        .concat(fleetApi.middleware),
  });

export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore['dispatch'];

export const store = makeStore();