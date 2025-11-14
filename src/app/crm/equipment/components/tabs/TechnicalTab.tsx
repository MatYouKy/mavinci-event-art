'use client';
import React, { useEffect, useMemo } from 'react';
import { useFormikContext, FastField } from 'formik';
import { FileText } from 'lucide-react';

import type { IEquipment } from '@/app/crm/equipment/types/equipment.types';
import { FormikInput } from '@/components/UI/Formik/FormikInput';
import { FormikSelect } from '@/components/UI/Formik/FormikSelect';
import { useGetConnectorsQuery } from '../../store/equipmentApi';
import type { IConnectorType } from '../../connectors/connector.type';
import { ThumbnailHoverPopper } from '@/components/UI/ThumbnailPopover';

type TechnicalTabProps = {
  editMode?: boolean;
};

function CableFields({
  editMode,
  connectorOptions,
}: {
  editMode: boolean;
  connectorOptions: IConnectorType[];
}) {
  // Używamy FastField — subkomponent przerysuje się tylko, gdy zmienią się jego *własne* fieldy
  const { values } = useFormikContext<IEquipment>();


  const connectorOptionsWithId = useMemo(() => {
    return connectorOptions.map((c) => ({
      value: c._id,
      label: c.name,
    }));
  }, [connectorOptions]);


  const connectorIn = useMemo(() => {
    if (!values?.technical?.cable?.connector_in) return null;
    const connector = connectorOptions.find(
      (c) => c._id === String(values?.technical?.cable?.connector_in),
    );
    return connector;
  }, [values?.technical?.cable?.connector_in, connectorOptions]);


  const connectorOut = useMemo(() => {
    if (!values?.technical?.cable?.connector_out) return null;
    const connector = connectorOptions.find(
      (c) => c._id === String(values?.technical?.cable?.connector_out),
    );
    return connector;
  }, [values?.technical?.cable?.connector_out, connectorOptions]);


  return (
    <React.Fragment key={editMode ? 'edit' : 'view'}>
      {editMode ? (
        <FastField name="technical.cable.length_meters">
          {() => (
            <FormikInput
              name="technical.cable.length_meters"
              label="Długość (m)"
              placeholder="np. 5"
              required
              type="number"
              noNegative
              className={
                editMode
                  ? undefined
                  : 'w-full bg-[#0f1119]/70 border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]/70 cursor-not-allowed'
              }
              disabled={!editMode}
            />
          )}
        </FastField>
      ) : (
        <div className="flex gap-2 text-[#e5e4e2]/60 pb-2 mb-4 border-b border-[#d3bb73]/10 ">
          <h2>Długość: </h2>
          <div className="flex items-center gap-2">
            <h2 className="text-[#e5e4e2]">{values.technical.cable.length_meters} m</h2>
          </div>
        </div>
      )}

      <div className="md:col-span-2">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {editMode ? (
            <FastField name="technical.cable.connector_in">
              {() => (
                <FormikSelect
                  name="technical.cable.connector_in"
                  label="Wtyk wejściowy"
                  options={connectorOptionsWithId}
                  required={false}
                />
              )}
            </FastField>
          ) : (
            <div className="text-[#e5e4e2]/60">
              <h2 className="border-b border-[#d3bb73]/10 pb-2 mb-4">Wtyk wejściowy:</h2>
              <div className="flex items-center gap-2">
                <ThumbnailHoverPopper
                  src={connectorIn?.thumbnail_url}
                  alt={connectorIn?.name}
                  size={36} // miniaturka w komórce
                  previewMax={260} // powiększenie w popoverze
                />

                <h2 className="text-[#e5e4e2]">{connectorIn?.name}</h2>
              </div>
            </div>
          )}

          {editMode ? (
            <FastField name="technical.cable.connector_out">
              {() => (
                <FormikSelect
                  name="technical.cable.connector_out"
                  label="Wtyk wyjściowy"
                  options={connectorOptionsWithId}
                  required={false}
                />
              )}
            </FastField>
          ) : (
            <div className="text-[#e5e4e2]/60">
              <h2 className="border-b border-[#d3bb73]/10 pb-2 mb-4">Wtyk wyjściowy:</h2>
              <div className="flex items-center gap-2">
                <ThumbnailHoverPopper
                  src={connectorOut?.thumbnail_url}
                  alt={connectorOut?.name}
                  size={36} // miniaturka w komórce
                  previewMax={260} // powiększenie w popoverze
                />
                <h2 className="text-[#e5e4e2]">{connectorOut?.name}</h2>
              </div>
            </div>
          )}
        </div>
      </div>
    </React.Fragment>
  );
}

