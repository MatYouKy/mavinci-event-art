import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface UnifiedContact {
  nip: string;
  postal_code: string;
  address: string;
  pesel: string;
  last_name: string;
  first_name: string;
  full_name: any;
  id: string;
  type: 'organization' | 'contact' | 'individual';
  source: 'organizations' | 'contacts';
  name: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  city: string | null;
  status: string;
  rating: number | null;
  avatar_url: string | null;
  tags: string[] | null;
  created_at: string;
  contacts_count?: number;
  organizations_count?: number;
  full_data?: any;
}

interface ContactsState {
  contacts: UnifiedContact[];
  contactsDetails: Record<string, any>;
  relationsMap: Record<string, string[]>;
  notesMap: Record<string, any[]>;
  historyMap: Record<string, any[]>;
  loading: boolean;
  lastFetched: number | null;
  cacheTimeout: number;
}

const initialState: ContactsState = {
  contacts: [],
  contactsDetails: {},
  relationsMap: {},
  notesMap: {},
  historyMap: {},
  loading: false,
  lastFetched: null,
  cacheTimeout: 5 * 60 * 1000, // 5 minut
};

const contactsSlice = createSlice({
  name: 'contacts',
  initialState,
  reducers: {
    setContacts: (state, action: PayloadAction<UnifiedContact[]>) => {
      state.contacts = action.payload;
      state.lastFetched = Date.now();
      state.loading = false;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    clearContacts: (state) => {
      state.contacts = [];
      state.lastFetched = null;
    },
    updateContact: (state, action: PayloadAction<UnifiedContact>) => {
      const index = state.contacts.findIndex((c) => c.id === action.payload.id);
      if (index !== -1) {
        state.contacts[index] = action.payload;
      }
    },
    addContact: (state, action: PayloadAction<UnifiedContact>) => {
      state.contacts.unshift(action.payload);
    },
    removeContact: (state, action: PayloadAction<string>) => {
      state.contacts = state.contacts.filter((c) => c.id !== action.payload);
    },
    setContactDetails: (state, action: PayloadAction<{ id: string; data: any }>) => {
      state.contactsDetails[action.payload.id] = action.payload.data;
    },
    setContactNotes: (state, action: PayloadAction<{ id: string; notes: any[] }>) => {
      state.notesMap[action.payload.id] = action.payload.notes;
    },
    setContactHistory: (state, action: PayloadAction<{ id: string; history: any[] }>) => {
      state.historyMap[action.payload.id] = action.payload.history;
    },
    setContactRelations: (state, action: PayloadAction<{ id: string; relations: string[] }>) => {
      state.relationsMap[action.payload.id] = action.payload.relations;
    },
  },
});

export const {
  setContacts,
  setLoading,
  clearContacts,
  updateContact,
  addContact,
  removeContact,
  setContactDetails,
  setContactNotes,
  setContactHistory,
  setContactRelations,
} = contactsSlice.actions;

export const selectContacts = (state: { contacts: ContactsState }) => state.contacts.contacts;
export const selectContactsLoading = (state: { contacts: ContactsState }) => state.contacts.loading;
export const selectContactDetails = (id: string) => (state: { contacts: ContactsState }) =>
  state.contacts.contactsDetails[id];
export const selectContactNotes = (id: string) => (state: { contacts: ContactsState }) =>
  state.contacts.notesMap[id];
export const selectContactHistory = (id: string) => (state: { contacts: ContactsState }) =>
  state.contacts.historyMap[id];
export const selectContactRelations = (id: string) => (state: { contacts: ContactsState }) =>
  state.contacts.relationsMap[id];
export const selectShouldRefetch = (state: { contacts: ContactsState }) => {
  const { lastFetched, cacheTimeout } = state.contacts;
  if (!lastFetched) return true;
  return Date.now() - lastFetched > cacheTimeout;
};

export default contactsSlice.reducer;
