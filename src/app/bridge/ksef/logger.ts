export const KSEF_LOG_PREFIX = "[KSEF_NEXT]";

export function mask(value?: string | null) {
  if (!value) return "null";
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}