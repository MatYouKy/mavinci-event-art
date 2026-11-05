import React, { memo, useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import EmployeeAddressCardComponent from '../components/EmployeeAddressCardComponent';
import EmployeeBasicInfoCardComponent from '../components/EmployeeBasicInfoCardComponent';
import EmployeeSkillsCardComponent from '../components/EmployeeSkillsCardComponent';

import EmployeeNotesCardComponent from '../components/EmployeeNotesCardComponent';
import EmployeeEmailAccountsCardComponent from '../components/EmployeeEmailAccountsCardComponent';
import EmployeeWebsiteVisibilityCardComponent from '../components/EmployeeWebsiteVisibilityCardComponent';
import EmployeeCompensationCard from '@/components/crm/personnel/EmployeeCompensationCard';
import { supabase } from '@/lib/supabase/browser';
import CommissionAccountCard from '@/components/crm/commissions/CommissionAccountCard';
import EmployeeSalesCommissionTermsCard from '@/components/crm/commissions/EmployeeSalesCommissionTermsCard';
import MyCommissionsPanel from '@/components/crm/commissions/MyCommissionsPanel';

interface EmployeeOverviewTabProps {
  employee: any;
  editedData: any;
  setEditedData: React.Dispatch<React.SetStateAction<any>>;
  isEditing: boolean;
  isAdmin: boolean;
  accessLevels: any[];
  emailAccounts: any[];
  /** Profil zalogowanego pracownika — „Moje prowizje” i własne warunki (tylko do odczytu). */
  isOwnProfile?: boolean;
}

export const EmployeeOverviewTab: React.FC<EmployeeOverviewTabProps> = ({
  employee,
  editedData,
  setEditedData,
  isEditing,
  isAdmin,
  accessLevels,
  emailAccounts,
  isOwnProfile = false,
}) => {
  const [sellerEmployeeId, setSellerEmployeeId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setSellerEmployeeId(null);
    supabase
      .from('sales_partner_profiles')
      .select('id')
      .eq('employee_id', employee.id)
      .in('status', ['active', 'onboarding'])
      .maybeSingle()
      .then(({ data, error }) => {
        if (active && !error && data) setSellerEmployeeId(employee.id);
      });
    return () => {
      active = false;
    };
  }, [employee.id]);
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

      {sellerEmployeeId === employee.id ? (
        <CommissionAccountCard accountType="employee" accountId={employee.id} />
      ) : (
        <EmployeeCompensationCard key={employee.id} employeeId={employee.id} />
      )}

      <EmployeeSalesCommissionTermsCard key={`sales-terms:${employee.id}`} employeeId={employee.id} isAdmin={isAdmin} isOwnProfile={isOwnProfile} />

      {isOwnProfile && <MyCommissionsPanel className="lg:col-span-2" />}

      {/* Administrator: rejestr prowizji pracownika (udział w sprzedaży), także bez profilu sprzedawcy. */}
      {isAdmin && !isOwnProfile && sellerEmployeeId !== employee.id && (
        <CommissionAccountCard className="lg:col-span-2" accountType="employee" accountId={employee.id} />
      )}
    </div>
  );
};

export default memo(EmployeeOverviewTab);
