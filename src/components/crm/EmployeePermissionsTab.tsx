'use client';

import RecordScopeSelect from '@/components/crm/settings/RecordScopeSelect';
import { useState, useEffect } from 'react';
import { Shield, Save, RefreshCw, ChevronDown, ChevronRight, Bell, Webhook, Car, Building2, RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { ACCESS_SECTIONS } from '@/lib/accessSections';
import { CONTACT_TABS, EVENT_TABS, LEGACY_FINANCE_PERMISSIONS, MAVINCI_LIVE_SECTION_SCOPES, ORGANIZATION_TABS } from '@/lib/employees/permissionTabs';
import { getAllScopes } from '@/lib/permissions';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import {
  FINANCE_COMPANY_LEVEL_OPTIONS,
  normalizeFinanceCompanyAccess,
  type FinanceCompanyLevel,
} from '@/lib/financeCompanyAccess';

interface Props {
  employeeId: string;
  isAdmin: boolean;
  targetEmployeeRole?: string;
  currentEmployeeId?: string;
}

interface WebhookSourceOption {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

interface SalesTeamOption {
  id: string;
  name: string;
}

interface AccessLevelPackage {
  name: string;
  default_permissions: string[] | null;
  event_tabs: string[] | null;
  contact_tabs: string[] | null;
  organization_tabs: string[] | null;
}

interface ExtraPermission {
  key: string;
  label: string;
  description: string;
}

interface PermissionCategory {
  key: string;
  label: string;
  extraPermissions?: ExtraPermission[];
}

const mavinciLiveSectionScopes = MAVINCI_LIVE_SECTION_SCOPES;
const availableEventTabs = EVENT_TABS;
const availableContactTabs = CONTACT_TABS;
const availableOrganizationTabs = ORGANIZATION_TABS;

// Sekcja „Faktury” (invoices_view / invoices_manage) zastąpiona kartą „Finanse według działalności”.
const permissionCategories: PermissionCategory[] = ACCESS_SECTIONS.filter(section => section.key !== 'invoices').map(section => ({
  key: section.key,
  label: section.label,
  extraPermissions: section.scopes.filter(scope => !scope.key.endsWith('_own_only') && scope.key !== `${section.key}_view` && scope.key !== `${section.key}_manage`),
}));


export default function EmployeePermissionsTab({
  employeeId,
  isAdmin,
  targetEmployeeRole,
  currentEmployeeId,
}: Props) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { refresh: refreshCurrentEmployee } = useCurrentEmployee();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string | null>(null);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [eventTabs, setEventTabs] = useState<string[]>([]);
  const [contactTabs, setContactTabs] = useState<string[]>([]);
  const [organizationTabs, setOrganizationTabs] = useState<string[]>([]);
  const [myCompanyIds, setMyCompanyIds] = useState<string[]>([]);
  const [companyAccessMode, setCompanyAccessMode] = useState<'all' | 'selected'>('all');
  const [rolePermissionsInherited, setRolePermissionsInherited] = useState(false);
  const [accessLevelPackage, setAccessLevelPackage] = useState<AccessLevelPackage | null>(null);
  const [myCompanies, setMyCompanies] = useState<Array<{ id: string; name: string; is_active?: boolean | null }>>([]);
  const [financeCompanyAccess, setFinanceCompanyAccess] = useState<Record<string, FinanceCompanyLevel>>({});
  const [contactFormNotifications, setContactFormNotifications] = useState(false);
  const [webhookNotifications, setWebhookNotifications] = useState(false);
  const [fleetComplianceNotifications, setFleetComplianceNotifications] = useState(false);
  const [inquiryAssignmentNotifications, setInquiryAssignmentNotifications] = useState(true);
  const [inquiryFollowupNotifications, setInquiryFollowupNotifications] = useState(true);
  const [inquiryEscalationNotifications, setInquiryEscalationNotifications] = useState(true);
  const [webhookSources, setWebhookSources] = useState<WebhookSourceOption[]>([]);
  const [salesTeams, setSalesTeams] = useState<SalesTeamOption[]>([]);
  const [salesTeamId, setSalesTeamId] = useState('');
  const [isSalesTeamManager, setIsSalesTeamManager] = useState(false);
  const [webhookSourceSettings, setWebhookSourceSettings] = useState<Record<string, boolean>>({});
  const [notificationDefaultsEnabled, setNotificationDefaultsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const targetIsAdmin = targetEmployeeRole === 'admin';
  const canEditThisEmployee = isAdmin || (!targetIsAdmin && employeeId !== currentEmployeeId);

  useEffect(() => {
    fetchPermissions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  useEffect(() => {
    const reload = () => { if (!hasChanges && !saving) void fetchPermissions(); };
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, hasChanges, saving]);

  const fetchPermissions = async () => {
    setPermissionsLoaded(false);
    try {
      setLoading(true);

      const [
        { data, error },
        companiesRes,
        notificationSettingsRes,
        webhookSourcesRes,
        webhookSourceSettingsRes,
        salesTeamsRes,
      ] = await Promise.all([
        supabase
          .from('employees')
          .select(
            'updated_at, role, access_level, access_level_id, permissions, event_tabs, contact_tabs, organization_tabs, my_company_ids, company_access_mode, role_permissions_inherited, finance_company_access, sales_team_id, is_sales_team_manager, access_levels(name, default_permissions, event_tabs, contact_tabs, organization_tabs)',
          )
          .eq('id', employeeId)
          .maybeSingle(),
        supabase.from('my_companies').select('id, name, is_active').order('name'),
        supabase
          .from('employee_notification_settings')
          .select('contact_form_enabled, webhook_notifications_enabled, fleet_compliance_enabled, inquiry_assignments_enabled, inquiry_followups_enabled, inquiry_escalations_enabled')
          .eq('employee_id', employeeId)
          .maybeSingle(),
        supabase
          .from('webhook_sources')
          .select('id, name, slug, is_active')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('employee_webhook_notification_settings')
          .select('source_id, is_enabled')
          .eq('employee_id', employeeId),
        supabase.from('sales_teams').select('id, name').eq('is_active', true).order('name'),
      ]);

      if (error) throw error;
      if (notificationSettingsRes.error) throw notificationSettingsRes.error;
      if (webhookSourcesRes.error) throw webhookSourcesRes.error;
      if (webhookSourceSettingsRes.error) throw webhookSourceSettingsRes.error;
      if (salesTeamsRes.error) throw salesTeamsRes.error;

      setPermissions(data?.permissions || []);
      setLoadedUpdatedAt(data?.updated_at || null);
      setPermissionsLoaded(Boolean(data));
      setEventTabs(data?.event_tabs || []);
      setContactTabs(data?.contact_tabs || []);
      setOrganizationTabs(data?.organization_tabs || []);
      setMyCompanyIds(data?.my_company_ids || []);
      setCompanyAccessMode(data?.company_access_mode === 'selected' ? 'selected' : 'all');
      setRolePermissionsInherited(Boolean(data?.role_permissions_inherited));
      const relatedAccessLevel = data?.access_levels as unknown;
      setAccessLevelPackage(
        (Array.isArray(relatedAccessLevel) ? relatedAccessLevel[0] : relatedAccessLevel) as AccessLevelPackage | null,
      );
      setMyCompanies(companiesRes.data || []);
      setFinanceCompanyAccess(normalizeFinanceCompanyAccess((data as any)?.finance_company_access));
      setSalesTeams((salesTeamsRes.data || []) as SalesTeamOption[]);
      setSalesTeamId(data?.sales_team_id || '');
      setIsSalesTeamManager(data?.is_sales_team_manager || false);

      const adminNotificationDefaults =
        data?.role === 'admin' ||
        data?.access_level === 'admin' ||
        (data?.permissions || []).includes('admin');
      setNotificationDefaultsEnabled(adminNotificationDefaults);

      setContactFormNotifications(
        notificationSettingsRes.data?.contact_form_enabled ?? adminNotificationDefaults,
      );
      setWebhookNotifications(
        notificationSettingsRes.data?.webhook_notifications_enabled ?? adminNotificationDefaults,
      );
      setFleetComplianceNotifications(
        notificationSettingsRes.data?.fleet_compliance_enabled ?? adminNotificationDefaults,
      );
      setInquiryAssignmentNotifications(
        notificationSettingsRes.data?.inquiry_assignments_enabled ?? true,
      );
      setInquiryFollowupNotifications(
        notificationSettingsRes.data?.inquiry_followups_enabled ?? true,
      );
      setInquiryEscalationNotifications(
        notificationSettingsRes.data?.inquiry_escalations_enabled ?? true,
      );

      const sources = (webhookSourcesRes.data || []) as WebhookSourceOption[];
      const savedSourceSettings = new Map(
        (webhookSourceSettingsRes.data || []).map((setting) => [
          setting.source_id,
          setting.is_enabled,
        ]),
      );

      setWebhookSources(sources);
      setWebhookSourceSettings(
        Object.fromEntries(
          sources.map((source) => [
            source.id,
            savedSourceSettings.get(source.id) ?? adminNotificationDefaults,
          ]),
        ),
      );
    } catch (err) {
      console.error('Error fetching permissions:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleCategory = (categoryKey: string) => {
    setExpandedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(categoryKey)) {
        newSet.delete(categoryKey);
      } else {
        newSet.add(categoryKey);
      }
      return newSet;
    });
  };

  const getPermissionLevel = (module: string): 'none' | 'own' | 'view' | 'manage' => {
    if (targetIsAdmin) return 'manage';
    if (permissions.includes(`${module}_manage`)) return 'manage';
    if (permissions.includes(`${module}_view`)) return 'view';
    if (module === 'time_tracking' && permissions.includes('time_tracking_view_own')) return 'own';
    return 'none';
  };

  const setPermissionLevel = (module: string, level: 'none' | 'own' | 'view' | 'manage') => {
    if (!canEditThisEmployee || targetIsAdmin) return;

    setPermissions((prev) => {
      const filtered = prev.filter((p) =>
        p !== `${module}_view`
        && p !== `${module}_manage`
        && !(module === 'time_tracking' && p === 'time_tracking_view_own')
        && !(module === 'mavinci_live' && level === 'none' && mavinciLiveSectionScopes.includes(p as typeof mavinciLiveSectionScopes[number]))
      );

      if (level === 'own' && module === 'time_tracking') return [...filtered, 'time_tracking_view_own'];
      if (level === 'view') {
        return module === 'mavinci_live'
          ? Array.from(new Set([...filtered, `${module}_view`, 'mavinci_live_light_magic']))
          : [...filtered, `${module}_view`];
      } else if (level === 'manage') {
        return module === 'mavinci_live'
          ? Array.from(new Set([...filtered, `${module}_manage`, 'mavinci_live_light_magic']))
          : [...filtered, `${module}_manage`];
      }
      return filtered;
    });
    setRolePermissionsInherited(false);
    setHasChanges(true);
  };

  const toggleExtraPermission = (permissionKey: string) => {
    if (!canEditThisEmployee || targetIsAdmin) return;

    if (permissionKey === 'mavinci_live_light_magic' && getPermissionLevel('mavinci_live') !== 'none') {
      showSnackbar('Light Magic jest wymaganym, podstawowym modułem Mavinci LIVE.', 'info');
      return;
    }

    setPermissions((prev) => {
      if (prev.includes(permissionKey)) {
        return prev.filter((p) => p !== permissionKey);
      } else {
        return [...prev, permissionKey];
      }
    });
    setRolePermissionsInherited(false);
    setHasChanges(true);
  };

  const toggleEventTab = (tabValue: string) => {
    if (!canEditThisEmployee) return;

    setEventTabs((prev) => {
      if (prev.includes(tabValue)) {
        return prev.filter((t) => t !== tabValue);
      } else {
        return [...prev, tabValue];
      }
    });
    setRolePermissionsInherited(false);
    setHasChanges(true);
  };

  const toggleContactTab = (tabValue: string) => {
    if (!canEditThisEmployee) return;

    setContactTabs((prev) => {
      if (prev.includes(tabValue)) {
        return prev.filter((t) => t !== tabValue);
      } else {
        return [...prev, tabValue];
      }
    });
    setRolePermissionsInherited(false);
    setHasChanges(true);
  };

  const toggleOrganizationTab = (tabValue: string) => {
    if (!canEditThisEmployee) return;

    setOrganizationTabs((prev) => {
      if (prev.includes(tabValue)) {
        return prev.filter((t) => t !== tabValue);
      } else {
        return [...prev, tabValue];
      }
    });
    setRolePermissionsInherited(false);
    setHasChanges(true);
  };

  const toggleMyCompanyId = (id: string) => {
    if (!canEditThisEmployee) return;
    setMyCompanyIds((prev) => {
      const isOn = prev.includes(id);
      if (isOn) {
        // Bez dostępu do działalności nie ma też dostępu do jej finansów.
        setFinanceCompanyAccess((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
    setHasChanges(true);
  };

  // Działalności, do których pracownik ma dostęp — tylko dla nich można określić dostęp do finansów.
  const financeCompanies = myCompanies.filter(
    (company) => company.is_active !== false && (companyAccessMode === 'all' || myCompanyIds.includes(company.id)),
  );

  const setFinanceCompanyLevel = (companyId: string, level: FinanceCompanyLevel) => {
    if (!isAdmin) return;
    setFinanceCompanyAccess((current) => {
      const next = { ...current };
      if (level === 'none') delete next[companyId];
      else next[companyId] = level;
      return next;
    });
    setHasChanges(true);
  };

  const toggleContactFormNotifications = () => {
    if (!canEditThisEmployee) return;
    setContactFormNotifications((current) => !current);
    setHasChanges(true);
  };

  const toggleWebhookNotifications = () => {
    if (!canEditThisEmployee) return;
    setWebhookNotifications((current) => !current);
    setHasChanges(true);
  };

  const toggleFleetComplianceNotifications = () => {
    if (!canEditThisEmployee) return;
    setFleetComplianceNotifications((current) => !current);
    setHasChanges(true);
  };

  const toggleWebhookSource = (sourceId: string) => {
    if (!canEditThisEmployee || !webhookNotifications) return;
    setWebhookSourceSettings((current) => ({
      ...current,
      [sourceId]: !(current[sourceId] ?? notificationDefaultsEnabled),
    }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!canEditThisEmployee) {
      if (targetIsAdmin) {
        showSnackbar('Nie możesz edytować uprawnień administratora', 'error');
      } else {
        showSnackbar('Nie masz uprawnień do edycji', 'error');
      }
      return;
    }

    if (companyAccessMode === 'selected' && myCompanyIds.length === 0) {
      showSnackbar('Wybierz przynajmniej jedną markę albo dostęp do wszystkich marek', 'warning');
      return;
    }

    const confirmed = await showConfirm({
      title: 'Zapisać zmiany?',
      message: 'Czy na pewno chcesz zapisać zmiany w uprawnieniach tego pracownika?',
      confirmText: 'Zapisz',
      cancelText: 'Anuluj',
    });

    if (!confirmed) return;

    try {
      setSaving(true);

      if (!permissionsLoaded) throw new Error('Odśwież uprawnienia przed zapisem.');
      const { data: savedEmployee, error } = await supabase
        .from('employees')
        .update({
          permissions: permissions.filter((permission) => !LEGACY_FINANCE_PERMISSIONS.includes(permission)),
          updated_at: new Date().toISOString(),
          event_tabs: eventTabs.length > 0 ? eventTabs : null,
          contact_tabs: contactTabs.length > 0 ? contactTabs : null,
          organization_tabs: organizationTabs.length > 0 ? organizationTabs : null,
          company_access_mode: companyAccessMode,
          my_company_ids: companyAccessMode === 'all' ? [] : myCompanyIds,
          role_permissions_inherited: rolePermissionsInherited,
          sales_team_id: salesTeamId || null,
          is_sales_team_manager: isSalesTeamManager,
          // Dostęp do finansów według działalności zmienia wyłącznie administrator (wymusza to też trigger
          // w bazie). Zapisujemy tylko działalności, do których pracownik ma dostęp.
          ...(isAdmin
            ? {
                finance_company_access: Object.fromEntries(
                  Object.entries(financeCompanyAccess).filter(([companyId, level]) =>
                    level !== 'none' && financeCompanies.some((company) => company.id === companyId)),
                ),
              }
            : {}),
        })
        .eq('id', employeeId)
        .filter('updated_at', loadedUpdatedAt ? 'eq' : 'is', loadedUpdatedAt)
        .select('id,updated_at')
        .maybeSingle();

      if (error) throw error;
      if (!savedEmployee) throw new Error('Dane pracownika zmieniono w innym oknie. Odśwież uprawnienia przed zapisem.');
      setLoadedUpdatedAt(savedEmployee.updated_at);

      const { error: notificationSettingsError } = await supabase
        .from('employee_notification_settings')
        .upsert({
          employee_id: employeeId,
          contact_form_enabled: contactFormNotifications,
          webhook_notifications_enabled: webhookNotifications,
          fleet_compliance_enabled: fleetComplianceNotifications,
          inquiry_assignments_enabled: inquiryAssignmentNotifications,
          inquiry_followups_enabled: inquiryFollowupNotifications,
          inquiry_escalations_enabled: inquiryEscalationNotifications,
          updated_by: currentEmployeeId || null,
        });

      if (notificationSettingsError) throw notificationSettingsError;

      if (webhookSources.length > 0) {
        const { error: webhookSettingsError } = await supabase
          .from('employee_webhook_notification_settings')
          .upsert(
            webhookSources.map((source) => ({
              employee_id: employeeId,
              source_id: source.id,
              is_enabled: webhookSourceSettings[source.id] ?? notificationDefaultsEnabled,
              updated_by: currentEmployeeId || null,
            })),
            { onConflict: 'employee_id,source_id' },
          );

        if (webhookSettingsError) throw webhookSettingsError;
      }

      setHasChanges(false);
      showSnackbar('Uprawnienia zostały zapisane', 'success');

      // Odśwież cache użytkownika jeśli edytujemy własne uprawnienia
      if (employeeId === currentEmployeeId) {
        await refreshCurrentEmployee();
        showSnackbar('Odświeżanie strony za 2 sekundy...', 'info');
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      }
    } catch (err) {
      console.error('Error saving permissions:', err);
      showSnackbar('Błąd podczas zapisywania uprawnień', 'error');
    } finally {
      setSaving(false);
    }
  };

  const setAllPermissions = (value: boolean) => {
    if (!canEditThisEmployee) return;

    if (value) {
      setPermissions(getAllScopes().filter(scope => !scope.endsWith('_own_only')));
    } else {
      setPermissions([]);
    }
    setRolePermissionsInherited(false);
    setHasChanges(true);
  };

  const restoreRolePackage = () => {
    if (!accessLevelPackage || !canEditThisEmployee) return;
    setPermissions(accessLevelPackage.default_permissions || []);
    setEventTabs(accessLevelPackage.event_tabs || []);
    setContactTabs(accessLevelPackage.contact_tabs || []);
    setOrganizationTabs(accessLevelPackage.organization_tabs || []);
    setRolePermissionsInherited(true);
    setHasChanges(true);
    showSnackbar(`Przywrócono pakiet roli „${accessLevelPackage.name}”`, 'info');
  };

  const getCategoryStatus = (category: PermissionCategory): string => {
    const level = getPermissionLevel(category.key);

    if (category.key === 'mavinci_live') {
      if (level === 'none') return 'Brak';
      const selectedCount = targetIsAdmin
        ? mavinciLiveSectionScopes.length
        : mavinciLiveSectionScopes.filter((scope) =>
            scope === 'mavinci_live_light_magic' || permissions.includes(scope),
          ).length;
      return `${level === 'manage' ? 'Zarządzanie' : 'Dostęp'} · ${selectedCount} sekcji`;
    }

    if (['events', 'offers', 'contracts'].includes(category.key)) {
      const action = level === 'manage' ? 'Zarządzanie' : level === 'view' ? 'Przeglądanie' : permissions.includes(`${category.key}_create`) ? 'Tworzenie' : 'Brak dostępu';
      return `${action} · ${permissions.includes(`${category.key}_own_only`) ? 'tylko własne' : 'wszystkie dostępne'}`;
    }
    if (level === 'none') return 'Brak';
    if (level === 'own') return 'Przeglądanie — własny czas';
    if (level === 'view') return 'Przeglądanie';
    if (level === 'manage') {
      if (category.extraPermissions) {
        const extraCount = category.extraPermissions.filter((ep) =>
          permissions.includes(ep.key),
        ).length;
        if (extraCount > 0) {
          return `Zarządzanie + ${extraCount}`;
        }
      }
      return 'Zarządzanie';
    }

    return 'Brak';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-[#d3bb73]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-[#d3bb73]" />
          <h3 className="text-xl font-light text-[#e5e4e2]">Uprawnienia pracownika</h3>
        </div>
        {canEditThisEmployee && (
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
          </button>
        )}
      </div>

      {!canEditThisEmployee && targetIsAdmin && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
          <p className="text-sm text-red-200">
            Nie możesz edytować uprawnień administratora. Tylko inny administrator może to zrobić.
          </p>
        </div>
      )}

      {targetIsAdmin && (
        <div className="rounded-lg border border-[#d3bb73]/25 bg-[#d3bb73]/10 p-4">
          <p className="text-sm font-medium text-[#e5e4e2]">Administrator ma nieograniczony dostęp do Mavinci LIVE.</p>
          <p className="mt-1 text-xs text-[#e5e4e2]/60">Rola <code>admin</code> automatycznie udostępnia wszystkie sekcje, wydarzenia, presety i funkcje zarządzania — niezależnie od zapisanych checkboxów.</p>
        </div>
      )}

      {!canEditThisEmployee && !targetIsAdmin && (
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
          <p className="text-sm text-yellow-200">
            Nie masz uprawnień do edycji uprawnień tego pracownika
          </p>
        </div>
      )}

      {accessLevelPackage && (
        <div className={`rounded-xl border p-4 ${rolePermissionsInherited ? 'border-emerald-400/20 bg-emerald-400/10' : 'border-amber-400/25 bg-amber-400/10'}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-[#e5e4e2]">
                Rola firmowa: {accessLevelPackage.name}
              </div>
              <p className="mt-1 text-xs leading-5 text-[#e5e4e2]/60">
                {rolePermissionsInherited
                  ? 'Uprawnienia i zakładki są synchronizowane z pakietem tej roli.'
                  : 'Ten pracownik ma indywidualne odstępstwa od pakietu roli.'}
              </p>
            </div>
            {canEditThisEmployee && !rolePermissionsInherited && (
              <button
                type="button"
                onClick={restoreRolePackage}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300/25 bg-black/10 px-3 py-2 text-xs text-amber-100 hover:bg-amber-300/10"
              >
                <RotateCcw className="h-4 w-4" />
                Przywróć pakiet roli
              </button>
            )}
          </div>
        </div>
      )}

      {canEditThisEmployee && (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#e5e4e2]">Szybkie akcje</span>
            <div className="flex gap-2">
              <button
                onClick={() => setAllPermissions(true)}
                className="rounded bg-green-500/20 px-3 py-1 text-sm text-green-300 transition-colors hover:bg-green-500/30"
              >
                Zaznacz wszystko
              </button>
              <button
                onClick={() => setAllPermissions(false)}
                className="rounded bg-red-500/20 px-3 py-1 text-sm text-red-300 transition-colors hover:bg-red-500/30"
              >
                Odznacz wszystko
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
        <div className="flex items-start gap-3">
          <Building2 className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
          <div>
            <h4 className="font-medium text-[#e5e4e2]">Marki i spółki</h4>
            <p className="mt-1 text-xs leading-5 text-[#e5e4e2]/60">
              To ograniczenie działa niezależnie od roli. Obejmuje wydarzenia, kalendarz, oferty, umowy i dane finansowe powiązane z marką.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${companyAccessMode === 'all' ? 'border-[#d3bb73]/35 bg-[#d3bb73]/10' : 'border-[#d3bb73]/10 bg-[#0f1119]'}`}>
            <input
              type="radio"
              name={`company-access-${employeeId}`}
              checked={companyAccessMode === 'all'}
              onChange={() => {
                if (!canEditThisEmployee) return;
                setCompanyAccessMode('all');
                setMyCompanyIds([]);
                setHasChanges(true);
              }}
              disabled={!canEditThisEmployee}
            />
            <span><span className="block text-sm text-[#e5e4e2]">Wszystkie marki</span><span className="mt-0.5 block text-xs text-[#e5e4e2]/45">Dostęp zgodny z rolą bez ograniczenia marki.</span></span>
          </label>
          <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${companyAccessMode === 'selected' ? 'border-[#d3bb73]/35 bg-[#d3bb73]/10' : 'border-[#d3bb73]/10 bg-[#0f1119]'}`}>
            <input
              type="radio"
              name={`company-access-${employeeId}`}
              checked={companyAccessMode === 'selected'}
              onChange={() => {
                if (!canEditThisEmployee) return;
                setCompanyAccessMode('selected');
                setHasChanges(true);
              }}
              disabled={!canEditThisEmployee}
            />
            <span><span className="block text-sm text-[#e5e4e2]">Wybrane marki</span><span className="mt-0.5 block text-xs text-[#e5e4e2]/45">Pracownik zobaczy tylko zaznaczone marki.</span></span>
          </label>
        </div>

        {companyAccessMode === 'selected' && (
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {myCompanies.map((company) => (
              <label key={company.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${myCompanyIds.includes(company.id) ? 'border-blue-400/25 bg-blue-400/10' : 'border-[#d3bb73]/10 bg-[#0f1119]'}`}>
                <input
                  type="checkbox"
                  checked={myCompanyIds.includes(company.id)}
                  onChange={() => toggleMyCompanyId(company.id)}
                  disabled={!canEditThisEmployee}
                />
                <span className="text-sm text-[#e5e4e2]">{company.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
        <div className="mb-4 flex items-start gap-3">
          <Shield className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
          <div>
            <h4 className="font-medium text-[#e5e4e2]">Finanse według działalności</h4>
            <p className="mt-1 text-xs leading-5 text-[#e5e4e2]/60">
              Dla każdej działalności, do której pracownik ma dostęp, określ, co widzi w finansach. Bez wybranego poziomu
              nie widzi żadnych finansów tej działalności — także faktur, wyciągów i deklaracji. Fakturowanie zostaje przy
              administratorze, chyba że nadasz „Wystawianie faktur”. Zmienia wyłącznie administrator.
            </p>
          </div>
        </div>
        {targetIsAdmin ? (
          <p className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3 text-sm text-[#e5e4e2]/70">
            Administrator ma pełny dostęp do finansów wszystkich działalności.
          </p>
        ) : financeCompanies.length === 0 ? (
          <p className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3 text-sm text-[#e5e4e2]/70">
            Najpierw przypisz pracownikowi działalność w sekcji „Marki i spółki”.
          </p>
        ) : (
          <div className="space-y-2">
            {financeCompanies.map((company) => {
              const level = financeCompanyAccess[company.id] ?? 'none';
              const option = FINANCE_COMPANY_LEVEL_OPTIONS.find((item) => item.value === level);
              return (
                <div key={company.id} className="grid gap-2 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] md:items-center">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[#e5e4e2]">{company.name}</div>
                    <div className="mt-0.5 text-xs text-[#e5e4e2]/55">{option?.description}</div>
                  </div>
                  <label className="block">
                    <span className="sr-only">Finanse tej działalności: {company.name}</span>
                    <select
                      value={level}
                      onChange={(event) => setFinanceCompanyLevel(company.id, event.target.value as FinanceCompanyLevel)}
                      disabled={!isAdmin}
                      title="Finanse tej działalności"
                      className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {FINANCE_COMPANY_LEVEL_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              );
            })}
            <p className="pt-1 text-xs text-[#e5e4e2]/50">
              Finanse tej działalności: poziom wyższy obejmuje niższe. Uprawnienie „Wartości finansowe wydarzeń” w sekcji
              poniżej dotyczy tylko budżetów i kosztów widocznych wydarzeń, nie banku ani faktur.
            </p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
        <div className="mb-4 flex items-start gap-3">
          <Bell className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
          <div>
            <h4 className="font-medium text-[#e5e4e2]">Subskrypcje powiadomień</h4>
            <p className="mt-1 text-xs text-[#e5e4e2]/60">
              Te ustawienia sterują wyłącznie dostarczaniem powiadomień. Nie nadają ani nie
              odbierają dostępu do wiadomości i zdarzeń.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <label className="flex items-center justify-between gap-4 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
            <div>
              <div className="text-sm font-medium text-[#e5e4e2]">Formularze kontaktowe</div>
              <div className="mt-1 text-xs text-[#e5e4e2]/60">
                Powiadomienia o nowych zapytaniach wysłanych z formularzy stron internetowych.
              </div>
            </div>
            <input
              type="checkbox"
              checked={contactFormNotifications}
              onChange={toggleContactFormNotifications}
              disabled={!canEditThisEmployee}
              className="h-5 w-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>

          <label className="flex items-center justify-between gap-4 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
            <div>
              <div className="text-sm font-medium text-[#e5e4e2]">Follow-upy zapytań</div>
              <div className="mt-1 text-xs text-[#e5e4e2]/60">Przypomnienia o pierwszym kontakcie, kolejnej akcji i kontakcie po ofercie.</div>
            </div>
            <input type="checkbox" checked={inquiryFollowupNotifications} onChange={() => { if (!canEditThisEmployee) return; setInquiryFollowupNotifications((current) => !current); setHasChanges(true); }} disabled={!canEditThisEmployee} className="h-5 w-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 disabled:cursor-not-allowed disabled:opacity-50" />
          </label>

          <label className="flex items-center justify-between gap-4 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
            <div>
              <div className="text-sm font-medium text-[#e5e4e2]">Eskalacje sprzedażowe</div>
              <div className="mt-1 text-xs text-[#e5e4e2]/60">Alerty managerskie, gdy zapytanie nadal nie zostało obsłużone po przypomnieniach.</div>
            </div>
            <input type="checkbox" checked={inquiryEscalationNotifications} onChange={() => { if (!canEditThisEmployee) return; setInquiryEscalationNotifications((current) => !current); setHasChanges(true); }} disabled={!canEditThisEmployee} className="h-5 w-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 disabled:cursor-not-allowed disabled:opacity-50" />
          </label>

          <label className="flex items-center justify-between gap-4 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
            <div>
              <div className="text-sm font-medium text-[#e5e4e2]">Przypisanie zapytania</div>
              <div className="mt-1 text-xs text-[#e5e4e2]/60">
                Banner i notyfikacja, gdy menedżer przypisze temu pracownikowi zapytanie.
              </div>
            </div>
            <input
              type="checkbox"
              checked={inquiryAssignmentNotifications}
              onChange={() => {
                if (!canEditThisEmployee) return;
                setInquiryAssignmentNotifications((current) => !current);
                setHasChanges(true);
              }}
              disabled={!canEditThisEmployee}
              className="h-5 w-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>

          <label className="flex items-center justify-between gap-4 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
            <div className="flex items-start gap-3">
              <Webhook className="mt-0.5 h-4 w-4 text-[#d3bb73]" />
              <div>
                <div className="text-sm font-medium text-[#e5e4e2]">Zewnętrzne źródła</div>
                <div className="mt-1 text-xs text-[#e5e4e2]/60">
                  Główny przełącznik powiadomień ze wszystkich webhooków.
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={webhookNotifications}
              onChange={toggleWebhookNotifications}
              disabled={!canEditThisEmployee}
              className="h-5 w-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>

          <label className="flex items-center justify-between gap-4 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
            <div className="flex items-start gap-3">
              <Car className="mt-0.5 h-4 w-4 text-[#d3bb73]" />
              <div>
                <div className="text-sm font-medium text-[#e5e4e2]">Terminy floty</div>
                <div className="mt-1 text-xs text-[#e5e4e2]/60">
                  Przypomnienia o braku lub kończącej się polisie OC i przeglądzie technicznym.
                </div>
              </div>
            </div>
            <input
              type="checkbox"
              checked={fleetComplianceNotifications}
              onChange={toggleFleetComplianceNotifications}
              disabled={!canEditThisEmployee}
              className="h-5 w-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>

          {webhookSources.length > 0 && (
            <div className="ml-4 space-y-2 border-l border-[#d3bb73]/20 pl-4">
              <div className="pb-1 text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/40">
                Źródła webhooków
              </div>
              {webhookSources.map((source) => (
                <label
                  key={source.id}
                  className={`flex items-center justify-between gap-4 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3 ${
                    webhookNotifications ? '' : 'opacity-50'
                  }`}
                >
                  <div>
                    <div className="text-sm text-[#e5e4e2]">{source.name}</div>
                    <code className="text-xs text-[#d3bb73]/70">{source.slug}</code>
                  </div>
                  <input
                    type="checkbox"
                    checked={webhookSourceSettings[source.id] ?? notificationDefaultsEnabled}
                    onChange={() => toggleWebhookSource(source.id)}
                    disabled={!canEditThisEmployee || !webhookNotifications}
                    className="h-5 w-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </label>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-xs text-blue-200">
            Administrator zachowuje dostęp do wszystkich danych niezależnie od tych przełączników.
            Pracownik bez odpowiednich uprawnień nie otrzyma danych nawet po włączeniu subskrypcji.
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {permissionCategories.map((category) => {
          const isExpanded = expandedCategories.has(category.key);
          const level = getPermissionLevel(category.key);

          return (
            <div
              key={category.key}
              className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]"
            >
              <div
                onClick={() => toggleCategory(category.key)}
                className="flex cursor-pointer items-center justify-between p-4 transition-colors hover:bg-[#0f1119]/50"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="h-5 w-5 text-[#d3bb73]" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-[#d3bb73]" />
                  )}
                  <span className="font-medium text-[#e5e4e2]">{category.label}</span>
                  <span className="text-sm text-[#e5e4e2]/60">{getCategoryStatus(category)}</span>
                </div>
              </div>

              {isExpanded && (
                <div className="space-y-4 border-t border-[#d3bb73]/10 p-4">
                  {category.key !== 'invoices' && (
                    <div>
                      <label className="mb-2 block">
                        <span className="text-sm font-medium text-[#e5e4e2]/80">Poziom dostępu</span>
                      </label>
                      <select
                        value={level}
                        onChange={(e) =>
                          setPermissionLevel(
                            category.key,
                            e.target.value as 'none' | 'own' | 'view' | 'manage',
                          )
                        }
                        disabled={!canEditThisEmployee || targetIsAdmin}
                        className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="none">Brak</option>
                        {category.key === 'time_tracking' && <option value="own">Przeglądanie i raportowanie własnego czasu</option>}
                        <option value="view">Przeglądanie</option>
                        <option value="manage">Zarządzanie</option>
                      </select>
                    </div>
                  )}

                  <RecordScopeSelect module={category.key} permissions={permissions} disabled={!canEditThisEmployee || targetIsAdmin}
                    onChange={next => { setPermissions(next); setRolePermissionsInherited(false); setHasChanges(true); }} />

                  {category.key === 'mavinci_live' && level !== 'none' && (
                    <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 p-3">
                      <p className="text-xs leading-relaxed text-[#e5e4e2]/75">
                        Dostęp działa dwustopniowo: tutaj wybierasz dostępne sekcje aplikacji,
                        a na karcie wydarzenia określasz projekty, poziom obsługi i okres dostępu.
                        Light Magic pozostaje zawsze dostępny jako moduł podstawowy.
                      </p>
                    </div>
                  )}

                  {category.key === 'events' && level !== 'none' && (
                    <div className="space-y-3 border-t border-[#d3bb73]/10 pt-3">
                      <div className="mb-2 text-sm font-medium text-[#e5e4e2]/80">
                        Dostępne zakładki w wydarzeniach
                        <span className="mt-1 block text-xs font-normal text-[#e5e4e2]/60">
                          Wybierz zakładki, które będą widoczne dla tego pracownika
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        {availableEventTabs.map((tab) => (
                          <label
                            key={tab.value}
                            className="group flex cursor-pointer items-start gap-3 rounded border border-[#d3bb73]/20 bg-[#0f1119] p-2 transition-colors hover:border-[#d3bb73]/40"
                          >
                            <input
                              type="checkbox"
                              checked={eventTabs.includes(tab.value)}
                              onChange={() => toggleEventTab(tab.value)}
                              disabled={!canEditThisEmployee}
                              className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium text-[#e5e4e2] transition-colors group-hover:text-[#d3bb73]">
                                {tab.label}
                              </div>
                              <div className="mt-0.5 text-xs text-[#e5e4e2]/60">
                                {tab.description}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {category.key === 'inquiries' && level !== 'none' && (
                    <div className="space-y-3 border-t border-[#d3bb73]/10 pt-3">
                      <div>
                        <div className="text-sm font-medium text-[#e5e4e2]/80">
                          Zespół sprzedaży
                        </div>
                        <p className="mt-1 text-xs text-[#e5e4e2]/60">
                          Zespół ogranicza zakres widoku i zarządzania menedżera. Nie włącza
                          automatycznie powiadomień.
                        </p>
                      </div>
                      <select
                        value={salesTeamId}
                        onChange={(event) => {
                          setSalesTeamId(event.target.value);
                          setHasChanges(true);
                        }}
                        disabled={!canEditThisEmployee}
                        className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50 disabled:opacity-50"
                      >
                        <option value="">Bez zespołu</option>
                        {salesTeams.map((team) => (
                          <option key={team.id} value={team.id}>{team.name}</option>
                        ))}
                      </select>
                      <label className="flex items-start gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3">
                        <input
                          type="checkbox"
                          checked={isSalesTeamManager}
                          onChange={(event) => {
                            setIsSalesTeamManager(event.target.checked);
                            setHasChanges(true);
                          }}
                          disabled={!canEditThisEmployee || !salesTeamId}
                          className="mt-0.5 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 disabled:opacity-50"
                        />
                        <span>
                          <span className="block text-sm font-medium text-[#e5e4e2]">
                            Menedżer tego zespołu
                          </span>
                          <span className="mt-0.5 block text-xs text-[#e5e4e2]/60">
                            Wymaga również uprawnienia „Zarządzanie zespołem”.
                          </span>
                        </span>
                      </label>
                    </div>
                  )}

                  {category.key === 'clients' && level !== 'none' && (
                    <>
                      <div className="space-y-3 border-t border-[#d3bb73]/10 pt-3">
                        <div className="mb-2 text-sm font-medium text-[#e5e4e2]/80">
                          Dostępne zakładki dla kontaktów indywidualnych
                          <span className="mt-1 block text-xs font-normal text-[#e5e4e2]/60">
                            Wybierz zakładki, które będą widoczne w profilu kontaktu
                          </span>
                        </div>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          {availableContactTabs.map((tab) => (
                            <label
                              key={tab.value}
                              className="group flex cursor-pointer items-start gap-3 rounded border border-[#d3bb73]/20 bg-[#0f1119] p-2 transition-colors hover:border-[#d3bb73]/40"
                            >
                              <input
                                type="checkbox"
                                checked={contactTabs.includes(tab.value)}
                                onChange={() => toggleContactTab(tab.value)}
                                disabled={!canEditThisEmployee}
                                className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
                              />
                              <div className="flex-1">
                                <div className="text-sm font-medium text-[#e5e4e2] transition-colors group-hover:text-[#d3bb73]">
                                  {tab.label}
                                </div>
                                <div className="mt-0.5 text-xs text-[#e5e4e2]/60">
                                  {tab.description}
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-3 border-t border-[#d3bb73]/10 pt-3">
                        <div className="mb-2 text-sm font-medium text-[#e5e4e2]/80">
                          Dostępne zakładki dla organizacji (firm)
                          <span className="mt-1 block text-xs font-normal text-[#e5e4e2]/60">
                            Wybierz zakładki, które będą widoczne w profilu organizacji
                          </span>
                        </div>
                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          {availableOrganizationTabs.map((tab) => (
                            <label
                              key={tab.value}
                              className="group flex cursor-pointer items-start gap-3 rounded border border-[#d3bb73]/20 bg-[#0f1119] p-2 transition-colors hover:border-[#d3bb73]/40"
                            >
                              <input
                                type="checkbox"
                                checked={organizationTabs.includes(tab.value)}
                                onChange={() => toggleOrganizationTab(tab.value)}
                                disabled={!canEditThisEmployee}
                                className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
                              />
                              <div className="flex-1">
                                <div className="text-sm font-medium text-[#e5e4e2] transition-colors group-hover:text-[#d3bb73]">
                                  {tab.label}
                                </div>
                                <div className="mt-0.5 text-xs text-[#e5e4e2]/60">
                                  {tab.description}
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {category.extraPermissions && category.extraPermissions.length > 0 && (
                    <div className="space-y-3 border-t border-[#d3bb73]/10 pt-3">
                      <div className="mb-2 text-sm font-medium text-[#e5e4e2]/80">
                        {category.key === 'invoices'
                          ? 'Uprawnienia'
                          : category.key === 'mavinci_live'
                            ? 'Dostępne sekcje aplikacji'
                            : 'Dodatkowe uprawnienia'}
                      </div>
                      {category.extraPermissions.map((extra) => (
                        <label
                          key={extra.key}
                          className="group flex cursor-pointer items-start gap-3"
                        >
                          <input
                            type="checkbox"
                            checked={
                              targetIsAdmin
                              || permissions.includes(extra.key)
                              || (
                                category.key === 'mavinci_live'
                                && extra.key === 'mavinci_live_light_magic'
                                && level !== 'none'
                              )
                            }
                            onChange={() => toggleExtraPermission(extra.key)}
                            disabled={
                              !canEditThisEmployee
                              || targetIsAdmin
                              || (category.key === 'mavinci_live' && level === 'none')
                              || (
                                category.key === 'mavinci_live'
                                && extra.key === 'mavinci_live_light_magic'
                              )
                            }
                            className="mt-1 h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-[#e5e4e2] transition-colors group-hover:text-[#d3bb73]">
                              {extra.label}
                            </div>
                            <div className="mt-0.5 text-xs text-[#e5e4e2]/60">
                              {extra.description}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hasChanges && canEditThisEmployee && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
          <p className="text-sm text-blue-200">
            Masz niezapisane zmiany. Kliknij &quot;Zapisz zmiany&quot; aby je zachować.
          </p>
        </div>
      )}
    </div>
  );
}
