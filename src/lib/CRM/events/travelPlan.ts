export type TravelLeg = {
  baseMinutes: number;
  bufferMinutes: number;
  breakMinutes: number;
  plannedMinutes: number;
};
export type TravelPlan = {
  origin: string;
  destination: string;
  calculatedAt: string;
  outbound: TravelLeg;
  inbound: TravelLeg | null;
};
export function planTravelLeg(seconds: number): TravelLeg {
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new Error('Brak prawidłowego czasu trasy z Google Maps.');
  const baseMinutes = Math.ceil(seconds / 60);
  const bufferMinutes = Math.max(15, Math.ceil((baseMinutes * 0.2) / 5) * 5);
  const breakMinutes = Math.floor((baseMinutes - 1) / 120) * 15;
  return recalculateLeg({ baseMinutes, bufferMinutes, breakMinutes, plannedMinutes: 0 });
}
export function recalculateLeg(leg: TravelLeg): TravelLeg {
  return {
    ...leg,
    plannedMinutes: Math.ceil((leg.baseMinutes + leg.bufferMinutes + leg.breakMinutes) / 15) * 15,
  };
}
export function eventTravelMinutes(
  vehicles: Array<{
    travel_plan?: TravelPlan | null;
    logistics_schedule?: unknown;
    status?: string;
  }>,
) {
  const longest = (direction: 'outbound' | 'inbound') => {
    const durations = vehicles
      .filter((v) => v.status !== 'cancelled')
      .map((v) => v.travel_plan?.[direction]?.plannedMinutes)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
    return durations.length ? Math.ceil(Math.max(...durations) / 15) * 15 : null;
  };
  return { outbound: longest('outbound'), inbound: longest('inbound') };
}
