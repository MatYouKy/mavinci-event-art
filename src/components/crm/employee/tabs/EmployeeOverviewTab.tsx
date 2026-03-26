import React, { memo } from 'react';
import { Mail } from 'lucide-react';
import EmployeeAddressCardComponent from '../components/EmployeeAddressCardComponent';
import EmployeeBasicInfoCardComponent from '../components/EmployeeBasicInfoCardComponent';
import EmployeeSkillsCardComponent from '../components/EmployeeSkillsCardComponent';

import EmployeeNotesCardComponent from '../components/EmployeeNotesCardComponent';
import EmployeeEmailAccountsCardComponent from '../components/EmployeeEmailAccountsCardComponent';
import EmployeeWebsiteVisibilityCardComponent from '../components/EmployeeWebsiteVisibilityCardComponent';

interface EmployeeOverviewTabProps {
  employee: any;
  editedData: any;
  setEditedData: React.Dispatch<React.SetStateAction<any>>;
  isEditing: boolean;
  isAdmin: boolean;
  accessLevels: any[];
  emailAccounts: any[];
}

export const EmployeeOverviewTab: React.FC<EmployeeOverviewTabProps> = ({
  employee,
  editedData,
  setEditedData,
  isEditing,
  isAdmin,
  accessLevels,
  emailAccounts,
}) => {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <EmployeeBasicInfoCardComponent
        employee={employee}
        editedData={editedData}
        setEditedData={setEditedData}
        isEditing={isEditing}
        isAdmin={isAdmin}
        accessLevels={accessLevels}
      />

      <EmployeeAddressCardComponent
        employee={employee}
        editedData={editedData}
        setEditedData={setEditedData}
        isEditing={isEditing}
      />

      {!!employee.skills?.length && <EmployeeSkillsCardComponent skills={employee.skills} />}

      {isAdmin && (
        <EmployeeWebsiteVisibilityCardComponent
          employee={employee}
          editedData={editedData}
          setEditedData={setEditedData}
          isEditing={isEditing}
        />
      )}

      {!!employee.notes && (
        <EmployeeNotesCardComponent
          employee={employee}
          editedData={editedData}
          setEditedData={setEditedData}
          isEditing={isEditing}
        />
      )}

      {!!emailAccounts.length && (
        <EmployeeEmailAccountsCardComponent emailAccounts={emailAccounts} />
      )}
    </div>
  );
};

export default memo(EmployeeOverviewTab);
