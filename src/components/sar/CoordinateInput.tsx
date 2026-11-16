'use client';

import { useEffect, useState } from 'react';
import { formatDMS, parseCoordinate, type CoordAxis } from '@/lib/sar/coordFormat';

interface CoordinateInputProps {
  axis: CoordAxis;
  value: number;
  onChange: (value: number) => void;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

/** Accepts decimal degrees, degrees/minutes, or DMS and displays canonical DMS. */
export default function CoordinateInput({ axis, value, onChange, className, ...rest }: CoordinateInputProps) {
  const canonical = formatDMS(value, axis === 'lng');
  const [draft, setDraft] = useState(canonical);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(canonical);
  }, [canonical, editing]);

  return (
    <input
      {...rest}
      type="text"
      disabled={rest.disabled}
      inputMode="text"
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        const parsed = parseCoordinate(next, axis);
        if (parsed !== null) onChange(parsed);
      }}
      onBlur={() => {
        setEditing(false);
        const parsed = parseCoordinate(draft, axis);
        if (parsed !== null) {
          onChange(parsed);
          setDraft(formatDMS(parsed, axis === 'lng'));
        } else {
          setDraft(canonical);
        }
      }}
      className={className ?? 'flex h-8 w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500'}
      placeholder={axis === 'lat' ? '06°05′00″S / -6.08' : '106°45′00″E / 106.75'}
    />
  );
}
