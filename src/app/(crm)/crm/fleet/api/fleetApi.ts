// store/rtk/fleetApi.ts
import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react';
import { supabase } from '@/lib/supabase/browser';

import type {
  FleetVehicleVM,
  VehicleDB,
  VehicleAlertDB,
  VehicleImageDB,
  VehicleInUseInfo,
  InsurancePolicyDB,
  FuelEntryDB,
  MaintenanceGrouped,
  InUseRow,
  IVehicle,
} from '../types/fleet.types';

export const fleetApi = createApi({
  reducerPath: 'fleetApi',
  baseQuery: fakeBaseQuery(),
  tagTypes: [
    'Fleet',
    'Vehicle',
    'VehicleDetail',
    'Insurance',
    'Maintenance',
    'Fuel',
    'Alerts',
    'Handover',
  ],
  refetchOnMountOrArgChange: false,
  refetchOnFocus: false,
  refetchOnReconnect: true,

  endpoints: (builder) => ({
    // LISTA FLOTA
    getFleetVehicles: builder.query<IVehicle[], void>({
      async queryFn() {
        const { data, error } = await supabase
          .from('vehicles')
          .select(
            `
            *,
            vehicle_images (
              id,
              image_url,
              title,
              created_at,
              sort_order,
              is_primary
            ),
            vehicle_assignments!vehicle_assignments_vehicle_id_fkey (
              employee_id,
              status,
              employees (
                id,
                name,
                surname,
                avatar_url,
                avatar_metadata
              )
            )
          `,
          )
          .order('name', { ascending: true });

        if (error) {
          return { error: { status: 'FETCH_ERROR', message: error.message } as any };
        }

        const vehicles: IVehicle[] = (data ?? []).map((v: any) => {
          const images = Array.isArray(v.vehicle_images) ? v.vehicle_images : [];
          const assignments = Array.isArray(v.vehicle_assignments) ? v.vehicle_assignments : [];

          const activeAssignment = assignments.find((a) => a?.status === 'active');

          // priorytet: primary -> sort_order -> created_at
          const sortedImages = [...images].sort((a, b) => {
            const ap = a?.is_primary ? 0 : 1;
            const bp = b?.is_primary ? 0 : 1;
            if (ap !== bp) return ap - bp;

            const aso = a?.sort_order ?? 9999;
            const bso = b?.sort_order ?? 9999;
            if (aso !== bso) return aso - bso;

            const ad = new Date(a?.created_at ?? 0).getTime();
            const bd = new Date(b?.created_at ?? 0).getTime();
            return ad - bd;
          });

          return {
            ...v,

            // ✅ to rozwiązuje Twój crash:
            all_images: sortedImages,

            // ✅ jeśli tego używasz w UI:
            primary_image_url:
              sortedImages.find((i) => i?.is_primary)?.image_url ??
              sortedImages[0]?.image_url ??
              null,

            // ✅ assignmenty jak w starym komponencie:
            assigned_to: activeAssignment?.employee_id ?? null,
            assigned_employee_name: activeAssignment?.employees?.name ?? null,
            assigned_employee_surname: activeAssignment?.employees?.surname ?? null,
            assigned_employee_avatar_url: activeAssignment?.employees?.avatar_url ?? null,
            assigned_employee_avatar_metadata: activeAssignment?.employees?.avatar_metadata ?? null,
          } as IVehicle;
        });

        return { data: vehicles };
      },

      providesTags: (result) =>
        result
          ? [
              { type: 'Fleet', id: 'LIST' },
              ...result.map((v) => ({ type: 'Vehicle' as const, id: v.id })),
            ]
          : [{ type: 'Fleet', id: 'LIST' }],
    }),

    createVehicle: builder.mutation<IVehicle, Partial<IVehicle>>({
      async queryFn(payload) {
        const { data, error } = await supabase.from('vehicles').insert([payload]).select().single();
        if (error) return { error: { status: 'FETCH_ERROR', message: error.message } };
        return { data: data as IVehicle };
      },
      invalidatesTags: [{ type: 'Fleet', id: 'LIST' }],
    }),

    updateVehicle: builder.mutation<IVehicle, { vehicleId: string; patch: Partial<IVehicle> }>({
      async queryFn({ vehicleId, patch }) {
        const { data, error } = await supabase
          .from('vehicles')
          .update(patch)
          .eq('id', vehicleId)
          .select()
          .single();

        if (error) return { error: { status: 'FETCH_ERROR', message: error.message } };
        return { data: data as IVehicle };
      },
      // albo invalidacja listy, albo tylko konkretnego Vehicle
      invalidatesTags: (res, err, arg) => [
        { type: 'Vehicle', id: arg.vehicleId },
        { type: 'Fleet', id: 'LIST' },
      ],
    }),

    deleteVehicle: builder.mutation<null, { vehicleId: string }>({
      async queryFn({ vehicleId }) {
        const { error } = await supabase.from('vehicles').delete().eq('id', vehicleId);
        if (error) return { error: { status: 'FETCH_ERROR', message: error.message } };
        return { data: null }; // ✅ nigdy undefined
      },
      // możesz invalidować, ale dla UX lepiej usunąć z cache ręcznie w komponencie (patrz niżej)
      invalidatesTags: (res, err, arg) => [
        { type: 'Vehicle', id: arg.vehicleId },
        { type: 'Fleet', id: 'LIST' },
      ],
    }),
    // DETAIL: zestaw danych jak w fetchVehicleData()
    getVehicleDetail: builder.query<
      {
        vehicle: VehicleDB & {
          in_use: boolean;
          in_use_by: string | null;
          in_use_event: string | null;
          in_use_event_id: string | null;
          pickup_timestamp: string | null;
        };
        fuelEntries: FuelEntryDB[];
        maintenanceRecords: MaintenanceGrouped;
        insurancePolicies: InsurancePolicyDB[];
        vehicleAlerts: VehicleAlertDB[];
        handoverHistory: any[];
      },
      { vehicleId: string }
    >({
      providesTags: (_res, _err, arg) => [{ type: 'VehicleDetail', id: arg.vehicleId }],

      async queryFn(arg) {
        try {
          const { vehicleId } = arg;

          const [
            vehicleRes,
            fuelRes,
            maintenanceRes,
            inspectionsRes,
            oilRes,
            timingRes,
            repairsRes,
            insuranceRes,
            alertsRes,
            handoverRes,
            inUseRes,
          ] = await Promise.all([
            supabase.from('vehicles').select('*').eq('id', vehicleId).single(),
            supabase
              .from('fuel_entries')
              .select('*, employees(name, surname)')
              .eq('vehicle_id', vehicleId)
              .order('date', { ascending: false })
              .limit(10),
            supabase
              .from('maintenance_records')
              .select('*')
              .eq('vehicle_id', vehicleId)
              .order('date', { ascending: false })
              .limit(10),
            supabase
              .from('periodic_inspections')
              .select(
                '*, performed_by:employees!periodic_inspections_performed_by_fkey(name, surname)',
              )
              .eq('vehicle_id', vehicleId)
              .order('inspection_date', { ascending: false })
              .limit(10),
            supabase
              .from('oil_changes')
              .select('*')
              .eq('vehicle_id', vehicleId)
              .order('change_date', { ascending: false })
              .limit(10),
            supabase
              .from('timing_belt_changes')
              .select('*')
              .eq('vehicle_id', vehicleId)
              .order('change_date', { ascending: false })
              .limit(10),

            // uwaga: duplikat maintenance_records - zostawiam jak miałeś
            supabase
              .from('maintenance_records')
              .select('*')
              .eq('vehicle_id', vehicleId)
              .order('date', { ascending: false })
              .limit(10),

            supabase
              .from('insurance_policies')
              .select('*')
              .eq('vehicle_id', vehicleId)
              .order('end_date', { ascending: false }),

            supabase
              .from('vehicle_alerts')
              .select('*')
              .eq('vehicle_id', vehicleId)
              .eq('alert_type', 'insurance')
              .eq('is_active', true),

            supabase
              .from('vehicle_handover_history')
              .select('*')
              .eq('vehicle_id', vehicleId)
              .order('timestamp', { ascending: false }),

            supabase
              .from('event_vehicles')
              .select(
                `
              id,
              is_in_use,
              pickup_timestamp,
              driver:employees!event_vehicles_driver_id_fkey(id, name, surname),
              event:events(id, name)
            `,
              )
              .eq('vehicle_id', vehicleId)
              .eq('is_in_use', true)
              .maybeSingle(),
          ]);

          // obsługa błędów supabase
          const all = [
            vehicleRes,
            fuelRes,
            maintenanceRes,
            inspectionsRes,
            oilRes,
            timingRes,
            repairsRes,
            insuranceRes,
            alertsRes,
            handoverRes,
            inUseRes,
          ];
          const firstError = all.find((r) => r.error);
          if (firstError?.error) {
            return {
              error: { status: 'FETCH_ERROR', message: firstError.error.message },
            } as any;
          }

          const inUseData = inUseRes.data as any | null;

          const vehicle = {
            ...(vehicleRes.data as VehicleDB),
            in_use: !!inUseData,
            in_use_by: inUseData?.driver
              ? `${inUseData.driver.name} ${inUseData.driver.surname}`
              : null,
            in_use_event: inUseData?.event?.name || null,
            in_use_event_id: inUseData?.event?.id || null,
            pickup_timestamp: inUseData?.pickup_timestamp || null,
          };

          return {
            data: {
              vehicle,
              fuelEntries: (fuelRes.data || []) as FuelEntryDB[],
              maintenanceRecords: {
                maintenance: maintenanceRes.data || [],
                inspections: inspectionsRes.data || [],
                oil: oilRes.data || [],
                timing: timingRes.data || [],
                repairs: repairsRes.data || [],
              },
              insurancePolicies: (insuranceRes.data || []) as InsurancePolicyDB[],
              vehicleAlerts: (alertsRes.data || []) as VehicleAlertDB[],
              handoverHistory: handoverRes.data || [],
            },
          };
        } catch (e: any) {
          return {
            error: { status: 'CUSTOM_ERROR', message: e?.message ?? 'Unknown error' },
          } as any;
        }
      },
    }),
    // fleetApi.ts
    getVehicleById: builder.query<VehicleDB | null, string>({
      async queryFn(vehicleId) {
        try {
          const { data, error } = await supabase
            .from('vehicles')
            .select('*')
            .eq('id', vehicleId)
            .maybeSingle();

          if (error) {
            return { error: { status: 'FETCH_ERROR', message: error.message } } as any;
          }

          return { data: (data as VehicleDB) ?? null };
        } catch (e: any) {
          return {
            error: { status: 'CUSTOM_ERROR', message: e?.message ?? 'Unknown error' },
          } as any;
        }
      },
      providesTags: (_res, _err, id) => [{ type: 'Vehicle', id }],
    }),

    endVehicleUsage: builder.mutation<void, { vehicleId: string; eventId: string }>({
      invalidatesTags: (_r, _e, arg) => [
        { type: 'Fleet', id: 'LIST' },
        { type: 'VehicleDetail', id: arg.vehicleId },
      ],
      queryFn: async (arg, _api, _extra, baseQuery) => {
        const r = await baseQuery((sb) =>
          sb
            .from('event_vehicles')
            .update({ is_in_use: false })
            .eq('vehicle_id', arg.vehicleId)
            .eq('event_id', arg.eventId)
            .eq('is_in_use', true),
        );
        if ('error' in r) return r as any;
        return { data: undefined };
      },
    }),

    deleteInsurancePolicy: builder.mutation<void, { vehicleId: string; policyId: string }>({
      invalidatesTags: (_r, _e, arg) => [
        { type: 'VehicleDetail', id: arg.vehicleId },
        { type: 'Fleet', id: 'LIST' },
      ],
      queryFn: async (arg, _api, _extra, baseQuery) => {
        const r = await baseQuery((sb) =>
          sb.from('insurance_policies').delete().eq('id', arg.policyId),
        );
        if ('error' in r) return r as any;
        return { data: undefined };
      },
    }),

    deleteMaintenanceRecord: builder.mutation<
      void,
      { vehicleId: string; sourceTable: string; recordId: string }
    >({
      invalidatesTags: (_r, _e, arg) => [
        { type: 'VehicleDetail', id: arg.vehicleId },
        { type: 'Fleet', id: 'LIST' },
      ],
      queryFn: async (arg, _api, _extra, baseQuery) => {
        const r = await baseQuery((sb) => sb.from(arg.sourceTable).delete().eq('id', arg.recordId));
        if ('error' in r) return r as any;
        return { data: undefined };
      },
    }),
  }),
});

export const {
  useGetFleetVehiclesQuery,
  useGetVehicleDetailQuery,
  useDeleteVehicleMutation,
  useEndVehicleUsageMutation,
  useDeleteInsurancePolicyMutation,
  useDeleteMaintenanceRecordMutation,
  useLazyGetVehicleByIdQuery,
  useCreateVehicleMutation,
  useUpdateVehicleMutation,
} = fleetApi;
