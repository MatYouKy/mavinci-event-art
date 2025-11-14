// (np. app/crm/equipment/[id]/page.tsx) – główny komponent szczegółów
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, CreditCard as Edit, Save, X, Trash2, Package } from 'lucide-react';
import { Formik, Form } from 'formik';
import * as Yup from 'yup';

import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { ResponsiveActionBar } from '@/components/crm/ResponsiveActionBar';
import { TabCarousel } from '../components/tabs/TabCarousel';
import {
  EquipmentMainCategory,
  EquipmentTabsCarouselType,
  IEquipment,
  IEquipmentDetails,
  IEquipmentQuantity,
  IEquipmentComponents,
} from '../types/equipment.types';
import { TechnicalTab } from '../components/tabs/TechnicalTab';
import { DetailsTab } from '../components/tabs/DetailsTab';


import { useGetEquipmentByIdQuery, useUpdateEquipmentMutation } from '../store/equipmentApi';

import FormikGallery from '@/components/UI/Formik/FormikGallery';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { toUpdateEquipmentFormData } from '../utils/toEquipmentFormData';
import { ISingleImage } from '@/types/image';
import { useStableInitialValues } from '../hooks/useStableInitialValues';
import { UnitsTab } from '../components/tabs/UnitTabs';

/* ----------------------------- helpers ----------------------------- */
const ValidationSchema = Yup.object({
  name: Yup.string().trim().required('Nazwa jest wymagana'),
});

export function buildInitialValues(equipment: IEquipment, prevGallery?: ISingleImage[]): IEquipment {
  const q = equipment?.quantity;


  // Jeśli masz IConnectorType w cable, formularz zwykle chce ID, nie cały obiekt:
  const cableInId  = equipment?.technical?.cable?.connector_in?._id ?? '';
  const cableOutId = equipment?.technical?.cable?.connector_out?._id ?? '';
  const cableLen   = equipment?.technical?.cable?.length_meters ?? '';

  return {
  // CORE 
  _id: equipment?._id ?? '',
  name: equipment?.name ?? '',
  brand: equipment?.brand ?? '',
  model: equipment?.model ?? '',
  category: equipment?.category ?? '' as EquipmentMainCategory,
  subcategory: equipment?.subcategory ?? '',

  // MEDIA
  gallery: equipment?.gallery?.length ? equipment.gallery : (prevGallery ?? []),
  thumbnail_url: equipment?.thumbnail_url ?? '',

  // DETAILS
  description: equipment?.details?.desciption ?? '',
  notes: equipment?.details?.notes ?? '',

  // TECHNICAL
  technical: {
    cable: equipment?.technical?.cable ?? null,
    equip: equipment?.technical?.equip ?? null,
  },

  // QUANTITY
  quantity: equipment?.quantity ?? {
    total_quantity: 0,
    available_quantity: 0,
    units: [],
  } as IEquipmentQuantity,

  // DETAILS
  details: equipment?.details ?? {
    desciption: '',
    notes: '',
    requiredSkills: [],
    recommendedSkills: [],
  } as IEquipmentDetails,

  history: equipment?.history ?? [],
  components: equipment?.components ?? {
    components: [],
  } as IEquipmentComponents,
};
}

