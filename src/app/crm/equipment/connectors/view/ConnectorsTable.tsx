import { useRouter } from 'next/navigation';

import { useMemo, useState } from 'react';
import { CheckCircle, Edit, PlugIcon, Trash2, XCircle } from 'lucide-react';
import { Input, Output, SyncAlt } from '@mui/icons-material';
import {
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  Tooltip,
} from '@mui/material';
import { ConnectorCategoryOptions, IConnectorType } from '../connector.type';
import { ThumbnailHoverPopper } from '@/components/UI/ThumbnailPopover';

type SortKey = 'name' | 'description' | 'is_active' | 'created_at' | 'direction' | 'category';
type Order = 'asc' | 'desc';

interface Column {
  id: SortKey | 'actions';
  label: string;
  minWidth?: number;
  align?: 'right' | 'left' | 'center';
  sortable?: boolean;
  format?: (value: any, row: IConnectorType) => React.ReactNode;
}

export const ConnectorsTable: React.FC<{
  rows: IConnectorType[];
  onEdit: (row: IConnectorType, e: React.MouseEvent) => void;
  onDelete: (_id: string, e: React.MouseEvent) => void;
  canManage: boolean;
}> = ({ rows, onEdit, onDelete, canManage }) => {
  const router = useRouter();
  const [order, setOrder] = useState<Order>('asc');
  const [orderBy, setOrderBy] = useState<SortKey>('name');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState<number>(25);

  const handleSort = (property: SortKey) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };
  const handleChangePage = (_: unknown, newPage: number) => setPage(newPage);
  const handleChangeRowsPerPage = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(Number(e.target.value));
    setPage(0);
  };

  const sorted = useMemo(() => {
    const getVal = (r: IConnectorType, k: SortKey) => {
      const v = (r as any)[k];
      if (k === 'created_at' && v) return new Date(v).getTime();
      if (typeof v === 'string') return v.toLowerCase();
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v ?? '';
    };
    return [...rows].sort((a, b) => {
      const va = getVal(a, orderBy);
      const vb = getVal(b, orderBy);
      if (typeof va === 'number' && typeof vb === 'number')
        return order === 'asc' ? va - vb : vb - va;
      return order === 'asc'
        ? String(va).localeCompare(String(vb), 'pl', { sensitivity: 'base' })
        : String(vb).localeCompare(String(va), 'pl', { sensitivity: 'base' });
    });
  }, [rows, order, orderBy]);

  const paged = useMemo(() => {
    if (rowsPerPage === -1) return sorted;
    const start = page * rowsPerPage;
    return sorted.slice(start, start + rowsPerPage);
  }, [sorted, page, rowsPerPage]);

  const columns: readonly Column[] = [
    {
      id: 'name',
      label: 'Nazwa',
      minWidth: 180,
      sortable: true,
      format: (v, row) => {
        const thumbnailUrl = row.thumbnail_url
          ? row.thumbnail_url
          : null;
        return thumbnailUrl ? (
          <div className="flex items-center gap-2">
            <ThumbnailHoverPopper src={row.thumbnail_url} alt={row.name} size={36} previewMax={260} />
            <span className="text-[#e5e4e2]">{row.name}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <PlugIcon className="h-4 w-4 text-[#d3bb73]" />
            <span className="text-[#e5e4e2]">{row.name}</span>
          </div>
        );
      },
    },
    {
      id: 'is_active',
      label: 'Status',
      minWidth: 100,
      align: 'center',
      sortable: true,
      format: (v: boolean) =>
        v ? (
          <span className="inline-flex items-center gap-1 rounded bg-green-900/20 px-2 py-1 text-xs text-green-400">
            <CheckCircle className="h-3.5 w-3.5" /> Aktywna
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded bg-red-900/20 px-2 py-1 text-xs text-red-400">
            <XCircle className="h-3.5 w-3.5" /> Nieaktywna
          </span>
        ),
    },
    {
      id: 'direction',
      label: 'Kierunek',
      minWidth: 100,
      align: 'center',
      sortable: true,
      format: (v: string) => {
        if (v === 'input') {
          return <div className="flex items-center gap-1">IN<Input color="success" titleAccess="Wejście" /></div>;
        } else if (v === 'output') {
          return <div className="flex items-center gap-1"><Output color="info" titleAccess="Wyjście" /> OUT</div>;
        } else if (v === 'bidirectional') {
          return <div className="flex items-center gap-1">IN<SyncAlt color="warning" titleAccess="Dwukierunkowe" />OUT</div>;
        }
        return null;
      },
    },
    {
      id: 'category',
      label: 'Rodzaj',
      minWidth: 120,
      sortable: true,
      format: (v) => (
        <span className="text-xs text-[#e5e4e2]/60">
          {v ? ConnectorCategoryOptions.find((c) => c.value === v)?.label : '—'}
        </span>
      ),
    },
    {
      id: 'actions',
      label: 'Akcje',
      align: 'center',
      minWidth: 80,
      sortable: false,
      format: (_, row) =>
        canManage ? (
          <div className="flex items-center justify-end gap-1">
            <Tooltip title="Edytuj">
              <IconButton onClick={(e) => onEdit(row, e)} size="small" sx={{ color: '#e5e4e2' }}>
                <Edit size={16} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Usuń">
              <IconButton
                onClick={(e) => onDelete(row._id, e)}
                size="small"
                sx={{ color: '#ff7777' }}
              >
                <Trash2 size={16} />
              </IconButton>
            </Tooltip>
          </div>
        ) : null,
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
              {columns.map((c) => (
                <TableCell
                  key={c.id}
                  align={c.align ?? 'left'}
                  sx={{
                    height: 50,
                    lineHeight: '50px',
                    backgroundColor: '#0f1119',
                    color: '#d3bb73',
                    fontWeight: 600,
                    minWidth: c.minWidth,
                    borderBottom: '1px solid rgba(211,187,115,0.1)',
                    py: 0,
                  }}
                >
                  {c.sortable ? (
                    <TableSortLabel
                      active={orderBy === c.id}
                      direction={orderBy === c.id ? order : 'asc'}
                      onClick={() => handleSort(c.id as SortKey)}
                      sx={{
                        color: '#d3bb73',
                        '&:hover': { color: '#f1d97c' },
                        '&.Mui-active': { color: '#f1d97c' },
                        '& .MuiTableSortLabel-icon': { color: '#f1d97c !important', opacity: 1 },
                        '&:hover .MuiTableSortLabel-icon': {
                          color: '#f1d97c !important',
                          opacity: 1,
                        },
                      }}
                    >
                      {c.label}
                    </TableSortLabel>
                  ) : (
                    c.label
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>

          <TableBody>
            {paged.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} align="center" sx={{ color: '#e5e4e2', py: 3 }}>
                  Brak Wtyków
                </TableCell>
              </TableRow>
            ) : (
              paged.map((row) => (
                <TableRow
                  key={row._id}
                  hover
                  sx={{
                    height: 50,
                    cursor: 'default',
                    '&:hover': { backgroundColor: 'rgba(211,187,115,0.06)' },
                  }}
                >
                  {columns.map((c) => {
                    const val = (row as any)[c.id];
                    return (
                      <TableCell
                        key={c.id}
                        align={c.align ?? 'left'}
                        sx={{
                          height: 50,
                          lineHeight: '50px',
                          borderBottom: '1px solid rgba(211,187,115,0.05)',
                          color: '#e5e4e2',
                          fontSize: '0.86rem',
                          py: 0,
                        }}
                      >
                        {c.format ? c.format(val, row) : (val ?? '—')}
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
        count={sorted.length}
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
          '& .MuiTablePagination-selectIcon': { color: '#d3bb73' },
        }}
        SelectProps={{
          MenuProps: {
            PaperProps: {
              sx: {
                backgroundColor: '#1c1f33',
                color: '#e5e4e2',
                border: '1px solid rgba(211,187,115,0.2)',
                '& .MuiMenuItem-root:hover': { backgroundColor: 'rgba(211,187,115,0.1)' },
                '& .Mui-selected': { backgroundColor: 'rgba(211,187,115,0.15) !important' },
              },
            },
          },
        }}
      />
    </Paper>
  );
};
