'use client';

import { supabase } from '@/lib/supabase/browser';
import { parseSellerCockpit, type SellerCockpit, type SellerCockpitBrand, type SellerCockpitSeller } from '@/lib/seller/sellerCockpit';
import type { SellerManagerOption } from './SellerManagerAssignment';

export type SellerManagementState = {
  isAdmin: boolean;
  managers: SellerManagerOption[];
  managerId: string | null;
  managerName: string | null;
  backupId: string | null;
  backupName: string | null;
  managerOk: boolean | null;
  brands: SellerCockpitBrand[];
  seller: SellerCockpitSeller | null;
};

type DirectoryProfile = { id: string; manager_id?: string | null; backup_manager_id?: string | null; manager_name?: string | null; backup_manager_name?: string | null };

/** Kandydaci na opiekuna, gdy kokpit jest niedostępny: aktywni pracownicy z uprawnieniem do ofert lub administratorzy. */
async function fallbackManagers(): Promise<SellerManagerOption[]> {
  const { data, error } = await supabase.from('employees').select('id,name,surname,role,access_level,permissions,is_active').eq('is_active', true).order('surname');
  if (error) return [];
  return (data || []).map((employee) => {
    const permissions: string[] = Array.isArray(employee.permissions) ? employee.permissions : [];
    const eligible = employee.role === 'admin' || employee.access_level === 'admin' || permissions.includes('admin') || permissions.includes('offers_manage');
    return { id: employee.id, name: `${employee.name || ''} ${employee.surname || ''}`.trim() || 'Pracownik', eligible };
  });
}

/**
 * Dane opiekuna i marek jednego sprzedawcy. Źródło główne: get_my_seller_cockpit(p_partner) — tylko ten sprzedawca,
 * jeśli jest „mój” (opiekun, zastępca, administrator). Gdy go tam nie ma (np. finanse) — kartoteka + warunki marek (RLS).
 */
export async function loadSellerManagement(partnerId: string): Promise<SellerManagementState> {
  const cockpitResult = await supabase.rpc('get_my_seller_cockpit', { p_partner: partnerId });
  let cockpit: SellerCockpit | null = null;
  if (!cockpitResult.error) cockpit = parseSellerCockpit(cockpitResult.data);
  const seller = cockpit?.sellers.find(item => item.id === partnerId) || null;
  if (cockpit && seller) {
    const managers = cockpit.viewer.is_admin && cockpit.managers.length === 0 ? await fallbackManagers() : cockpit.managers;
    return {
      isAdmin: cockpit.viewer.is_admin,
      managers,
      managerId: seller.manager?.id || null,
      managerName: seller.manager?.name || null,
      backupId: seller.backup_manager?.id || null,
      backupName: seller.backup_manager?.name || null,
      managerOk: seller.manager ? seller.manager_ok : null,
      brands: seller.brands,
      seller,
    };
  }

  const [directoryResult, termsResult, companiesResult] = await Promise.all([
    supabase.rpc('get_crm_seller_directory'),
    supabase.from('sales_partner_brand_terms')
      .select('my_company_id,commission_enabled,default_commission_rate,is_active,commissions_visible')
      .eq('sales_partner_id', partnerId),
    supabase.from('my_companies').select('id,name').order('name'),
  ]);
  if (directoryResult.error) throw directoryResult.error;
  if (termsResult.error) throw termsResult.error;
  const directory = (directoryResult.data || {}) as { is_admin?: boolean; profiles?: DirectoryProfile[] };
  const profile = directory.profiles?.find(item => item.id === partnerId);
  if (!profile) throw new Error('Nie masz dostępu do tego sprzedawcy albo jego profil już nie istnieje.');
  const isAdmin = cockpit?.viewer.is_admin ?? directory.is_admin === true;
  const companyNames = new Map((companiesResult.data || []).map(company => [company.id, company.name as string]));
  const managers = isAdmin ? (cockpit?.managers.length ? cockpit.managers : await fallbackManagers()) : [];
  const managerId = profile.manager_id || null;
  const backupId = profile.backup_manager_id || null;
  return {
    isAdmin,
    managers,
    managerId,
    managerName: profile.manager_name || null,
    backupId,
    backupName: backupId ? profile.backup_manager_name || managers.find(item => item.id === backupId)?.name || null : null,
    managerOk: managerId && managers.length ? managers.find(item => item.id === managerId)?.eligible ?? false : null,
    brands: (termsResult.data || []).map(term => ({
      my_company_id: term.my_company_id,
      name: companyNames.get(term.my_company_id) || 'Marka',
      is_active: term.is_active === true,
      commission_enabled: term.commission_enabled === true,
      rate: term.default_commission_rate == null ? null : Number(term.default_commission_rate),
      commissions_visible: (term as { commissions_visible?: boolean }).commissions_visible === true,
    })),
    seller: null,
  };
}
