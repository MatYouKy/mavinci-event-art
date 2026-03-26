import React, { memo } from 'react';
import { EmployeeInfoRow } from './EmployeeInfoRow';

interface Props {
  employee: any;
  editedData: any;
  setEditedData: React.Dispatch<React.SetStateAction<any>>;
  isEditing: boolean;
  isAdmin: boolean;
  accessLevels: any[];
}

function EmployeeBasicInfoCardComponent({
  employee,
  editedData,
  setEditedData,
  isEditing,
  isAdmin,
  accessLevels,
}: Props) {
  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje podstawowe</h3>

      <div className="space-y-3">
        {isEditing ? (
          <>
            <div>
              <label className="text-xs text-[#e5e4e2]/60">Imię</label>
              <input
                type="text"
                value={editedData.name || ''}
                onChange={(e) => setEditedData((prev: any) => ({ ...prev, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="text-xs text-[#e5e4e2]/60">Nazwisko</label>
              <input
                type="text"
                value={editedData.surname || ''}
                onChange={(e) =>
                  setEditedData((prev: any) => ({ ...prev, surname: e.target.value }))
                }
                className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="text-xs text-[#e5e4e2]/60">Pseudonim</label>
              <input
                type="text"
                value={editedData.nickname || ''}
                onChange={(e) =>
                  setEditedData((prev: any) => ({ ...prev, nickname: e.target.value }))
                }
                className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="text-xs text-[#e5e4e2]/60">Email służbowy</label>
              <input
                type="email"
                value={editedData.email || ''}
                onChange={(e) => setEditedData((prev: any) => ({ ...prev, email: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
              />
            </div>

            {isAdmin && (
              <>
                <div>
                  <label className="text-xs text-[#e5e4e2]/60">Email prywatny</label>
                  <input
                    type="email"
                    value={editedData.personal_email || ''}
                    onChange={(e) =>
                      setEditedData((prev: any) => ({
                        ...prev,
                        personal_email: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                    placeholder="Opcjonalnie"
                  />
                </div>

                <div>
                  <label className="text-xs text-[#e5e4e2]/60">
                    Powiadomienia email wysyłać na
                  </label>
                  <select
                    value={editedData.notification_email_preference || 'work'}
                    onChange={(e) =>
                      setEditedData((prev: any) => ({
                        ...prev,
                        notification_email_preference: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                  >
                    <option value="work">Email służbowy</option>
                    <option value="personal">Email prywatny</option>
                    <option value="both">Oba emaile</option>
                    <option value="none">Nie wysyłaj emaili</option>
                  </select>
                </div>
              </>
            )}

            <div>
              <label className="text-xs text-[#e5e4e2]/60">Telefon</label>
              <input
                type="text"
                value={editedData.phone_number || ''}
                onChange={(e) =>
                  setEditedData((prev: any) => ({
                    ...prev,
                    phone_number: e.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="text-xs text-[#e5e4e2]/60">Stanowisko</label>
              <input
                type="text"
                value={editedData.occupation || ''}
                onChange={(e) =>
                  setEditedData((prev: any) => ({
                    ...prev,
                    occupation: e.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
              />
            </div>

            {isAdmin && (
              <div>
                <label className="text-xs text-[#e5e4e2]/60">Rola systemowa</label>
                <select
                  value={editedData.access_level_id || ''}
                  onChange={(e) =>
                    setEditedData((prev: any) => ({
                      ...prev,
                      access_level_id: e.target.value || null,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
                >
                  <option value="">Brak roli</option>
                  {accessLevels.map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        ) : (
          <>
            <EmployeeInfoRow label="Imię" value={employee.name} />
            <EmployeeInfoRow label="Nazwisko" value={employee.surname} />
            {employee.nickname && <EmployeeInfoRow label="Pseudonim" value={employee.nickname} />}
            <EmployeeInfoRow label="Email służbowy" value={employee.email} />
            {isAdmin && employee.personal_email && (
              <EmployeeInfoRow label="Email prywatny" value={employee.personal_email} />
            )}
            {employee.phone_number && (
              <EmployeeInfoRow label="Telefon" value={employee.phone_number} />
            )}
            {employee.phone_private && (
              <EmployeeInfoRow label="Telefon prywatny" value={employee.phone_private} />
            )}
            {employee.occupation && (
              <EmployeeInfoRow label="Stanowisko" value={employee.occupation} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default memo(EmployeeBasicInfoCardComponent);
