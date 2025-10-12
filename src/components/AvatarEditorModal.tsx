'use client';

import { Dialog } from '@mui/material';
import { X } from 'lucide-react';
import React, { useState } from 'react';
import { IImage, IUploadImage } from '../types/image';
import { ImageEditorField } from './ImageEditorField';
import { Formik, Form } from 'formik';

interface AvatarEditorModalProps {
  open: boolean;
  onClose: () => void;
  image?: IImage | IUploadImage | null;
  onSave: (payload: { file?: File; image: IUploadImage | IImage }) => Promise<void>;
  employeeName?: string;
}

export const AvatarEditorModal: React.FC<AvatarEditorModalProps> = ({
  open,
  onClose,
  image,
  onSave,
  employeeName = 'Avatar',
}) => {
  const [isSaving, setIsSaving] = useState(false);

  const initialValues = {
    avatar: image || {
      url: '',
      alt: '',
      posX: 0,
      posY: 0,
      scale: 1,
      opacity: 1,
      objectFit: 'cover' as const,
    },
  };

  const handleSaveFromEditor = async (payload: { file?: File; image: IUploadImage | IImage }) => {
    setIsSaving(true);
    try {
      await onSave(payload);
      onClose();
    } catch (error) {
      console.error('Error saving avatar:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: '#1c1f33',
          borderRadius: '12px',
          border: '1px solid rgba(211, 187, 115, 0.1)',
          overflow: 'visible',
        },
      }}
    >
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-light text-[#e5e4e2]">Edytuj Avatar</h3>
          <button
            onClick={onClose}
            className="text-[#e5e4e2] hover:text-[#d3bb73] transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <Formik initialValues={initialValues} onSubmit={() => {}}>
          {({ values }) => (
            <Form>
              <div className="flex flex-col items-center space-y-4">
                <div className="text-sm text-[#e5e4e2]/60 mb-2 text-center">
                  Ustaw zdjęcie profilowe - obszar w okręgu będzie widoczny
                </div>

                <div className="relative w-full max-w-lg aspect-square overflow-hidden rounded-lg">
                  <div className="relative w-full h-full bg-white">
                    <ImageEditorField
                      fieldName="avatar"
                      image={values.avatar}
                      isAdmin={true}
                      withMenu={true}
                      mode="vertical"
                      menuPosition="left-top"
                      multiplier={1}
                      onSave={handleSaveFromEditor}
                    />
                  </div>

                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: 'radial-gradient(circle at center, transparent 40%, rgba(0, 0, 0, 0.75) 40%)',
                      borderRadius: '8px',
                    }}
                  />

                  <div
                    className="absolute inset-0 pointer-events-none border-2 border-[#d3bb73] rounded-full"
                    style={{
                      width: '80%',
                      height: '80%',
                      top: '10%',
                      left: '10%',
                    }}
                  />
                </div>

                <div className="text-xs text-[#e5e4e2]/40 text-center max-w-md">
                  Okrąg pokazuje jak avatar będzie wyglądać w systemie CRM i na stronie.
                  Użyj sliderów i menu aby dopasować pozycję zdjęcia.
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-6 py-2.5 rounded-lg bg-[#e5e4e2]/10 text-[#e5e4e2] hover:bg-[#e5e4e2]/20 transition-colors"
                >
                  Zamknij
                </button>
              </div>
            </Form>
          )}
        </Formik>
      </div>
    </Dialog>
  );
};
