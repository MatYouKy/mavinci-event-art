export type SellerEquipmentReview = {
  key: string;
  context_key: string;
  checked_at: string;
  status: 'clear' | 'conflict' | 'incomplete';
  period: { start: string; end: string; whole_days: boolean; includes_preparation: boolean };
  rows: {
    id: string; name: string; required: number; total: number;
    reserved: number; available: number; shortage: number;
    sources: string[]; repeated: boolean;
  }[];
  issues: { product_id: string | null; name: string; message: string }[];
};
export const equipmentReviewLabels = {
  clear: 'Nie wykryto braków sprzętu',
  conflict: 'Wykryto niedobory sprzętu',
  incomplete: 'Analiza wymaga uzupełnienia',
} as const;
export const canConfirmEquipment = (review: SellerEquipmentReview | null, confirmed: boolean, reason: string) =>
  Boolean(review && (review.status === 'clear' || (confirmed && reason.trim().length >= 10 && reason.trim().length <= 2000)));
