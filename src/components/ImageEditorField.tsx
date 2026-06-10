'use client';

import { FormImageInput } from './formik';
import { FormImageInputHandle } from './formik/FormImageInput';
import { ElasticBoxComponent, Loader } from './UI';
import { useMobile } from '../hooks/useMobile';
import { IconButton } from '@mui/material';
import { useField, useFormikContext } from 'formik';
import cloneDeep from 'lodash/cloneDeep';
import isUndefined from 'lodash/isUndefined';
import mergeWith from 'lodash/mergeWith';
import {
  UploadCloud as UploadCloudIcon,
  Trash2 as Trash2Icon,
  Move,
  Check,
  X,
  MoreVertical,
} from 'lucide-react';
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import { IImage, IUploadImage, IImagePosition } from '../types/image';
import { FormikFieldModal } from './UI/Modal/FormikFieldModal';
import { SliderX, SliderY, SliderScale } from './UI/Slider/Slider';
import { PortalDropdownMenu } from './UI/PortalDropdownMenu/PortalDropdownMenu';
import { usePortalDropdown } from '@/hooks/usePortalDropdown';

export type ImageEditorFieldHandle = {
  closeEditor: () => void;
  submitEditor: () => Promise<void>;
  getCurrentImage: () => IUploadImage | IImage | null;
};

type ImageObjectFit = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
type MenuPosition = 'right-bottom' | 'left-bottom' | 'right-top' | 'left-top';

interface ImageEditorFieldProps {
  isAdmin?: boolean;
  fieldName: string;
  withMenu?: boolean;
  image?: IImage | IUploadImage | null;
  style?: React.CSSProperties;
  mode?: 'vertical' | 'horizontal';
  menuPosition?: MenuPosition;
  multiplier?: number;
  isLoading?: boolean;
  fillParent?: boolean;
  onImageChange?: (image: IUploadImage | IImage) => void;
  onSave?: (args: { file?: File; image: IUploadImage | IImage }) => Promise<void> | void;
}

export function mergeImagePayload(base: IImage, patch?: Partial<IImage>): IImage {
  if (!patch) return base;

  const baseClone = cloneDeep(base);

  return mergeWith(baseClone, patch, (objValue, srcValue) => {
    if (isUndefined(srcValue)) return objValue;
    return undefined;
  });
}

