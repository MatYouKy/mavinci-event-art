'use client';

import { useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks'; // <- Twoje typed hooks
import { offerWizardActions } from './useOfferWizzardProduct';
import { IOfferItemDraft, IProduct } from '@/app/(crm)/crm/offers/types';

export function useOfferWizardItemsRedux() {
  const dispatch = useAppDispatch();

  const offerItems = useAppSelector((s) => s.offerWizard.offerItems);
  const customItem = useAppSelector((s) => s.offerWizard.customItem);

  const showCustomItemForm = useAppSelector((s) => s.offerWizard.showCustomItemForm);
  const showEquipmentSelector = useAppSelector((s) => s.offerWizard.showEquipmentSelector);
  const showSubcontractorSelector = useAppSelector((s) => s.offerWizard.showSubcontractorSelector);

  const total = useMemo(
    () => offerItems.reduce((sum, i) => sum + (i.subtotal ?? 0), 0),
    [offerItems],
  );

  return {
    offerItems,
    total,

    setOfferItems: (items: IOfferItemDraft[]) => dispatch(offerWizardActions.setOfferItems(items)),

    addProduct: (p: IProduct) => dispatch(offerWizardActions.addProduct(p)),
    removeItem: (id: string) => dispatch(offerWizardActions.removeItem(id)),
    updateItem: (id: string, patch: Partial<IOfferItemDraft>) =>
      dispatch(offerWizardActions.updateItem({ id, patch })),

    // custom form
    customItem,
    setCustomItem: (patch: Partial<typeof customItem>) =>
      dispatch(offerWizardActions.setCustomItem(patch)),

    showCustomItemForm,
    setShowCustomItemForm: (v: boolean) => dispatch(offerWizardActions.setShowCustomItemForm(v)),

    showEquipmentSelector,
    setShowEquipmentSelector: (v: boolean) =>
      dispatch(offerWizardActions.setShowEquipmentSelector(v)),

    showSubcontractorSelector,
    setShowSubcontractorSelector: (v: boolean) =>
      dispatch(offerWizardActions.setShowSubcontractorSelector(v)),

    addCustomItem: () => dispatch(offerWizardActions.addCustomItem()),

    resetWizard: () => dispatch(offerWizardActions.resetWizard()),
  };
}
