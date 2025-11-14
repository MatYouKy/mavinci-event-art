'use client';
import * as React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
  TableSortLabel,
} from '@mui/material';
import { Edit, Trash2, Eye, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  EquipmentMainCategory,
  EquipmentMainCategoryLabels,
  EquipmentCategories,
  IEquipment,
} from '@/app/crm/equipment/types/equipment.types';
import { ThumbnailHoverPopper } from '@/components/UI/ThumbnailPopover';

type Order = 'asc' | 'desc';
type SortKey = keyof IEquipment | 'category' | 'brand' | 'model' | 'created_at';

interface Column {
  id: SortKey | 'actions';
  label: string;
  minWidth?: number;
  align?: 'right' | 'left' | 'center';
  sortable?: boolean;
  format?: (value: any, row: IEquipment) => React.ReactNode;
}

interface EquipmentTableProps {
  rows: IEquipment[];
  onDelete: (id: string, e: React.MouseEvent) => void;
  canManage?: boolean;
  /** tekst z nadrzędnego inputa wyszukiwarki */
  searchTerm?: string;
}

export const EquipmentTable: React.FC<EquipmentTableProps> = ({
  rows,
  onDelete,
  canManage,
}) => {
  const router = useRouter();

  const [order, setOrder] = React.useState<Order>('asc');
  const [orderBy, setOrderBy] = React.useState<SortKey>('name');
  const [page, setPage] = React.useState(0);
  // -1 = „Wszystko”
  const [rowsPerPage, setRowsPerPage] = React.useState<number>(10);

  const handleSort = (property: SortKey) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const handleChangePage = (_: unknown, newPage: number) => setPage(newPage);

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(event.target.value);
    setRowsPerPage(val);
    setPage(0);
  };

  const sortedRows = React.useMemo(() => {
    const getValue = (obj: any, key: SortKey) => {
      const val = obj[key];
      if (key === 'created_at' && val) return new Date(val).getTime();
      if (typeof val === 'string') return val.toLowerCase();
      return val ?? '';
    };

    return [...rows].sort((a, b) => {
      const valA = getValue(a, orderBy);
      const valB = getValue(b, orderBy);

      if (typeof valA === 'number' && typeof valB === 'number') {
        return order === 'asc' ? valA - valB : valB - valA;
      }
      return order === 'asc'
        ? String(valA).localeCompare(String(valB), 'pl', { sensitivity: 'base' })
        : String(valB).localeCompare(String(valA), 'pl', { sensitivity: 'base' });
    });
  }, [rows, order, orderBy]);

  // 3) PAGINUJEMY posortowane
  const pagedRows = React.useMemo(() => {
    if (rowsPerPage === -1) return sortedRows; // „Wszystko”
    const start = page * rowsPerPage;
    return sortedRows.slice(start, start + rowsPerPage);
  }, [sortedRows, page, rowsPerPage]);

  const columns: readonly Column[] = [
    {
      id: 'thumbnail_url',
      label: 'Podgląd',
      minWidth: 60,
      align: 'left',
      sortable: false,
      format: (_, row) => {
        const src = row.thumbnail_url
          ? row.thumbnail_url
          : null;
  
        return (
          <div
            style={{
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              borderRadius: 6,
            }}
          >
            <ThumbnailHoverPopper
              src={src}
              alt={row.name}
              size={36}       // miniaturka w komórce
              previewMax={260} // powiększenie w popoverze
            />
          </div>
        );
      },
    },
    { id: 'name', label: 'Nazwa', minWidth: 150, sortable: true },
    {
      id: 'brand',
      label: 'Marka',
      minWidth: 80,
      align: 'left',
      sortable: true,
      format: (v) =>
        v ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#0f1119] border border-[#d3bb73]/20 text-[#d3bb73] text-xs font-medium">
            {v}
          </span>
        ) : (
          <span className="text-[#e5e4e2]/40">–</span>
        ),
    },
    {
      id: 'model',
      label: 'Model',
      minWidth: 80,
      sortable: true,
      format: (v) => <span className="text-xs text-[#e5e4e2]/60">{v ?? '–'}</span>,
    },
    {
      id: 'category',
      label: 'Kategoria',
      minWidth: 160,
      sortable: true,
      format: (_, row) => {
        const mainLabel =
          (row.category &&
            EquipmentMainCategoryLabels[row.category as EquipmentMainCategory]) ||
          '–';
  
        const subLabel =
          row.category != null && row.subcategory != null
            ? EquipmentCategories[row.category as EquipmentMainCategory]?.[
                Number(row.subcategory)
              ] ?? row.subcategory
            : null;
  
        return (
          <div className="flex flex-wrap items-center text-xs text-[#e5e4e2]/60">
            <span>{mainLabel}</span>
            {subLabel && (
              <>
                <ChevronRight className="w-3 h-3 mx-1 opacity-70" />
                <span>{subLabel}</span>
              </>
            )}
          </div>
        );
      },
    },
    {
      id: 'created_at',
      label: 'Dodano',
      minWidth: 100,
      sortable: true,
      format: (v) => (
        <span className="text-xs text-[#e5e4e2]/60">
          {v ? new Date(v).toLocaleDateString('pl-PL') : '-'}
        </span>
      ),
    },
    {
      id: 'actions',
      label: 'Akcje',
      align: 'center',
      minWidth: 80,
      sortable: false,
      format: (_, row) => (
        <div className="flex items-center justify-center gap-1">
          <Tooltip title="Podgląd">
            <IconButton
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/crm/equipment/${row._id}`);
              }}
              size="small"
              sx={{ color: '#d3bb73' }}
            >
              <Eye size={15} />
            </IconButton>
          </Tooltip>
          {canManage && (
            <>
              <Tooltip title="Edytuj">
                <IconButton
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/crm/equipment/${row._id}/edit`);
                  }}
                  size="small"
                  sx={{ color: '#e5e4e2' }}
                >
                  <Edit size={15} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Usuń">
                <IconButton
                  onClick={(e) => onDelete(row._id, e)}
                  size="small"
                  sx={{ color: '#ff7777' }}
                >
                  <Trash2 size={15} />
                </IconButton>
              </Tooltip>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <Paper
      sx={{
        width: '100%',
        overflow: 'hidden',
        backgroundColor: '#1c1f33',
        color: '#e5e4e2',
        border: '1px solid rgba(211,187,115,0.1)',
      }}
    >
      <TableContainer sx={{ maxHeight: 'calc(100vh - 390px)' }}>
        <Table stickyHeader>
          <TableHead>
            <TableRow sx={{ height: 50 }}>
              {columns.map((col) => (
                <TableCell
                  key={col.id}
                  align={col.align ?? 'left'}
                  sx={{
                    height: 40,
                    lineHeight: '50px',
                    backgroundColor: '#0f1119',
                    color: '#d3bb73',
                    fontWeight: 600,
                    minWidth: col.minWidth,
                    borderBottom: '1px solid rgba(211,187,115,0.1)',
                    py: 0,
                  }}
                >
                  {col.sortable ? (
                    <TableSortLabel
                      active={orderBy === col.id}
                      direction={orderBy === col.id ? order : 'asc'}
                      onClick={() => handleSort(col.id as SortKey)}
                      sx={{
                        color: '#d3bb73',
                        '&:hover': { color: '#f1d97c' },
                        '&.Mui-active': { color: '#f1d97c' },
                        '& .MuiTableSortLabel-icon': {
                          color: '#f1d97c !important',
                          opacity: 1,
                        },
                        '&:hover .MuiTableSortLabel-icon': {
                          color: '#f1d97c !important',
                          opacity: 1,
                        },
                      }}
                    >
                      {col.label}
                    </TableSortLabel>
                  ) : (
                    col.label
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>

          <TableBody>
            {pagedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} align="center" sx={{ color: '#e5e4e2', py: 3 }}>
                  Brak sprzętu
                </TableCell>
              </TableRow>
            ) : (
              pagedRows.map((row) => (
                <TableRow
                  hover
                  key={row._id}
                  onClick={() => router.push(`/crm/equipment/${row._id}`)}
                  sx={{
                    height: 50,
                    cursor: 'pointer',
                    '&:hover': { backgroundColor: 'rgba(211,187,115,0.06)' },
                  }}
                >
                  {columns.map((col) => {
                    const value = (row as any)[col.id];
                    return (
                      <TableCell
                        key={col.id}
                        align={col.align ?? 'left'}
                        sx={{
                          height: 50,
                          lineHeight: '50px',
                          borderBottom: '1px solid rgba(211,187,115,0.05)',
                          color: '#e5e4e2',
                          fontSize: '0.82rem',
                          py: 0,
                        }}
                      >
                        {col.format ? col.format(value, row) : (value ?? '-')}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        rowsPerPageOptions={[10, 25, 50, 100, { label: 'Wszystko', value: -1 }]}
        component="div"
        count={sortedRows.length}
        rowsPerPage={rowsPerPage}
        page={rowsPerPage === -1 ? 0 : page}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
        labelRowsPerPage="Wierszy na stronę:"
        labelDisplayedRows={({ from, to, count }) =>
          rowsPerPage === -1 ? `1–${count} z ${count}` : `${from}–${to} z ${count}`
        }
        sx={{
          color: '#e5e4e2',
          backgroundColor: '#0f1119',
          borderTop: '1px solid rgba(211,187,115,0.1)',
          '& .MuiTablePagination-select': {
            color: '#e5e4e2',
            backgroundColor: '#1c1f33',
            borderRadius: '6px',
            border: '1px solid rgba(211,187,115,0.2)',
          },
          '& .MuiTablePagination-selectIcon': {
            color: '#d3bb73',
          },
        }}
        SelectProps={{
          MenuProps: {
            PaperProps: {
              sx: {
                backgroundColor: '#1c1f33',
                color: '#e5e4e2',
                border: '1px solid rgba(211,187,115,0.2)',
                '& .MuiMenuItem-root:hover': {
                  backgroundColor: 'rgba(211,187,115,0.1)',
                },
                '& .Mui-selected': {
                  backgroundColor: 'rgba(211,187,115,0.15) !important',
                },
              },
            },
          },
        }}
      />
    </Paper>
  );
};
