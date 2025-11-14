'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFormikContext } from 'formik';
import { useGetStorageLocationsQuery } from '../../../store/equipmentApi';
import { IStorageLocation, IEquipmentQuantity } from '../../../types/equipment.types';
import CableForm from './CableForm';
import UnitizedForm from './UnitizedForm';

/**
 * Komponent zarządzający sekcją "Stan magazynowy" w edycji sprzętu.
 * Dostosowany do nowego modelu:
 *  - Kable → quantity.units: ICableUnits
 *  - Pozostałe → quantity.units: IEquipmentUnit[]
 */
export function UnitsTabForm() {
  const { values, setFieldValue } = useFormikContext<any>();
  const q: IEquipmentQuantity = values.quantity ?? {};

  const mainCategory = (values.category as string) || '';
  const isCables = mainCategory === 'cables';

  // ---- Pobranie lokalizacji z API ----
  const { data: locsData } = useGetStorageLocationsQuery();
  const locations: IStorageLocation[] = useMemo(() => {
    if (!locsData) return [];
    const any = locsData as any;
    return Array.isArray(any?.items)
      ? (any.items as IStorageLocation[])
      : (any as IStorageLocation[]);
  }, [locsData]);

  const wasCablesRef = useRef(isCables);

  // 🔁 Reaguj na zmianę kategorii → resetuj strukturę quantity
  useEffect(() => {
    // zmiana kategorii z kabli → inne
    if (!isCables && wasCablesRef.current) {
      setFieldValue('quantity.units', []); // reset z ICableUnits -> []
      setFieldValue('quantity.total_quantity', 0);
      setFieldValue('quantity.available_quantity', 0);
    }

    // zmiana kategorii z innej → kable
    if (isCables && !wasCablesRef.current) {
      setFieldValue('quantity.total_quantity', 0);
      setFieldValue('quantity.available_quantity', 0);
      setFieldValue('quantity.units', {
        cable_units: 0,
        storage_location_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    wasCablesRef.current = isCables;
  }, [isCables, setFieldValue]);

  // 🧹 sanity cleanup: upewnij się że struktura quantity odpowiada kategorii
  useEffect(() => {
    if (isCables) {
      if (Array.isArray(q.units)) {
        // napraw: jeśli frontend przypadkiem trzyma array, zamień na obiekt
        setFieldValue('quantity.units', {
          cable_units: 0,
          storage_location_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    } else {
      if (!Array.isArray(q.units)) {
        // napraw: jeśli frontend trzyma obiekt ICableUnits, zamień na []
        setFieldValue('quantity.units', []);
      }
    }
  }, [isCables, q.units, setFieldValue]);

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-medium text-[#e5e4e2]">Stan magazynowy</h3>
      </div>

      {isCables ? (
        /* ⬇ CableForm pracuje na:
           quantity.units.cable_units, quantity.units.storage_location_id */
        <CableForm locations={locations} />
      ) : (
        /* ⬇ UnitizedForm pracuje na:
           quantity.units[] oraz quantity.total_quantity */
        <UnitizedForm locations={locations} />
      )}
    </div>
  );
}