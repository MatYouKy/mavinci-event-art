export type CatalogViewMode = 'list' | 'grid' | 'table';

/** New accounts and unsupported saved views must still render the catalog. */
export function catalogViewMode(value: unknown): CatalogViewMode {
  return value === 'list' || value === 'grid' || value === 'table' ? value : 'table';
}
