// src/app/crm/equipment/new/tabs/TechnicalTab.tsx
'use client';

import { useFormikContext } from 'formik';
import { useEffect, useState } from 'react';
import { useLazyGetConnectorsQuery } from '../../store/equipmentApi';
import { IConnectorType } from '../../connectors/connector.type';
import { FormikSelect } from '@/components/UI/Formik/FormikSelect';
import { FormikInput } from '@/components/UI/Formik/FormikInput';

export function TechnicalTabForm() {
  const { values, setFieldValue, errors, touched } = useFormikContext<any>();
  const [getConnectorTypes] = useLazyGetConnectorsQuery();
  const [connectorTypes, setConnectorTypes] = useState<IConnectorType[]>([]);

  useEffect(() => {
    getConnectorTypes()
      .unwrap()
      .then((data) => {
        setConnectorTypes(data);
      });
  }, [getConnectorTypes]);

  const isCables = values.category === 'cables';

  useEffect(() => {
    if (isCables) {
      setFieldValue('technical.equip', null);
    } else {
      setFieldValue('technical.cable', null);
    }
  }, [values, isCables, setFieldValue]);

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Parametry techniczne</h3>

      {isCables ? (
        <div className="flex gap-2 md:flex-row flex-col">
          <FormikInput
            name="technical.cable.length_meters"
            label="Długość (m)"
            step="0.5"
            type="number"
            required
            noNegative
            className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
          />

          <FormikSelect
            name="technical.cable.connector_in"
            label="Wtyk wejściowy"
            options={connectorTypes.map((c) => ({ value: c._id, label: c.name }))}
            required
          />
          <FormikSelect
            name="technical.cable.connector_out"
            label="Wtyk wyjściowy"
            options={connectorTypes.map((c) => ({ value: c._id, label: c.name }))}
            required
          />
        </div>
      ) : (
        <div className="flex gap-2 flex-col">
        <div className="flex flex-col gap-2 md:flex-row">
          <div className="flex gap-2 md:flex-row flex-col">
            <FormikInput
              name="technical.equip.dimensions.weight"
              label="Waga (kg)"
              step="0.5"
              required
              className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
            />
          </div>
          <div className="flex gap-2 md:flex-row flex-col">
            <FormikInput
              name="technical.equip.dimensions.length"
              label="Długość (cm)"
              step="0.1"
              type="number"
              required
              noNegative
              className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
            />
          </div>
          <div className="flex gap-2 md:flex-row flex-col">
            <FormikInput
              name="technical.equip.dimensions.width"
              label="Szerokość (cm)"
              step="0.1"
              type="number"
              required
              noNegative
              className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
            />
          </div>
          <div className="flex gap-2 md:flex-row flex-col">
            <FormikInput
              name="technical.equip.dimensions.height"
              label="Wysokość (cm)"
              step="0.1"
              type="number"
              required
              noNegative
              className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
            />
          </div>
        </div>
        <div className="flex gap-2 md:flex-row flex-col">
              <FormikInput
                name="technical.equip.user_manual_url"
                label="Instrukcja (URL)"
                type="url"
                className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
              <FormikInput
                name="technical.equip.serial_number"
                label="Numer seryjny"
                className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            </div>
        </div>
      )}
    </div>
  );
}
