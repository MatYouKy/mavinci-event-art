import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface UnifiedContact {
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
}

interface ContactsState {
  contacts: UnifiedContact[];
  loading: boolean;
  lastFetched: number | null;
  cacheTimeout: number;
}

const initialState: ContactsState = {
  contacts: [],
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
  },
});

export const {
  setContacts,
  setLoading,
  clearContacts,
  updateContact,
  addContact,
  removeContact,
} = contactsSlice.actions;

export const selectContacts = (state: { contacts: ContactsState }) => state.contacts.contacts;
export const selectContactsLoading = (state: { contacts: ContactsState }) => state.contacts.loading;
export const selectShouldRefetch = (state: { contacts: ContactsState }) => {
  const { lastFetched, cacheTimeout } = state.contacts;
  if (!lastFetched) return true;
  return Date.now() - lastFetched > cacheTimeout;
};

export default contactsSlice.reducer;
