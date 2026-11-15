'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Authentic-looking IAMSAR worksheet form.
 * Renders a blank form with dotted fill lines, just like the original
 * IAMSAR Manual worksheet. Values are auto-filled from the calculation
 * results, shown in a distinct colour so trainees can see the answer.
 *
 * Designed to be printable (A4 / A3 portrait).
 */

export interface FormField {
  /** Line number or section letter (e.g., "1", "A", "2.a"). */
  num?: string;
  /** Label text. */
  label: string;
  /** Auto-filled value (from calculation). Empty string = blank. */
  value?: string | number;
  /** Unit suffix (e.g., "°T", "kts", "NM"). */
  unit?: string;
  /** Highlight as a result (bold green). */
  result?: boolean;
  /** Full-width row (no value column, for section headers). */
  header?: boolean;
  /** Sub-items under this field (for nested rows like A.1, A.2). */
  subFields?: FormField[];
}

export interface FormSection {
  /** Section title (e.g., "A. Starting Position"). */
  title?: string;
  fields: FormField[];
}

export interface FormWorksheetProps {
  /** Worksheet title (e.g., "Average Wind Aloft (AWA)"). */
  title: string;
  /** Reference (e.g., "Appendix K-10"). */
  reference: string;
  /** Top metadata fields (Case title, Case number, Date, etc.). */
  meta?: Array<{ label: string; value?: string }>;
  /** Form sections. */
  sections: FormSection[];
  /** Footer note. */
  footer?: string;
  /** Additional content (e.g., observation table). */
  children?: React.ReactNode;
}

export default function FormWorksheet({
  title,
  reference,
  meta,
  sections,
  footer,
  children,
}: FormWorksheetProps) {
  return (
    <Card className="border-slate-300 shadow-sm print:shadow-none print:border-slate-400 print-break-inside-avoid">
      <CardHeader className="bg-slate-100 pb-2 print:bg-white print:border-b print:border-slate-400">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold tracking-tight">{title}</CardTitle>
          <span className="text-[9px] text-slate-500 font-mono">{reference}</span>
        </div>
      </CardHeader>
      <CardContent className="pt-3 print:pt-2">
        {/* Metadata header (Case title, Case number, etc.) */}
        {meta && meta.length > 0 && (
          <div className="mb-3 border border-slate-300 rounded">
            <table className="w-full text-[10px]">
              <tbody>
                {meta.map((m, i) => (
                  <tr key={i} className="border-b border-slate-200 last:border-0">
                    <td className="px-2 py-1 font-medium text-slate-600 whitespace-nowrap border-r border-slate-200 bg-slate-50">
                      {m.label}
                    </td>
                    <td className="px-2 py-1">
                      <span className="font-mono text-slate-800">{m.value || ''}</span>
                      {!m.value && <span className="text-slate-300">{'─'.repeat(40)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Form sections */}
        {sections.map((section, si) => (
          <div key={si} className="mb-3">
            {section.title && (
              <div className="text-[11px] font-bold text-slate-700 border-b border-slate-300 pb-0.5 mb-1.5">
                {section.title}
              </div>
            )}
            <table className="w-full text-[10px]">
              <tbody>
                {section.fields.map((field, fi) => (
                  <FormRow key={fi} field={field} />
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {/* Additional content (observation tables, etc.) */}
        {children}

        {/* Footer */}
        {footer && (
          <div className="mt-3 pt-2 border-t border-slate-200 text-[9px] text-slate-500 italic">
            {footer}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FormRow({ field }: { field: FormField }) {
  if (field.header) {
    return (
      <tr>
        <td colSpan={3} className="py-1 font-bold text-slate-700 text-[10px]">
          {field.num && <span className="mr-1">{field.num}</span>}
          {field.label}
        </td>
      </tr>
    );
  }

  const hasValue = field.value !== undefined && field.value !== '' && field.value !== null;
  const displayValue = typeof field.value === 'number' ? field.value.toString() : field.value || '';

  return (
    <>
      <tr className="border-b border-dotted border-slate-200">
        <td className="py-1 pr-1 font-medium text-slate-600 whitespace-nowrap align-baseline" style={{ width: '24px' }}>
          {field.num || ''}
        </td>
        <td className="py-1 pr-2 text-slate-600 align-baseline">
          {field.label}
        </td>
        <td className="py-1 text-right align-baseline" style={{ minWidth: '100px' }}>
          {hasValue ? (
            <span className={cn(
              'font-mono font-semibold',
              field.result ? 'text-emerald-700' : 'text-slate-800',
            )}>
              {displayValue}
              {field.unit && <span className="text-slate-500 font-normal ml-1 text-[9px]">{field.unit}</span>}
            </span>
          ) : (
            <span className="text-slate-300 select-none">{'─'.repeat(12)}</span>
          )}
        </td>
      </tr>
      {field.subFields && field.subFields.map((sub, si) => (
        <FormRow key={si} field={sub} />
      ))}
    </>
  );
}
