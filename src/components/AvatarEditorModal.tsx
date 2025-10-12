'use client';

import { Dialog, Avatar } from '@mui/material';
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
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="text-sm text-[#e5e4e2]/60 mb-2">
                    Edytuj zdjęcie
                  </div>
                  <div className="relative w-full aspect-square bg-white rounded-lg overflow-visible border border-[#d3bb73]/20">
                    <ImageEditorField
                      fieldName="avatar"
                      image={values.avatar}
                      isAdmin={true}
                      withMenu={true}
                      mode="vertical"
                      menuPosition="right-top"
                      multiplier={1}
                      onSave={handleSaveFromEditor}
                    />
                  </div>
                  <div className="text-xs text-[#e5e4e2]/40 text-center">
                    Kwadratowy widok edycji
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center space-y-4">
                  <div className="text-sm text-[#e5e4e2]/60 mb-2">
                    Podgląd okrągłego avatara
                  </div>
                  <div className="relative">
                    <Avatar
                      sx={{
                        width: 280,
                        height: 280,
                        border: '4px solid #1c1f33',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                      }}
                    >
                      {values.avatar?.url ? (
                        <div
                          className="w-full h-full"
                          style={{
                            position: 'relative',
                            overflow: 'hidden',
                          }}
                        >
                          <img
                            src={values.avatar.url}
                            alt={values.avatar.alt || employeeName}
                            style={{
                              position: 'absolute',
                              top: '50%',
                              left: '50%',
                              width: '100%',
                              height: '100%',
                              objectFit: values.avatar.objectFit || 'cover',
                              transform: `translate(calc(-50% + ${values.avatar.posX || 0}%), calc(-50% + ${values.avatar.posY || 0}%)) scale(${values.avatar.scale || 1})`,
                              opacity: values.avatar.opacity ?? 1,
                            }}
                          />
                        </div>
                      ) : (
                        <div className="text-6xl text-[#e5e4e2]/20">
                          {employeeName.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </Avatar>
                  </div>
                  <div className="text-xs text-[#e5e4e2]/40 text-center max-w-xs">
                    Tak będzie wyglądać avatar w systemie CRM i na stronie
                  </div>
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
