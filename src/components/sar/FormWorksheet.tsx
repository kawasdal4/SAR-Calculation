'use client';

import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';

/**
 * Authentic-looking IAMSAR worksheet form.
 * Renders a blank form with fill lines and boxes, just like the original
 * IAMSAR Manual worksheet paper. Values are auto-filled from the calculation
 * results, shown in green monospace so trainees can see the answer.
 *
 * Visible both on screen (web preview) and in print.
 */

export interface FormField {
  num?: string;
  label: string;
  value?: string | number;
  unit?: string;
  result?: boolean;
  header?: boolean;
  subFields?: FormField[];
}

export interface FormSection {
  title?: string;
  fields: FormField[];
}

export interface FormWorksheetProps {
  title: string;
  reference: string;
  meta?: Array<{ label: string; value?: string }>;
  sections: FormSection[];
  footer?: string;
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
    <div className="iamsar-form print-break-inside-avoid mb-4">
      {/* Header bar */}
      <div className="iamsar-form-header">
        {title}
        <span style={{ float: 'right', fontSize: '9px', fontWeight: '400', color: '#64748b' }}>
          {reference}
        </span>
      </div>

      {/* Metadata (Case title, Case number, Date, etc.) */}
      {meta && meta.length > 0 && (
        <div className="iamsar-form-meta">
          <table>
            <tbody>
              {meta.map((m, i) => (
                <tr key={i}>
                  <td>{m.label}:</td>
                  <td>
                    {m.value ? (
                      <span style={{ fontFamily: 'Courier New, monospace', color: '#1e293b' }}>{m.value}</span>
                    ) : (
                      <span className="fill-line">&nbsp;</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Form sections */}
      {sections.map((section, si) => (
        <div key={si} className="iamsar-form-section">
          {section.title && (
            <div className="iamsar-form-section-title">{section.title}</div>
          )}
          {section.fields.map((field, fi) => (
            <FormRow key={fi} field={field} />
          ))}
        </div>
      ))}

      {/* Additional content (observation tables, etc.) */}
      {children && (
        <div className="iamsar-form-section">
          {children}
        </div>
      )}

      {/* Footer */}
      {footer && (
        <div className="iamsar-form-footer">{footer}</div>
      )}
    </div>
  );
}

function FormRow({ field }: { field: FormField }) {
  if (field.header) {
    return (
      <div className="iamsar-form-row" style={{ fontWeight: 'bold', color: '#334155', borderBottom: '1px solid #94a3b8' }}>
        {field.num && <span className="row-num">{field.num}</span>}
        <span className="row-label">{field.label}</span>
      </div>
    );
  }

  const hasValue = field.value !== undefined && field.value !== '' && field.value !== null;
  const displayValue = typeof field.value === 'number' ? field.value.toString() : (field.value as string) || '';

  return (
    <>
      <div className={`iamsar-form-row ${field.result ? 'result' : ''}`}>
        <span className="row-num">{field.num || ''}</span>
        <span className="row-label">{field.label}</span>
        {hasValue ? (
          <span className={`row-value filled`}>
            {displayValue}
            {field.unit && <span className="unit">{field.unit}</span>}
          </span>
        ) : (
          <span className="row-blank" />
        )}
      </div>
      {field.subFields && field.subFields.map((sub, si) => (
        <FormRow key={si} field={sub} />
      ))}
    </>
  );
}
