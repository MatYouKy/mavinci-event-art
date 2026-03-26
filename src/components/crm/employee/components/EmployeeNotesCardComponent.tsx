import React, { memo } from 'react';

interface Props {
  employee: any;
  editedData: any;
  setEditedData: React.Dispatch<React.SetStateAction<any>>;
  isEditing: boolean;
}

function EmployeeNotesCardComponent({
  employee,
  editedData,
  setEditedData,
  isEditing,
}: Props) {
  if (!employee.notes && !isEditing) return null;

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Notatki</h3>

      {isEditing ? (
        <textarea
          value={editedData.notes || ''}
          onChange={(e) => setEditedData((prev: any) => ({ ...prev, notes: e.target.value }))}
          className="min-h-[100px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-[#e5e4e2]"
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm text-[#e5e4e2]/70">{employee.notes}</p>
      )}
    </div>
  );
}

export default memo(EmployeeNotesCardComponent);