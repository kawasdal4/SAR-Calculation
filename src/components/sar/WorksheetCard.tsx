'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDir, formatNumber } from '@/lib/sar/sarCalculations';

interface NumberInputProps {
  value: number;
  onChange: (val: number) => void;
  placeholder?: string;
  step?: string;
}

function NumberInput({ value, onChange, placeholder, step = 'any' }: NumberInputProps) {
  return (
    <Input
      type="number"
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      placeholder={placeholder}
      step={step}
      className="h-8 w-full"
    />
  );
}

interface WorksheetCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  badge?: string;
}

export function WorksheetCard({ title, description, children, badge }: WorksheetCardProps) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="bg-slate-50 rounded-t-lg pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base font-semibold text-slate-800">{title}</CardTitle>
            {description && (
              <CardDescription className="text-xs text-slate-500 mt-1">
                {description}
              </CardDescription>
            )}
          </div>
          {badge && (
            <span className="text-[10px] font-mono px-2 py-1 rounded bg-slate-800 text-white whitespace-nowrap">
              {badge}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">{children}</CardContent>
    </Card>
  );
}

export { NumberInput };
