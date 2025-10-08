'use client';

import { FormImageInput, FormInput } from './formik';
import { FormImageInputHandle } from './formik/FormImageInput';
import { ElasticBoxComponent, Loader } from './UI';
import {
  ThreeDotMenu,
  ThreeDotPosition,
} from './UI/ThreeDotMenu/ThreeDotMenu';
import { useMobile } from '../hooks/useMobile';
import { Card, CardMedia, IconButton } from '@mui/material';
import { useField, useFormikContext } from 'formik';
import cloneDeep from 'lodash/cloneDeep';
import isUndefined from 'lodash/isUndefined';
import mergeWith from 'lodash/mergeWith';
import { UploadCloud as UploadCloudIcon, Trash2 as Trash2Icon, Move, Check, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import {
  IImage,
  IUploadImage,
  IImagePosition,
  IScreenMetadata,
  IScreenMetadataUpload,
} from '../types/image';
import { FormikFieldModal } from './UI/Modal/FormikFieldModal';
import { SliderX, SliderY, SliderScale } from './UI/Slider/Slider';

interface ImageEditorFieldProps {
  isAdmin?: boolean;
  fieldName: string;
  withMenu?: boolean;
  image?: IImage | IUploadImage | null;
  style?: React.CSSProperties;
  mode?: 'vertical' | 'horizontal';
  menuPosition?: ThreeDotPosition;
  multiplier?: number;
  isLoading?: boolean;
  onSave?: (args: {
    file?: File;
    image: IUploadImage | IImage;
  }) => Promise<void> | void;
}

export function mergeImagePayload(
  base: IImage,
  patch?: Partial<IImage>
): IImage {
  if (!patch) return base;

  const baseClone = cloneDeep(base);

  return mergeWith(baseClone, patch, (objValue, srcValue) => {
    if (isUndefined(srcValue)) {
      return objValue;
    }
    return undefined;
  });
}

export const ImageEditorField: React.FC<ImageEditorFieldProps> = ({
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
}) => {
  const isMobile = useMobile();
  const screenMode = isMobile ? 'mobile' : 'desktop';
  const { values, setFieldValue } = useFormikContext<any>();
  const [field, , helpers] = useField<IUploadImage | IImage>(fieldName);
  const [, , altHelper] = useField<string>(`${fieldName}.alt`);
  const [setPosition, setSetPosition] = useState<boolean>(false);
  const [subMenu, setSubMenu] = useState<boolean>(false);
  const [setAlt, setSetAlt] = useState<boolean>(false);
  const [setObjectFit, setSetObjectFit] = useState<boolean>(false);
  const [uploadImage, setUploadImage] = useState<boolean>(false);

  const imageInputRef = useRef<FormImageInputHandle>(null);

  const uploadedImageFile = values?.[fieldName]?.file;

  const isScreenMetadataWithSrc = (
    metadata: IScreenMetadata | IScreenMetadataUpload
  ): metadata is IScreenMetadata => {
    return 'src' in metadata && typeof metadata.src === 'string';
  };

  const screenMeta = image?.image_metadata?.[screenMode];
  const positions = values?.[fieldName]?.image_metadata?.[screenMode]
    ?.position ?? {
    posX: 0,
    posY: 0,
    scale: 1,
  };
  const objectFit = values?.[fieldName]?.image_metadata?.[screenMode]?.objectFit || 'cover';

  const buildPayload = (): { file?: File; image: IUploadImage | IImage } => {
    const current = (values?.[fieldName] || {}) as any;
    const file = current?.file as File | undefined;

    const { file: _omit, ...imageWithoutFile } = current || {};
    return { file, image: imageWithoutFile as IUploadImage | IImage };
  };

  const src =
    uploadedImageFile instanceof File
      ? URL.createObjectURL(uploadedImageFile)
      : screenMeta && isScreenMetadataWithSrc(screenMeta)
        ? screenMeta.src
        : '';

  const handleChange = (property: keyof IImagePosition, value: number) => {
    const currentPosition = values?.[fieldName]?.image_metadata?.[screenMode]
      ?.position ?? {
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

    helpers.setValue(updated);
  };

  const handleChangeAlt = (value: string) => {
    altHelper.setValue(value);
    handleSubmit();
    handleSetAlt(false);
  };

  const handleSetPosition = (action: boolean) => {
    setSetPosition(action);
    handleOpenSubmenu();
  };

  const handleOpenSubmenu = () => {
    setSubMenu(true);
  };

  const handleSetAlt = (action: boolean) => {
    setSetAlt(action);
  };

  const handleChangeObjectFit = (value: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down') => {
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
    helpers.setValue(updated);
    handleSubmit();
    setSetObjectFit(false);
  };

  const handleUploadImage = () => {
    console.log('[ImageEditorField] handleUploadImage - ustawiam uploadImage=true i subMenu=true');
    setUploadImage(true);
    setSubMenu(true);
    // Od razu klikamy w input do wyboru pliku
    setTimeout(() => {
      imageInputRef.current?.click();
    }, 100);
  };

  const handleRemove = () => {
    setFieldValue(`${fieldName}.file`, null);
  };

  const handleResetPosition = () => {
    const originalPosition = image?.image_metadata?.[screenMode]?.position ?? {
      posX: 0,
      posY: 0,
      scale: 1,
    };

    setFieldValue(
      `${fieldName}.image_metadata.${screenMode}.position`,
      originalPosition
    );
  };

  const handleCloseSubmenu = () => {
    setSubMenu(false);
    setSetPosition(false);
    setUploadImage(false);
    if (uploadedImageFile) {
      handleRemove();
    }
    handleResetPosition();
  };

  const handleSubmit = async () => {
    try {
      const payload = buildPayload();

      console.log('ImageEditorField handleSubmit - payload:', payload);
      console.log('ImageEditorField handleSubmit - values:', values);
      console.log('ImageEditorField handleSubmit - fieldName:', fieldName);

      if (onSave) {
        console.log('Wywołuję onSave z payload:', payload);
        await onSave(payload);
        console.log('onSave zakończone pomyślnie');
      } else {
        console.warn('Brak funkcji onSave!');
      }

      setFieldValue(`${fieldName}.file`, null);

      // Zamykamy submenu po zapisie
      setSubMenu(false);
      setSetPosition(false);
      setUploadImage(false);
    } catch (error) {
      console.error('Error saving image:', error);
      alert('Błąd podczas zapisywania obrazu: ' + (error as Error).message);
    }
  };

  const menuItems = isAdmin ? [
    {
      children: 'Wgraj Zdjęcie',
      onClick: () => {
        return handleUploadImage();
      },
    },
    {
      children: 'Ustaw Alt',
      onClick: () => {
        return handleSetAlt(true);
      },
    },
    {
      children: 'Ustaw Pozycję',
      onClick: handleSetPosition.bind(null, true),
    },
    {
      children: 'Ustaw Object Fit',
      onClick: () => setSetObjectFit(true),
    },
    {
      children: 'Resetuj pozycję',
      onClick: () => {
        handleChange('posX', 0);
        handleChange('posY', 0);
        handleChange('scale', 1);
      },
    },
  ] : [];

  useEffect(() => {
    const uploadedImage = values?.[fieldName]?.file;
    if (uploadedImage) {
      // Automatycznie otwieramy submenu po wgraniu pliku
      setSubMenu(true);
      setSetPosition(true); // Od razu włączamy możliwość przesuwania

      helpers.setValue({
        ...values?.[fieldName],
        image_metadata: {
          ...values?.[fieldName]?.image_metadata,
          desktop: {
            ...values?.[fieldName]?.image_metadata?.desktop,
            position: { posX: 0, posY: 0, scale: 1 },
          },
          mobile: {
            ...values?.[fieldName]?.image_metadata?.mobile,
            position: { posX: 0, posY: 0, scale: 1 },
          },
        },
      });
    }
  }, [values?.[fieldName]?.file]);

  return (
    <>
      <ElasticBoxComponent mode={mode} multiplier={multiplier} style={style}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: setPosition ? 1400 : 100,
          }}
        >
          {setPosition && (
            <>
              <SliderX
                style={{
                  bottom:
                    menuPosition === 'right-bottom' ||
                    menuPosition === 'left-bottom'
                      ? 60
                      : 0,
                }}
                value={positions?.posX ?? 0}
                min={-100}
                max={100}
                step={0.01}
                onChange={(_, v) => {
                  return handleChange('posX', v as number);
                }}
              />
              <SliderY
                value={positions?.posY ?? 0}
                min={-100}
                max={100}
                step={0.01}
                onChange={(_, v) => {
                  return handleChange('posY', v as number);
                }}
              />
              <SliderScale
                style={{
                  top:
                    menuPosition === 'right-top' || menuPosition === 'left-top'
                      ? 40
                      : 0,
                }}
                value={positions?.scale ?? 1}
                min={0.1}
                max={3}
                step={0.01}
                onChange={(_, v) => {
                  return handleChange('scale', v as number);
                }}
              />
            </>
          )}
          {withMenu && isAdmin && (
            <ThreeDotMenu
              menuPosition={menuPosition}
              menuAction={subMenu}
              menuActionContent={
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '2px',
                    margin: '0 4px',
                    zIndex: 100000,
                  }}
                >
                  {uploadImage && (
                    <div style={{ display: 'flex', gap: '2px' }}>
                      <IconButton
                        size="small"
                        onClick={() => {
                          return imageInputRef.current?.click();
                        }}
                        sx={{
                          color: '#e5e4e2',
                          padding: '6px',
                        }}
                      >
                        <UploadCloudIcon size={18} />
                      </IconButton>
                      {uploadedImageFile && (
                        <>
                          <IconButton
                            sx={{
                              color: '#e5e4e2',
                              padding: '6px',
                            }}
                            size="small"
                            onClick={() => {
                              return setSetPosition((prev) => {
                                return !prev;
                              });
                            }}
                          >
                            <Move size={18} />
                          </IconButton>
                          <IconButton
                            sx={{
                              color: '#e5e4e2',
                              padding: '6px',
                            }}
                            size="small"
                            onClick={() => {
                              return handleRemove();
                            }}
                          >
                            <Trash2Icon size={18} />
                          </IconButton>
                        </>
                      )}
                    </div>
                  )}
                  <div
                    style={{ display: 'flex', gap: '2px', marginLeft: 'auto' }}
                  >
                    <IconButton
                      size="small"
                      sx={{
                        color: '#4ade80',
                        padding: '6px',
                      }}
                      onClick={handleSubmit}
                    >
                      <Check size={18} />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={handleCloseSubmenu}
                      sx={{
                        color: '#ef4444',
                        padding: '6px',
                      }}
                    >
                      <X size={18} />
                    </IconButton>
                  </div>
                </div>
              }
              menu_items={menuItems}
            />
          )}
          {uploadImage && (
            <div
              style={{
                position: 'absolute',
                top:
                  menuPosition === 'right-top' || menuPosition === 'left-top'
                    ? 50
                    : 10,
                left: 50,
                right: 50,
                bottom:
                  menuPosition === 'right-bottom' ||
                  menuPosition === 'left-bottom'
                    ? 50
                    : 10,
                zIndex: 100,
              }}
            >
              <FormImageInput
                name={`${fieldName}.file`}
                label="Wgraj zdjęcie"
                ref={imageInputRef}
              />
            </div>
          )}
        </div>

        <Card
          sx={{
            position: 'relative',
            overflow: 'hidden',
            width: '100%',
            height: '100%',
            backgroundColor: '#1c1f33',
          }}
          style={style}
        >
          {isLoading && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
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
          <CardMedia
            component="img"
            src={src}
            alt={values?.[fieldName]?.alt ?? ''}
            sx={{
              width: `${100 * (positions?.scale ?? 1)}%`,
              height: `${100 * (positions?.scale ?? 1)}%`,
              objectFit: objectFit || 'cover',
              objectPosition: `${50 + (positions?.posX || 0)}% ${50 + (positions?.posY || 0)}%`,
            }}
          />
        </Card>
      </ElasticBoxComponent>
      {setAlt && (
        <FormikFieldModal
          title="Ustaw opis zdjęcia"
          open={setAlt}
          fieldName={`${fieldName}.alt`}
          onClose={() => {
            return handleSetAlt(false);
          }}
          onSave={() => {
            return handleChangeAlt(values[fieldName].alt);
          }}
          values={values}
          isMobile={isMobile}
          label="Opis Alt"
        />
      )}
      {setObjectFit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold mb-4 text-gray-900">Wybierz Object Fit</h3>
            <div className="space-y-2">
              {(['cover', 'contain', 'fill', 'none', 'scale-down'] as const).map((option) => (
                <button
                  key={option}
                  onClick={() => handleChangeObjectFit(option)}
                  className="w-full text-left px-4 py-3 rounded-lg border-2 border-gray-200 hover:border-[#d3bb73] hover:bg-[#d3bb73]/10 transition-colors"
                >
                  <div className="font-medium text-gray-900 capitalize">{option}</div>
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
              onClick={() => setSetObjectFit(false)}
              className="mt-4 w-full px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
            >
              Anuluj
            </button>
          </div>
        </div>
      )}
    </>
  );
};