function EquipFields({ editMode }: { editMode: boolean }) {
  console.log('EquipFields editMode', editMode);
  return (
    <React.Fragment key={editMode ? 'edit' : 'view'}>
      <FastField name="technical.equip.dimensions.weight">
        {() => (
          <FormikInput
            name="technical.equip.dimensions.weight"
            label="Waga (kg)"
            placeholder="np. 4.5"
            type="number"
            step="0.01"
            noNegative
            className={
              editMode
                ? undefined
                : 'w-full bg-[#0f1119]/70 border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]/70 cursor-not-allowed'
            }
            disabled={!editMode}
          />
        )}
      </FastField>

      <div>
        <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wymiary (cm)</label>
        <div className="grid grid-cols-3 gap-2">
          {(['length', 'width', 'height'] as const).map((dim) => (
            <FastField key={dim} name={`technical.equip.dimensions.${dim}`}>
              {() => (
                <FormikInput
                  name={`technical.equip.dimensions.${dim}`}
                  placeholder={
                    dim === 'length' ? 'Długość' : dim === 'width' ? 'Szerokość' : 'Wysokość'
                  }
                  type="number"
                  step="0.1"
                  noNegative
                  className={
                    editMode
                      ? undefined
                      : 'w-full bg-[#0f1119]/70 border border-[#d3bb73]/10 rounded-lg px-3 py-2 text-[#e5e4e2]/70 cursor-not-allowed'
                  }
                  disabled={!editMode}
                />
              )}
            </FastField>
          ))}
        </div>
      </div>

      <FastField name="technical.equip.serial_number">
        {() => (
          <FormikInput
            name="technical.equip.serial_number"
            label="Numer seryjny"
            placeholder="np. SN12345678"
            className={
              editMode
                ? undefined
                : 'w-full bg-[#0f1119]/70 border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]/70 cursor-not-allowed'
            }
            disabled={!editMode}
          />
        )}
      </FastField>

      <FastField name="technical.equip.barcode">
        {() => (
          <FormikInput
            name="technical.equip.barcode"
            label="Kod kreskowy"
            placeholder="np. ABC123456"
            className={
              editMode
                ? undefined
                : 'w-full bg-[#0f1119]/70 border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]/70 cursor-not-allowed'
            }
            disabled={!editMode}
          />
        )}
      </FastField>

      <div className="md:col-span-2">
        <label className="mb-2 block text-sm text-[#e5e4e2]/60">Instrukcja obsługi (URL)</label>
        <FastField name="technical.equip.user_manual_url">
          {() =>
            editMode ? (
              <FormikInput
                name="technical.equip.user_manual_url"
                placeholder="https://example.com/instrukcja"
              />
            ) : (
              <UserManualLink />
            )
          }
        </FastField>
      </div>
    </React.Fragment>
  );
}

function UserManualLink() {
  const { values } = useFormikContext<IEquipment>();
  const url = values?.technical?.equip?.user_manual_url;
  if (!url) return <div className="text-[#e5e4e2]/60">-</div>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 text-[#d3bb73] hover:underline"
    >
      <FileText className="h-4 w-4" />
      Otwórz instrukcję
    </a>
  );
}

function TechnicalTabInner({ editMode = false }: TechnicalTabProps) {
  const { values } = useFormikContext<IEquipment>();
  const { setFieldValue } = useFormikContext();
  console.log('values', editMode);

  // 1) RTK Query — bez lokalnego state/effect → mniej rerenderów, korzystasz z cache
  const { data: connectorsData } = useGetConnectorsQuery();

  // 2) Stabilna lista opcji (memo)
  const connectorOptions = useMemo(
    () => (connectorsData ?? []).map((c: IConnectorType) => c),
    [connectorsData],
  );

  const isCable = Boolean(values.technical?.cable);

  useEffect(() => {
    if (values.category === 'cables') {
      // zmiana na kable → czyścimy equip
      setFieldValue('technical.equip', null);
      setFieldValue('technical.cable', {
        length_meters: 0,
        connector_in: null,
        connector_out: null,
      });
    } else {
      // zmiana na inną kategorię → czyścimy cable
      setFieldValue('technical.cable', null);
      setFieldValue('technical.equip', {
        user_manual_url: null,
        serial_number: null,
        dimensions: {
          weight: null,
          height: null,
          width: null,
          length: null,
        },
      });
    }
  }, [values.category]);

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h3 className="mb-6 text-lg font-medium text-[#e5e4e2]">Parametry techniczne</h3>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {isCable ? (
          <CableFields editMode={editMode} connectorOptions={connectorOptions} />
        ) : (
          <EquipFields editMode={editMode} />
        )}
      </div>
    </div>
  );
}

// 3) React.memo — nie renderuj, jeśli propsy się nie zmieniły
export const TechnicalTab = React.memo(TechnicalTabInner);
