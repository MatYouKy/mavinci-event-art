export const getCalculationNumber = (
  calculationId?: string | null,
  createdAt?: string | null,
) => {
  if (!calculationId) return '';

  const parsedDate = createdAt ? new Date(createdAt) : null;
  const year =
    parsedDate && Number.isFinite(parsedDate.getTime())
      ? parsedDate.getFullYear()
      : new Date().getFullYear();
  const stablePart = calculationId.replace(/-/g, '').slice(0, 8).toUpperCase();

  return `KAL/${year}/${stablePart}`;
};
