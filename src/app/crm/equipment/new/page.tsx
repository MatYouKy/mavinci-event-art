'use client';

import { Formik, Form } from 'formik';
import * as Yup from 'yup';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Edit, Save, Trash2, X } from 'lucide-react';
import { newEquipmentInitialValues } from '../forms/initialValues';
import { EquipmentMainCategory, EquipmentTab, IEquipment } from '../types/equipment.types';
import { TechnicalTabForm } from './tabs/TechnicalTabForm';
import { ComponentsTabForm } from './tabs/ComponentsTabForm';
import { GalleryTabForm } from './tabs/GalleryTabForm';
import { HistoryTabForm } from './tabs/HistoryTabForm';
import { NotesTabForm } from './tabs/NotesTabForm';
import { UnitsTabForm } from './tabs/UnitTabForm/UnitsTabForm';
import { CategorySelectorBar } from './parts/CategorySelectorBar';
import { MainInfoCard } from './parts/MainInfoCard';
import { TabCarousel } from './parts/TabCarousel';
import { ResponsiveActionBar } from '@/components/crm/ResponsiveActionBar';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useCreateEquipmentMutation } from '../store/equipmentApi';
import { toEquipmentFormData } from '../utils/toEquipmentFormData';
import FormikGallery from '@/components/UI/Formik/FormikGallery';
import { useSnackbar } from '@/contexts/SnackbarContext';