export const ImageEditorField = forwardRef<ImageEditorFieldHandle, ImageEditorFieldProps>(
  (
    {
      fieldName,
      withMenu = true,
      image,
      mode = 'vertical',
      style,
      menuPosition = 'right-bottom',
      multiplier,
      isAdmin = false,
      isLoading = false,
      onSave,
      fillParent = false,
      onImageChange,
    },
    ref,
  ) => {
    const isMobile = useMobile();
    const screenMode = isMobile ? 'mobile' : 'desktop';

    const { values, setFieldValue } = useFormikContext<any>();
    const [, , helpers] = useField<IUploadImage | IImage>(fieldName);
    const [, , altHelper] = useField<string>(`${fieldName}.alt`);

    const [isPositionMode, setIsPositionMode] = useState(false);
    const [isActionMode, setIsActionMode] = useState(false);
    const [setAlt, setSetAlt] = useState(false);
    const [setObjectFit, setSetObjectFit] = useState(false);
    const [uploadImage, setUploadImage] = useState(false);

    const imageInputRef = useRef<FormImageInputHandle>(null);
    const latestImageRef = useRef<IUploadImage | IImage | null>(null);

    const dropdown = usePortalDropdown({
      width: 220,
      align: menuPosition.includes('left') ? 'left' : 'right',
      offsetY: 8,
      closeOnScroll: false,
    });

    const uploadedImageFile = values?.[fieldName]?.file;
    const currentImage = values?.[fieldName] || image;
    const screenMeta = currentImage?.image_metadata?.[screenMode];

    const positions = screenMeta?.position ?? {
      posX: 0,
      posY: 0,
      scale: 1,
    };

    const objectFit: ImageObjectFit = screenMeta?.objectFit || 'cover';

    const src =
      uploadedImageFile instanceof File
        ? URL.createObjectURL(uploadedImageFile)
        : screenMeta?.src || '';

    const buildPayload = (): { file?: File; image: IUploadImage | IImage } => {
      const current = (latestImageRef.current || values?.[fieldName] || {}) as any;
      const file = values?.[fieldName]?.file as File | undefined;

      const { file: _omit, ...imageWithoutFile } = current || {};

      return {
        file,
        image: imageWithoutFile as IUploadImage | IImage,
      };
    };

    const closeEditor = () => {
      setIsActionMode(false);
      setIsPositionMode(false);
      setUploadImage(false);
      setSetAlt(false);
      setSetObjectFit(false);
      dropdown.close();
    };

    const handleChange = (property: keyof IImagePosition, value: number) => {
      const currentPosition = values?.[fieldName]?.image_metadata?.[screenMode]?.position ?? {
        posX: 0,
        posY: 0,
        scale: 1,
      };

      const updatedPosition = {
        ...currentPosition,
        [property]: value,
      };

      const prev = values?.[fieldName] as IUploadImage;

      const updated: IUploadImage = {
        ...prev,
        image_metadata: {
          ...prev?.image_metadata,
          [screenMode]: {
            ...prev?.image_metadata?.[screenMode],
            position: updatedPosition,
            upload_settings: {
              ...prev?.image_metadata?.[screenMode]?.upload_settings,
            },
          },
        },
      };

      latestImageRef.current = updated;
      helpers.setValue(updated);
      onImageChange?.(updated);
    };

    const handleSubmit = async () => {
      try {
        const payload = buildPayload();

        if (onSave) {
          await onSave(payload);
        } else {
          console.warn('Brak funkcji onSave!');
        }

        setFieldValue(`${fieldName}.file`, null);
        closeEditor();
      } catch (error) {
        console.error('Error saving image:', error);
        alert('Błąd podczas zapisywania obrazu: ' + (error as Error).message);
      }
    };

    useImperativeHandle(ref, () => ({
      closeEditor,
      submitEditor: handleSubmit,
      getCurrentImage: () => {
        return latestImageRef.current || values?.[fieldName] || null;
      },
    }));

    const handleChangeAlt = (value: string) => {
      altHelper.setValue(value);
      handleSubmit();
      setSetAlt(false);
    };

    const handleChangeObjectFit = (value: ImageObjectFit) => {
      const prev = values?.[fieldName];

      const updated = {
        ...prev,
        image_metadata: {
          ...prev?.image_metadata,
          [screenMode]: {
            ...prev?.image_metadata?.[screenMode],
            objectFit: value,
          },
        },
      };

      latestImageRef.current = updated as IUploadImage;
      helpers.setValue(updated);
      onImageChange?.(updated as IUploadImage | IImage);
      handleSubmit();
      setSetObjectFit(false);
    };

    const openActions = () => {
      setIsActionMode(true);
      dropdown.updatePosition();
    };

    const handleUploadImage = () => {
      setUploadImage(true);
      setIsActionMode(true);

      requestAnimationFrame(() => {
        imageInputRef.current?.click();
        dropdown.updatePosition();
      });
    };

    const handleRemove = () => {
      setFieldValue(`${fieldName}.file`, null);
    };

    const handleResetPosition = () => {
      const prev = values?.[fieldName] as IUploadImage;

      const updated: IUploadImage = {
        ...prev,
        image_metadata: {
          ...prev?.image_metadata,
          [screenMode]: {
            ...prev?.image_metadata?.[screenMode],
            position: {
              posX: 0,
              posY: 0,
              scale: 1,
            },
          },
        },
      };

      latestImageRef.current = updated;
      helpers.setValue(updated);
      onImageChange?.(updated);
    };

    const handleCloseSubmenu = () => {
      setIsActionMode(false);
      setIsPositionMode(false);
      setUploadImage(false);

      if (uploadedImageFile) {
        handleRemove();
      }

      dropdown.close();
    };

    useEffect(() => {
      const uploadedImage = values?.[fieldName]?.file;

      if (!uploadedImage) return;

      setIsActionMode(true);
      setIsPositionMode(true);

      const updated: IUploadImage = {
        ...values?.[fieldName],
        image_metadata: {
          ...values?.[fieldName]?.image_metadata,
          desktop: {
            ...values?.[fieldName]?.image_metadata?.desktop,
            position: { posX: 0, posY: 0, scale: 1 },
            objectFit: values?.[fieldName]?.image_metadata?.desktop?.objectFit || 'cover',
          },
          mobile: {
            ...values?.[fieldName]?.image_metadata?.mobile,
            position: { posX: 0, posY: 0, scale: 1 },
            objectFit: values?.[fieldName]?.image_metadata?.mobile?.objectFit || 'cover',
          },
        },
      };

      latestImageRef.current = updated;
      helpers.setValue(updated);
      onImageChange?.(updated);

      requestAnimationFrame(() => {
        dropdown.updatePosition();
      });
    }, [values?.[fieldName]?.file]);

    useEffect(() => {
      latestImageRef.current = currentImage || null;
    }, [currentImage]);

    useEffect(() => {
      if (!dropdown.isOpen) return;
      dropdown.updatePosition();
    }, [isActionMode, uploadImage, uploadedImageFile, isPositionMode]);

    const menuContent =
      isActionMode || isPositionMode ? (
        <div className="flex items-center justify-between gap-2 px-2 py-2">
          <div className="flex items-center gap-1">
            {uploadImage && (
              <IconButton
                size="small"
                onClick={() => imageInputRef.current?.click()}
                sx={{ color: '#e5e4e2', padding: '6px' }}
              >
                <UploadCloudIcon size={18} />
              </IconButton>
            )}

            {uploadedImageFile && (
              <IconButton
                size="small"
                onClick={handleRemove}
                sx={{ color: '#e5e4e2', padding: '6px' }}
              >
                <Trash2Icon size={18} />
              </IconButton>
            )}

            <IconButton
              size="small"
              onClick={() => setIsPositionMode((prev) => !prev)}
              sx={{ color: '#e5e4e2', padding: '6px' }}
            >
              <Move size={18} />
            </IconButton>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <IconButton
              size="small"
              onClick={handleSubmit}
              sx={{ color: '#4ade80', padding: '6px' }}
            >
              <Check size={18} />
            </IconButton>

            <IconButton
              size="small"
              onClick={handleCloseSubmenu}
              sx={{ color: '#ef4444', padding: '6px' }}
            >
              <X size={18} />
            </IconButton>
          </div>
        </div>
      ) : (
        <div className="py-1">
          <button
            type="button"
            onClick={handleUploadImage}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10"
          >
            <UploadCloudIcon size={16} />
            Wgraj zdjęcie
          </button>

          <button
            type="button"
            onClick={() => {
              setSetAlt(true);
              dropdown.close();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10"
          >
            Ustaw ALT
          </button>

          <button
            type="button"
            onClick={() => {
              setIsPositionMode(true);
              openActions();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10"
          >
            <Move size={16} />
            Ustaw pozycję
          </button>

          <button
            type="button"
            onClick={() => {
              setSetObjectFit(true);
              dropdown.close();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10"
          >
            Ustaw Object Fit
          </button>

          <button
            type="button"
            onClick={() => {
              handleResetPosition();
              openActions();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/10"
          >
            Resetuj pozycję
          </button>
        </div>
      );

    const content = (
      <>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: isPositionMode ? 1400 : 100,
            pointerEvents: isAdmin ? 'auto' : 'none',
          }}
        >
          {isPositionMode && (
            <>
              <SliderX
                value={positions?.posX ?? 0}
                min={-1000}
                max={1000}
                step={1}
                onChange={(_, v) => handleChange('posX', v as number)}
              />

              <SliderY
                value={positions?.posY ?? 0}
                min={-1000}
                max={1000}
                step={1}
                onChange={(_, v) => handleChange('posY', v as number)}
              />

              <SliderScale
                value={positions?.scale ?? 1}
                min={0.1}
                max={5}
                step={0.01}
                onChange={(_, v) => handleChange('scale', v as number)}
              />
            </>
          )}

          {withMenu && isAdmin && (
            <button
              type="button"
              onClick={(event) => {
                setIsActionMode(false);
                dropdown.toggle(`${fieldName}-image-menu`, event);
              }}
              style={{
                position: 'absolute',
                top: menuPosition.includes('top') ? 10 : undefined,
                bottom: menuPosition.includes('bottom') ? 10 : undefined,
                left: menuPosition.includes('left') ? 10 : undefined,
                right: menuPosition.includes('right') ? 10 : undefined,
                zIndex: 1600,
                width: 34,
                height: 34,
                borderRadius: 999,
                border: '1px solid rgba(211, 187, 115, 0.28)',
                background: 'rgba(28, 31, 51, 0.92)',
                color: '#e5e4e2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
              }}
            >
              <MoreVertical size={18} />
            </button>
          )}

          <div style={{ display: 'none' }}>
            <FormImageInput name={`${fieldName}.file`} label="Wgraj zdjęcie" ref={imageInputRef} />
          </div>
        </div>

        <div
          style={{
            position: 'relative',
            overflow: 'hidden',
            width: '100%',
            height: '100%',
            minHeight: 1,
            backgroundColor: '#1c1f33',
            ...style,
          }}
        >
          {isLoading && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: 'rgba(28, 31, 51, 0.8)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 1,
              }}
            >
              <Loader />
            </div>
          )}

          {src ? (
            <img
              src={src}
              alt={values?.[fieldName]?.alt ?? ''}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: 'auto',
                height: 'auto',
                maxWidth: 'none',
                maxHeight: 'none',
                minWidth: objectFit === 'cover' ? '100%' : undefined,
                minHeight: objectFit === 'cover' ? '100%' : undefined,
                objectFit: 'unset',
                transform: `
                  translate(-50%, -50%)
                  translate(${positions?.posX || 0}px, ${positions?.posY || 0}px)
                  scale(${positions?.scale ?? 1})
                `,
                transformOrigin: 'center',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                minHeight: 80,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(229, 228, 226, 0.45)',
                fontSize: 13,
              }}
            >
              Brak zdjęcia
            </div>
          )}
        </div>

        <PortalDropdownMenu
          open={dropdown.isOpen}
          position={dropdown.position}
          content={menuContent}
          className="overflow-hidden"
        />
      </>
    );

    return (
      <>
        {fillParent ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              overflow: 'hidden',
            }}
          >
            {content}
          </div>
        ) : (
          <ElasticBoxComponent mode={mode} multiplier={multiplier} style={style}>
            {content}
          </ElasticBoxComponent>
        )}

        {setAlt && (
          <FormikFieldModal
            title="Ustaw opis zdjęcia"
            open={setAlt}
            fieldName={`${fieldName}.alt`}
            onClose={() => setSetAlt(false)}
            onSave={() => handleChangeAlt(values[fieldName].alt)}
            values={values}
            isMobile={isMobile}
            label="Opis Alt"
          />
        )}

        {setObjectFit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6">
              <h3 className="mb-4 text-xl font-semibold text-gray-900">Wybierz Object Fit</h3>

              <div className="space-y-2">
                {(['cover', 'contain', 'fill', 'none', 'scale-down'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleChangeObjectFit(option)}
                    className="w-full rounded-lg border-2 border-gray-200 px-4 py-3 text-left transition-colors hover:border-[#d3bb73] hover:bg-[#d3bb73]/10"
                  >
                    <div className="font-medium capitalize text-gray-900">{option}</div>
                    <div className="text-sm text-gray-600">
                      {option === 'cover' && 'Wypełnia całą przestrzeń (może przyciąć obraz)'}
                      {option === 'contain' && 'Zmieści cały obraz w kontenerze'}
                      {option === 'fill' && 'Rozciąga obraz do wypełnienia kontenera'}
                      {option === 'none' && 'Nie zmienia rozmiaru obrazu'}
                      {option === 'scale-down' && 'Zmniejsza obraz jeśli jest za duży'}
                    </div>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setSetObjectFit(false)}
                className="mt-4 w-full rounded-lg bg-gray-200 px-4 py-2 transition-colors hover:bg-gray-300"
              >
                Anuluj
              </button>
            </div>
          </div>
        )}
      </>
    );
  },
);

ImageEditorField.displayName = 'ImageEditorField';