export default function EquipmentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canManageModule } = useCurrentEmployee();
  const { isAdmin } = useAuth();

  const saveIntentRef = useRef<boolean>(false);

  const canManage = canManageModule('equipment');
  const canEdit = canManage || isAdmin;

  const equipmentId = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const {
    data: equipment,
    isFetching: eqLoading,
    isError: eqError,
    refetch: refetchEquipment,
  } = useGetEquipmentByIdQuery(equipmentId, {
    skip: !equipmentId,
    refetchOnMountOrArgChange: false,
    refetchOnFocus: false,
    refetchOnReconnect: false,
  });


  // --- budowa initialValues (raz, gdy dane gotowe) ---
  const rawInitial: IEquipment | null = useMemo(() => (equipment ? equipment : null), [equipment]);


  const initialValues = useStableInitialValues(rawInitial, !!equipment);

  // --- mutacje ---
  const [updateEquipmentMutation, { isLoading: updating }] = useUpdateEquipmentMutation();

  const isLoading = eqLoading || updating;

  console.log('equipment', equipment);

  const handleSubmit = async (values: any, helpers: any) => {
    if (!saveIntentRef.current) {
      helpers.setSubmitting(false);
      return;
    }
    try {
      const fd = toUpdateEquipmentFormData(values);
      await updateEquipmentMutation({ id: equipmentId, patch: fd }).unwrap();
      console.log('await updateEquipmentMutation values', values);
      // odśwież – ale nie resetuj Formika (pozostawiasz aktualny state)
      // await Promise.all([refetchEquipment(), refetchUnits()]);
      showSnackbar('Zapisano', 'success');
    } catch (e) {
      showSnackbar('Błąd podczas zapisu', 'error');
      console.error(e);
    } finally {
      helpers.setSubmitting(false);
    }
  };

  const unitsCount = equipment?.quantity?.total_quantity ?? 0;
  // const availableUnits = units?.filter((u: any) => u.status === 'available').length || 0;
  // const totalUnits = units?.length || 0;

  const [activeTab, setActiveTab] = useState<EquipmentTabsCarouselType>('details');
  const [isEditing, setIsEditing] = useState(false);

  // renderuj Formik dopiero, gdy mamy equipment (eliminuje migotanie initialValues)
  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-[#e5e4e2]/60">Ładowanie…</div>
      </div>
    );
  }
  if (eqError || !equipment) {
    return (
      <div className="py-12 text-center">
        <Package className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
        <p className="text-[#e5e4e2]/60">Nie znaleziono sprzętu</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Formik
        enableReinitialize
        initialValues={initialValues}
        validationSchema={ValidationSchema}
        onSubmit={handleSubmit}
      >
        {({ submitForm, resetForm }) => (
          <Form>
            {/* HEADER */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => router.push('/crm/equipment')}
                  className="rounded-lg p-2 transition-colors hover:bg-[#1c1f33]"
                >
                  <ArrowLeft className="h-5 w-5 text-[#e5e4e2]" />
                </button>
                <div>
                  <h2 className="flex items-center gap-3 text-2xl font-light text-[#e5e4e2]">
                    {equipment.name}
                    <span className="text-lg font-normal text-[#d3bb73]">
                      {/* {availableUnits}/{totalUnits} */}
                    </span>
                  </h2>
                  {(equipment.brand || equipment.model) && (
                    <p className="mt-1 text-sm text-[#e5e4e2]/60">
                      {equipment.brand} {equipment.model}
                    </p>
                  )}
                </div>
              </div>

              {canEdit && (
                <ResponsiveActionBar
                  actions={
                    isEditing
                      ? [
                          {
                            label: 'Usuń',
                            onClick: async () => {
                              const confirmed = await showConfirm(
                                `Czy na pewno chcesz usunąć sprzęt "${equipment?.name}"?`,
                                'Usuń sprzęt',
                              );
                              if (!confirmed) return;
                              // TODO: deleteEquipment()
                              showSnackbar('Sprzęt został usunięty', 'success');
                              router.push('/crm/equipment');
                            },
                            icon: <Trash2 className="h-4 w-4" />,
                            variant: 'danger',
                          },
                          {
                            label: 'Anuluj',
                            onClick: () => {
                              setIsEditing(false);
                              resetForm({ values: initialValues });
                            },
                            type: 'reset',
                            icon: <X className="h-4 w-4" />,
                            variant: 'default',
                          },
                          {
                            label: 'Zapisz',
                            // type: 'submit',
                            onClick: () => {
                              // ...a submit zrobimy ręcznie:
                              saveIntentRef.current = true; // sygnał dla onSubmit
                              submitForm();
                              setIsEditing(false);
                            },
                            icon: <Save className="h-4 w-4" />,
                            variant: 'primary',
                          },
                        ]
                      : [
                          {
                            label: 'Edytuj',
                            onClick: () => setIsEditing(true),
                            icon: <Edit className="h-4 w-4" />,
                            variant: 'primary',
                          },
                        ]
                  }
                />
              )}
            </div>

            {/* TABS */}
            <TabCarousel
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              equipment={equipment}
              units={unitsCount}
            />

            {/* DETAILS */}
            {activeTab === 'details' && (
              <DetailsTab
                equipment={equipment}
                isEditing={isEditing}

                // storageLocations={storageLocations}
              />
            )}

            {/* TECHNICAL */}
            {activeTab === 'technical' && (
              <TechnicalTab
                editMode={isEditing}
              />
            )}

            {/* PURCHASE */}
            {/* {activeTab === 'purchase' && (
              <PurchaseTab equipment={equipment} isEditing={isEditing} />
            )} */}

            {/* UNITS — bez Formika */}
            {activeTab === 'units' && (
              <UnitsTab
                equipment={equipment}
                units={unitsCount}
                canEdit={canEdit}
              
                showSnackbar={showSnackbar}
              />
            )}

            {/* GALLERY — Formik */}
            {activeTab === 'gallery' && (
              <FormikGallery
                name="gallery"
                editMode={isEditing}
                canManage={canEdit && isEditing}
                title="Galeria sprzętu"
              />
            )}

            {/* HISTORY */}
            {/* {activeTab === 'history' && <HistoryTab history={equipment?.history ?? []} />} */}
          </Form>
        )}
      </Formik>
    </div>
  );
}
