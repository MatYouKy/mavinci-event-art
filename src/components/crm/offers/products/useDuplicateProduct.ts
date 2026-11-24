'use client';

import { useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useDialog } from '@/contexts/DialogContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { productDuplicate } from '@/components/crm/materials/materialsApi';
import { PRODUCT_DUPLICATE_NOTE, productDuplicateMessage, productDuplicateName } from '@/lib/CRM/Offers/productDuplicate';

/**
 * „Duplikuj” produkt w katalogu i na karcie produktu: potwierdzenie, okno postępu, kopia na serwerze (`op=duplicate`), komunikat
 * i przejście do karty kopii. Mac — `ProductsStore.duplicate`.
 */
export function useDuplicateProduct() {
  const router = useRouter();
  const { showConfirm } = useDialog();
  const { showLoader, hideLoader } = useGlobalLoader();
  const { showSnackbar } = useSnackbar();
  const busy = useRef(false);
  return useCallback(async (product: { id: string; name: string }) => {
    if (busy.current) return;
    const confirmed = await showConfirm({
      title: 'Duplikuj produkt',
      message: `Utworzyć „${productDuplicateName(product.name)}”? ${PRODUCT_DUPLICATE_NOTE}`,
      confirmText: 'Duplikuj',
    });
    if (!confirmed) return;
    busy.current = true;
    showLoader('Duplikowanie produktu…', 'Kopiujemy kartę produktu, warianty, zasoby i zdjęcia.');
    try {
      const result = await productDuplicate(product.id);
      showSnackbar(productDuplicateMessage(result), result.skipped.length || result.imagesMissing ? 'warning' : 'success');
      router.push(`/crm/offers/products/${result.id}`);
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : 'Nie udało się zduplikować produktu. Spróbuj ponownie.', 'error');
    } finally {
      hideLoader();
      busy.current = false;
    }
  }, [hideLoader, router, showConfirm, showLoader, showSnackbar]);
}
