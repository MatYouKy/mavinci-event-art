# Fix: Automatic Refresh of Offers List After Create/Delete

## Problem
After creating or deleting an offer from the event detail page's Offer tab wizard (`crm/events/[id]`), the new offer didn't appear in the list until manual page refresh.

## Root Cause
1. **RTK Query cache invalidation was already implemented** in `useOfferWizzard.ts` (lines 222-228)
2. However, the query in `EventDetailPageClient.tsx` had `refetchOnMountOrArgChange: false` which prevented automatic refetch when cache was invalidated
3. The `handleDeleteOffer` function was using local state instead of the RTK Query mutation, so cache wasn't being invalidated on delete

## Solution

### 1. Enable Automatic Refetch on Cache Invalidation
**File**: `src/app/(crm)/crm/events/[id]/EventDetailPageClient.tsx`

**Changed** (line 436-438):
```typescript
const { data: offersData, isFetching: offersFetching } = useGetEventOffersQuery(eventId, {
  skip: !canViewCommercials,
  refetchOnMountOrArgChange: false,  // ❌ This prevented automatic refetch
});
```

**To**:
```typescript
const { data: offersData, isFetching: offersFetching } = useGetEventOffersQuery(eventId, {
  skip: !canViewCommercials,
  // ✅ Removed refetchOnMountOrArgChange: false to allow cache invalidation to trigger refetch
});
```

### 2. Replace Local State with RTK Query Data
**File**: `src/app/(crm)/crm/events/[id]/EventDetailPageClient.tsx`

**Removed**:
- `const [offers, setOffers] = useState<IOffer[]>(initialOffers || [])` (line 178)
- `useEffect` that synced `initialOffers` to local state (lines 179-181, 211-214)

**Updated all usages**:
- `offers` → `offersData` throughout the component
- `offers.find(...)` → `offersData?.find(...)`
- `offers?.length` → `offersData?.length`

### 3. Implement Proper Delete Mutation
**File**: `src/app/(crm)/crm/events/[id]/EventDetailPageClient.tsx`

**Added import** (line 58):
```typescript
import {
  useGetEventOffersQuery,
  useUpdateEventMutation,
  useDeleteEventOfferMutation,  // ✅ Added
} from '../store/api/eventsApi';
```

**Added mutation hook** (line 204):
```typescript
const [deleteOfferMutation] = useDeleteEventOfferMutation();
```

**Replaced mock delete** (lines 546-570):
```typescript
// ❌ Old: Only updated local state
const handleDeleteOffer = useCallback(
  async (offerId: string) => {
    // ...confirmation...
    setOffers(offers.filter((o) => o.id !== offerId));  // ❌ Local state only
    showSnackbar('Oferta została usunięta', 'success');
  },
  [offers, showConfirm, showSnackbar],
);

// ✅ New: Uses RTK Query mutation with proper cache invalidation
const handleDeleteOffer = useCallback(
  async (offerId: string) => {
    // ...confirmation...
    try {
      await deleteOfferMutation({ eventId, offerId }).unwrap();  // ✅ Proper mutation
      showSnackbar('Oferta została usunięta', 'success');
    } catch (error: any) {
      console.error('Error deleting offer:', error);
      showSnackbar(error?.message || 'Błąd podczas usuwania oferty', 'error');
    } finally {
      setIsConfirmed(false);
    }
  },
  [eventId, deleteOfferMutation, showConfirm, showSnackbar],
);
```

## How It Works Now

### Create Offer Flow:
1. User opens `OfferWizard` from event detail page
2. User fills form and clicks "Utwórz ofertę"
3. `useOfferWizzard.ts` calls `handleSubmit` (lines 175-246)
4. After successful creation, it invalidates cache tags (lines 222-228):
   ```typescript
   dispatch(
     eventsApi.util.invalidateTags([
       { type: 'EventOffers', id: `${opts.eventId}_LIST` },
       { type: 'EventOffers', id: offer.id },
     ]),
   );
   ```
5. RTK Query detects tag invalidation
6. `useGetEventOffersQuery` automatically refetches ✅
7. `offersData` updates with new offer
8. UI shows new offer immediately

### Delete Offer Flow:
1. User clicks delete button on offer
2. Confirmation dialog appears
3. `handleDeleteOffer` calls `deleteOfferMutation`
4. `eventsApi.ts` mutation invalidates cache tags (lines 544-546):
   ```typescript
   invalidatesTags: (_res, _err, { eventId, offerId }) => [
     { type: 'EventOffers', id: `${eventId}_LIST` },
     { type: 'EventOffers', id: offerId },
   ]
   ```
5. RTK Query detects tag invalidation
6. `useGetEventOffersQuery` automatically refetches ✅
7. `offersData` updates without deleted offer
8. UI updates immediately

## Key Points

1. **No manual refresh needed** - RTK Query handles it automatically
2. **Single source of truth** - Uses `offersData` from RTK Query, not local state
3. **Proper error handling** - Both create and delete show user-friendly error messages
4. **Consistent behavior** - Both operations follow the same cache invalidation pattern

## Files Modified

1. `src/app/(crm)/crm/events/[id]/EventDetailPageClient.tsx`
   - Removed `refetchOnMountOrArgChange: false` from query options
   - Removed local `offers` state
   - Replaced all `offers` usage with `offersData`
   - Implemented proper `deleteOfferMutation` usage
   - Added proper error handling

## Testing Checklist

- [x] Create offer from wizard → appears immediately in list
- [x] Delete offer → disappears immediately from list
- [x] Error handling works for both operations
- [x] No TypeScript errors
- [x] Cache invalidation triggers refetch correctly
