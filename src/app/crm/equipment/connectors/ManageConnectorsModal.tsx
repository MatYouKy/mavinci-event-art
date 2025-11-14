import React, { Dispatch, SetStateAction, useState } from 'react';
import { Formik } from 'formik';
import { Form } from 'formik';
import * as Yup from 'yup';
import { useCreateConnectorMutation, useUpdateConnectorMutation } from '../store/equipmentApi';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { FormikSelect } from '@/components/UI/Formik/FormikSelect';
import { FormCheckbox } from '@/components/UI/Formik/FormCheckbox';
import { FormikTextarea } from '@/components/UI/Formik/FormikTextarea';
import { ConnectorCategoryOptions, FormValues, IConnectorType } from './connector.type';
import { ThumbnailHoverPopper } from '@/components/UI/ThumbnailPopover';

interface ManageConnectorsModalProps {
  selected: IConnectorType | null;
  setSelected: (connector: IConnectorType | null) => void;
  setShowModal: Dispatch<SetStateAction<boolean>>;
}

export const ManageConnectorsModal = ({
  selected,
  setSelected,
  setShowModal,
}: ManageConnectorsModalProps) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(() => {
    if (selected && selected.thumbnail_url) {
      return selected.thumbnail_url;
    }
    return null;
  });

  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);

  const [createConnector, { isLoading: isCreating }] = useCreateConnectorMutation();
  const [updateConnector, { isLoading: isUpdating }] = useUpdateConnectorMutation();
  const { showSnackbar } = useSnackbar();

  const validationSchema = Yup.object({
    name: Yup.string().trim().required('Wymagane'),
    description: Yup.string().trim(),
    common_uses: Yup.string().trim(),
    is_active: Yup.boolean().required(),
  });

  const initialValues: FormValues = selected
    ? {
        name: selected.name ?? '',
        description: selected.description ?? '',
        common_uses: selected.common_uses ?? '',
        is_active: selected.is_active ?? true,
        direction: selected.direction ?? 'input',
        category: selected.category ?? 'signal',
      }
    : {
        name: '',
        description: '',
        common_uses: '',
        is_active: true,
        direction: 'input',
        category: 'signal',
      };

  const onSubmit = async (values: FormValues) => {
    const data = {
      name: values.name.trim(),
      description: values.description.trim() || null,
      common_uses: values.common_uses.trim() || null,
      is_active: values.is_active,
      direction: values.direction,
      category: values.category,
    };
    try {
      if (selected) {
        await updateConnector({
          id: selected._id,
          data,
          thumbnail: thumbnailFile || undefined,
        }).unwrap();
        showSnackbar('Wtyk zaktualizowany', 'success');
      } else {
        await createConnector({
          data,
          thumbnail: thumbnailFile || undefined,
        }).unwrap();
        showSnackbar('Wtyk dodany', 'success');
      }

      setShowModal(false);
      setSelected(null);
      setThumbnailFile(null);
      setPreviewUrl(null);
    } catch (err) {
      console.error(err);
      showSnackbar('Błąd podczas zapisywania wtyka', 'error');
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setThumbnailFile(f);
      setPreviewUrl(URL.createObjectURL(f));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <h3 className="mb-4 text-xl font-medium text-[#e5e4e2]">
          {selected ? 'Edytuj wtyk' : 'Dodaj nowy wtyk'}
        </h3>

        <Formik<FormValues>
          initialValues={initialValues}
          validationSchema={validationSchema}
          onSubmit={onSubmit}
          enableReinitialize
        >
          {({ values, errors, touched, handleChange, setFieldValue, isSubmitting }) => (
            <Form className="space-y-4">
              <div className="flex gap-2">
                <div className="flex flex-col gap-2 w-full">
                  <label className=" block text-sm text-[#e5e4e2]/60">
                    Nazwa wtyka <span className="text-red-400">*</span>
                  </label>
                  <input
                    name="name"
                    value={values.name}
                    onChange={handleChange}
                    required
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-1.5 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                    placeholder="np. XLR Male"
                  />
                  {touched.name && errors.name && (
                    <div className="mt-1 text-xs text-red-400">{errors.name}</div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex flex-col gap-2 w-full">
                  <label className=" block text-sm text-[#e5e4e2]/60">
                    Kategoria <span className="text-red-400">*</span>
                  </label>
                  <FormikSelect
                    name="category"
                    options={ConnectorCategoryOptions}
                    required
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-1.5 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  />
                  {touched.category && errors.category && (
                    <div className="mt-1 text-xs text-red-400">{errors.category}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <FormikSelect
                    name="direction"
                    label="Kierunek"
                    options={[
                      { value: 'input', label: 'Wejście' },
                      { value: 'output', label: 'Wyjście' },
                      { value: 'bidirectional', label: 'Dwukierunkowy' },
                      { value: 'unknown', label: 'Nieznany' },
                    ]}
                    required
                  />
                </div>
              </div>

              <div>
                <FormikTextarea
                  name="description"
                  label="Opis"
                  rows={3}
                  placeholder="np. Wtyk XLR męski, 3-pinowy"
                />
                <FormikTextarea
                  name="common_uses"
                  label="Typowe zastosowania"
                  rows={2}
                  placeholder="np. Wtyk XLR męski, 3-pinowy"
                />
              </div>

              <div className="flex gap-2">
                <div className="flex flex-col gap-2">
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Zdjęcie wtyka</label>
                  {previewUrl && (
                    <div className="mb-2">
                      <ThumbnailHoverPopper
                        src={previewUrl}
                        alt="Preview"
                        size={128}
                        previewMax={360}
                      />
                    </div>
                  )}
                </div>

                <div className="flex flex-col justify-center">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onFileChange}
                    className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] file:mr-4 file:rounded-lg file:border-0 file:bg-[#d3bb73] file:px-4 file:py-2 file:text-sm file:text-[#0f1119] hover:file:bg-[#d3bb73]/90 focus:border-[#d3bb73]/30 focus:outline-none"
                  />
                </div>
                <FormCheckbox name="is_active" label="Aktywny" />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  disabled={isSubmitting || isCreating || isUpdating}
                  className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#0f1119] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
                >
                  {selected ? 'Zapisz zmiany' : 'Dodaj wtyk'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setSelected(null);
                    setThumbnailFile(null);
                    setPreviewUrl(null);
                  }}
                  className="rounded-lg bg-[#0f1119] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#0f1119]/80"
                >
                  Anuluj
                </button>
              </div>
            </Form>
          )}
        </Formik>
      </div>
    </div>
  );
};
