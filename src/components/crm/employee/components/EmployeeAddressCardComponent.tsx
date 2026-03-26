import React, { memo } from 'react';
import { EmployeeInfoRow } from './EmployeeInfoRow';
interface Props {
  employee: any;
  editedData: any;
  setEditedData: React.Dispatch<React.SetStateAction<any>>;
  isEditing: boolean;
}

function EmployeeAddressCardComponent({
  employee,
  editedData,
  setEditedData,
  isEditing,
}: Props) {
  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Adres</h3>

      <div className="space-y-3">
        {isEditing ? (
          <>
            <div>
              <label className="text-xs text-[#e5e4e2]/60">Ulica</label>
              <input
                type="text"
                value={editedData.address_street || ''}
                onChange={(e) =>
                  setEditedData((prev: any) => ({
                    ...prev,
                    address_street: e.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-[#e5e4e2]/60">Kod pocztowy</label>
                <input
                  type="text"
                  value={editedData.address_postal_code || ''}
                  onChange={(e) =>
                    setEditedData((prev: any) => ({
                      ...prev,
                      address_postal_code: e.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="text-xs text-[#e5e4e2]/60">Miasto</label>
                <input
                  type="text"
                  value={editedData.address_city || ''}
                  onChange={(e) =>
                    setEditedData((prev: any) => ({
                      ...prev,
                      address_city: e.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-[#e5e4e2]/60">Region</label>
              <input
                type="text"
                value={editedData.region || ''}
                onChange={(e) =>
                  setEditedData((prev: any) => ({ ...prev, region: e.target.value }))
                }
                className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
              />
            </div>
          </>
        ) : (
          <>
            {employee.address_street && <EmployeeInfoRow label="Ulica" value={employee.address_street} />}
            {employee.address_postal_code && employee.address_city && (
              <EmployeeInfoRow
                label="Miasto"
                value={`${employee.address_postal_code} ${employee.address_city}`}
              />
            )}
            {employee.region && <EmployeeInfoRow label="Region" value={employee.region} />}
            {!employee.address_street && !employee.address_city && !employee.region && (
              <p className="text-sm text-[#e5e4e2]/40">Brak danych adresowych</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default memo(EmployeeAddressCardComponent);