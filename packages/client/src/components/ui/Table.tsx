import React from 'react';

interface Column<T> { key: string; label: string; render?: (item: T) => React.ReactNode; width?: string; }
interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyField: string;
  onRowClick?: (item: T) => void;
  className?: string;
}

export function Table<T extends Record<string, any>>({ columns, data, keyField, onRowClick, className = '' }: TableProps<T>) {
  return (
    <div className={`overflow-auto ${className}`}>
      <table className="w-full text-xs font-mono" role="table">
        <thead>
          <tr className="border-b border-forge-border">
            {columns.map((col) => (
              <th key={col.key} className="px-3 py-2 text-left text-[10px] tracking-wider text-forge-text-dim uppercase font-normal" style={{ width: col.width }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item) => (
            <tr
              key={item[keyField]}
              onClick={() => onRowClick?.(item)}
              className={`border-b border-forge-border/30 ${onRowClick ? 'cursor-pointer hover:bg-forge-cyan/5' : ''} transition-colors`}
            >
              {columns.map((col) => (
                <td key={col.key} className="px-3 py-2 text-forge-text">
                  {col.render ? col.render(item) : item[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