export default function NewEquipmentPage() {
  const router = useRouter();
  const [active, setActive] = useState<Omit<EquipmentTab, 'details'>>('technical');
  const { canManageModule } = useCurrentEmployee();
  const canEdit = canManageModule('equipment');
  const { showSnackbar } = useSnackbar();
  const [createEquipment, { isLoading: isCreating }] = useCreateEquipmentMutation();

  const validationSchema = Yup.lazy((values: any) => {
    const main = values.category as EquipmentMainCategory | '';
    const isCables = main === 'cables';

    return Yup.object({
      name: Yup.string().trim().required('Wymagane'),
      category: Yup.string().required('Wymagane'),
      technical: Yup.object({
        user_manual_url: Yup.string()
          .url('Niepoprawny URL')
          .nullable()
          .transform((v) => v || null),

        serial_number: Yup.string()
          .nullable()
          .transform((v) => v || null),

        ...(isCables
          ? {
              cable: Yup.object({
                length_meters: Yup.number()
                  .typeError('Podaj liczbę')
                  .min(0.2, 'Min. 0.2 m')
                  .required('Wymagane dla kabli'),
                connector_in: Yup.string().required('Wymagane dla kabli'),
                connector_out: Yup.string().required('Wymagane dla kabli'),
              }),
            }
          : {
              dimensions: Yup.object({
                weight: Yup.number()
                  .typeError('Podaj liczbę')
                  .nullable()
                  .transform((v) => (v === '' ? null : v)),
                height: Yup.number()
                  .typeError('Podaj liczbę')
                  .nullable()
                  .transform((v) => (v === '' ? null : v)),
                width: Yup.number()
                  .typeError('Podaj liczbę')
                  .nullable()
                  .transform((v) => (v === '' ? null : v)),
                length: Yup.number()
                  .typeError('Podaj liczbę')
                  .nullable()
                  .transform((v) => (v === '' ? null : v)),
              }).nullable(),
              cable: Yup.mixed().nullable(),
            }),
      }),
      quantity: Yup.object({
        tracking: Yup.mixed<'aggregate' | 'unitized'>().oneOf(['aggregate', 'unitized']),
        aggregate_quantity: Yup.number().typeError('Podaj liczbę').min(0),
      }),
      units: Yup.array().of(
        Yup.object({
          unit_serial_number: Yup.string().nullable(),
          status: Yup.mixed().oneOf(['available', 'damaged', 'in_service', 'retired']),
          location_id: Yup.string().nullable(),
          // zakup/serwis (opcjonalne)
          purchase_date: Yup.string().nullable(),
          purchase_price: Yup.number().typeError('Podaj liczbę').min(0).nullable(),
          purchase_currency: Yup.string().oneOf(['PLN', 'EUR', 'USD']).nullable(),
          vendor: Yup.string().max(120).nullable(),
          invoice_number: Yup.string().max(80).nullable(),
          last_service_date: Yup.string().nullable(),
          service_cost: Yup.number().typeError('Podaj liczbę').min(0).nullable(),
        }),
      ),
    });
  });

  const handleSubmit = async (values: IEquipment) => {
    console.log('values', values);
    const newEquipment = toEquipmentFormData(values, { payload: 'equipment', files: 'gallery' });
    console.log('NEW EQUIPMENT', newEquipment);
    showSnackbar('Powinno się dodać', 'success');

    try {
      // console.log('NEW EQUIPMENT', newEquipment);
      const response = await createEquipment(newEquipment);
      if (response.error) {
        console.error('Error creating equipment:', response.error);
      } else {
        console.log('Equipment created:', response.data);
        router.push(`/crm/equipment/${response.data.equipment._id}`);
      }
    } catch (error) {
      console.error('Error creating equipment:', error);
    }
  };

  return (
    <Formik
      initialValues={newEquipmentInitialValues}
      validationSchema={validationSchema}
      onSubmit={(values) => handleSubmit(values as unknown as IEquipment)}
    >
      {({ values }) => {
        const unitsCount =
          values.quantity.total_quantity

        return (
          <Form id="equipment-form" className="space-y-6">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => router.back()}
                className="rounded-lg p-2 hover:bg-[#1c1f33]"
              >
                <ArrowLeft className="h-5 w-5 text-[#e5e4e2]" />
              </button>
              <h2 className="text-2xl font-light text-[#e5e4e2]">Dodaj nowy sprzęt</h2>
              <div className="ml-auto">
                <ResponsiveActionBar
                  actions={[
                    {
                      label: 'Wyczyść',
                      type: 'reset',
                      onClick: () => {},
                      icon: <X className="h-4 w-4" />,
                      variant: 'default',
                    },
                    {
                      label: 'Zapisz',
                      // Use Formik's built-in submit instead of calling handleSubmit directly,
                      // as values might not have type IEquipment yet and to avoid double submit.
                      // onClick: () => handleSubmit(values as unknown as IEquipment),
                      type: 'submit',
                      icon: <Save className="h-4 w-4" />,
                      variant: 'primary',
                    },
                  ]}
                />
                {/* {canEdit ? (
                <ResponsiveActionBar
                  actions={[
                    {
                      label: 'Edytuj',
                      onClick: handleEdit,
                      icon: <Edit className="h-4 w-4" />,
                      variant: 'primary',
                    },
                  ]}
                />
              ) : null} */}
              </div>
            </div>

            {/* 2) Podstawowe informacje + Miniaturka */}
            <MainInfoCard />

            {/* 3) Taby */}
            <TabCarousel
              activeTab={active as EquipmentTab}
              setActiveTab={setActive}
              units={unitsCount}
            />

            {active === 'technical' && <TechnicalTabForm />}
            {active === 'units' && <UnitsTabForm />}
            {active === 'components' && <ComponentsTabForm />}
            {active === 'gallery' && (
              <FormikGallery name="gallery" canManage={canEdit} title="Galeria sprzętu" editMode />
            )}
            {active === 'notes' && <NotesTabForm />}

            {/* <div className="flex justify-end gap-3">
              <button
                type="reset"
                className="rounded-lg bg-[#e5e4e2]/10 px-6 py-2.5 text-[#e5e4e2] hover:bg-[#e5e4e2]/20"
              >
                Wyczyść
              </button>
              <button
                type="submit"
                className="rounded-lg bg-[#d3bb73] px-6 py-2.5 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
              >
                Zapisz sprzęt
              </button>
            </div> */}
          </Form>
        );
      }}
    </Formik>
  );
}
