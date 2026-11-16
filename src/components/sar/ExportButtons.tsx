'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileText, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { renderSearchActionPlanText, type SearchActionPlanData } from '@/lib/sar/searchActionPlan';
import { formatDMS } from '@/lib/sar/coordFormat';

interface ExportButtonsProps {
  data: SearchActionPlanData | null;
  caseTitle?: string;
}

export default function ExportButtons({ data, caseTitle }: ExportButtonsProps) {
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);

  const safeName = (caseTitle || 'SAR Search Action Plan').replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'SAR_Search_Action_Plan';

  const handlePdf = async () => {
    if (!data) {
      toast.error('No search plan to export — complete the worksheets first.');
      return;
    }
    setBusy('pdf');
    try {
      // Small delay so the spinner shows even on fast exports
      await new Promise((r) => setTimeout(r, 50));
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
      const margin = 40;
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const maxWidth = pageWidth - margin * 2;

      // Title block
      pdf.setFillColor(15, 23, 42); // slate-900
      pdf.rect(0, 0, pageWidth, 60, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(14);
      pdf.text('IAMSAR Search Action Plan', margin, 28);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.text(`Appendix L-23  •  ${data.messageDateTime}`, margin, 44);
      pdf.setFontSize(8);
      pdf.text(data.searchObjectId, pageWidth - margin, 32, { align: 'right' });
      pdf.text(`(${data.flagState}) ${data.emergencyPhase}`, pageWidth - margin, 44, { align: 'right' });

      let y = 80;
      pdf.setTextColor(15, 23, 42);

      const addHeading = (text: string) => {
        if (y > pageHeight - 60) {
          pdf.addPage();
          y = margin;
        }
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11);
        pdf.setTextColor(5, 102, 71); // emerald-800
        pdf.text(text, margin, y);
        y += 6;
        pdf.setDrawColor(5, 102, 71);
        pdf.setLineWidth(0.8);
        pdf.line(margin, y, pageWidth - margin, y);
        y += 12;
        pdf.setTextColor(15, 23, 42);
      };

      const addLine = (label: string, value: string) => {
        if (y > pageHeight - 30) {
          pdf.addPage();
          y = margin;
        }
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.text(label, margin, y);
        pdf.setFont('helvetica', 'normal');
        const wrapped = pdf.splitTextToSize(value, maxWidth - 130);
        pdf.text(wrapped, margin + 130, y);
        y += Math.max(14, wrapped.length * 11);
      };

      const addParagraph = (text: string) => {
        if (y > pageHeight - 30) {
          pdf.addPage();
          y = margin;
        }
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        const wrapped = pdf.splitTextToSize(text, maxWidth);
        pdf.text(wrapped, margin, y);
        y += wrapped.length * 11 + 4;
      };

      // Section 1 — Situation
      addHeading('1   SITUATION');
      addLine('A   Summary', data.situationSummary);
      addLine('B   Description of craft', data.descriptionOfCraft);
      addLine('C   Persons on board', String(data.personsOnBoard));
      addLine('D   Primary search object', data.primarySearchObject);
      addLine('    Secondary search object', data.secondarySearchObject);
      addLine(
        'E   On-scene weather',
        `Forecast period: ${data.weatherForecastPeriod}\nCeiling: ${data.weatherCeiling}\nVisibility: ${data.weatherVisibility}\nWind: ${data.weatherWind}\nSeas: ${data.weatherSeas}`,
      );

      // Section 2 — Action
      addHeading('2   ACTION');
      data.actions.forEach((a, i) => {
        addLine(`   ${String.fromCharCode(65 + i)} (${a.agency})`, a.tasking);
      });

      // Section 3 — Search Areas
      addHeading('3   SEARCH AREAS');
      autoTable(pdf, {
        startY: y,
        head: [['Area', 'Corner Point 1', 'Corner Point 2', 'Corner Point 3', 'Corner Point 4', 'Size (NM²)'],
        ],
        body: data.searchAreas.map((a) => [
          a.designation,
          fmtLL(a.cornerPoints[0]),
          a.cornerPoints[1] ? fmtLL(a.cornerPoints[1]) : '',
          a.cornerPoints[2] ? fmtLL(a.cornerPoints[2]) : '',
          a.cornerPoints[3] ? fmtLL(a.cornerPoints[3]) : '',
          a.sizeNm2 != null ? a.sizeNm2.toFixed(0) : '',
        ]),
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [5, 102, 71], textColor: 255, fontStyle: 'bold' },
        margin: { left: margin, right: margin },
      });
      // @ts-expect-error — lastAutoTable is added by the autotable plugin
      y = pdf.lastAutoTable.finalY + 18;

      // Section 4 — Execution
      addHeading('4   EXECUTION (altitudes in feet)');
      autoTable(pdf, {
        startY: y,
        head: [['Area', 'SAR Facility', 'Location', 'Pattern', 'Creep', 'CSP', 'Alt']],
        body: data.execution.map((e) => [
          e.area,
          e.facility,
          e.location,
          e.pattern,
          e.creep,
          fmtLL(e.commenceSearchPoint),
          e.altitude,
        ]),
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [5, 102, 71], textColor: 255, fontStyle: 'bold' },
        margin: { left: margin, right: margin },
      });
      // @ts-expect-error
      y = pdf.lastAutoTable.finalY + 18;

      // Section 5 — Coordination
      addHeading('5   CO-ORDINATION INSTRUCTIONS');
      addLine('A   SMC', data.smc);
      addLine('B   OSC', data.osc);
      addLine('C   Search commences', data.startTime);
      addLine('D   Track spacing', data.trackSpacing);
      addLine('    Max aircraft speed', data.maxAircraftSpeed);
      addLine('E   OSC authorizations', data.oscAuthorizations);
      if (data.otherCoordination) {
        addLine('F   Other', data.otherCoordination);
      }

      // Section 6 — Communications
      addHeading('6   COMMUNICATIONS');
      addLine('A   Control channel (primary)', data.controlChannelPrimary);
      addLine('    Control channel (secondary)', data.controlChannelSecondary);
      addLine('B   On-scene (primary)', data.onScenePrimary);
      addLine('    On-scene (secondary)', data.onSceneSecondary);
      addLine('C   Air/ground (primary)', data.airGroundPrimary);
      addLine('    Air/ground (secondary)', data.airGroundSecondary);
      addLine('D   Air/air (primary)', data.airAirPrimary);
      addLine('    Air/air (secondary)', data.airAirSecondary);

      // Section 7 — Reports
      addHeading('7   REPORTS');
      addParagraph(`A   (OSC SITREP schedule) ${data.oscReportInstructions}`);
      addParagraph(`B   (Facility reporting instructions) ${data.facilityReportInstructions}`);
      addParagraph(`C   (Parent activity reports) ${data.parentActivityReports}`);

      // Worksheet summary page
      pdf.addPage();
      y = margin;
      addHeading('WORKSHEET SUMMARY');
      const s = data.summary;
      autoTable(pdf, {
        startY: y,
        head: [['Parameter', 'Value']],
        body: [
          ['LKP (Lat, Lon)', `${formatDMS(s.lkp.lat, false)}, ${formatDMS(s.lkp.lng, true)}`],
          ['Datum (Left of Downwind)', `${formatDMS(s.datumLeft.lat, false)}, ${formatDMS(s.datumLeft.lng, true)}`],
          ['Datum (Right of Downwind)', `${formatDMS(s.datumRight.lat, false)}, ${formatDMS(s.datumRight.lng, true)}`],
          ['Drift Distance (NM)', s.driftDistanceNm.toFixed(2)],
          ['Divergence Distance DD (NM)', s.divergenceDistanceNm.toFixed(2)],
          ['Total Probable Error E (NM)', s.E_nm.toFixed(2)],
          ['Total Search Effort Zta (NM²)', s.Zta_nm2.toFixed(0)],
          ['Optimal Search Radius Ro (NM)', s.Ro_nm.toFixed(2)],
          ['Optimal Search Area Ao (NM²)', s.Ao_nm2.toFixed(0)],
          ['Coverage Factor C', s.coverageFactor.toFixed(2)],
          ['POD (%)', s.POD_pct.toFixed(1)],
          ['Track Spacing S (NM)', s.trackSpacing_nm.toFixed(2)],
          ['Search Area L × W (NM)', `${s.searchAreaLength_nm.toFixed(1)} × ${s.searchAreaWidth_nm.toFixed(1)}`],
          ['ASW Direction (°T, from)', s.aswDirFrom.toFixed(1)],
          ['ASW Speed (kts)', s.aswSpeedKts.toFixed(2)],
          ['AWA Direction (°T, from) — ref', s.awaDirFrom.toFixed(1)],
          ['AWA Speed (kts) — ref', s.awaSpeedKts.toFixed(2)],
          ['TWC Set/Drift (°T / kts)', `${s.twcDir.toFixed(1)} / ${s.twcSpeed.toFixed(3)}`],
          ['Leeway Left (°T)', s.lwLeftDir.toFixed(1)],
          ['Leeway Right (°T)', s.lwRightDir.toFixed(1)],
          ['Leeway Speed (kts)', s.lwSpeed.toFixed(3)],
        ],
        styles: { fontSize: 9, cellPadding: 5 },
        headStyles: { fillColor: [5, 102, 71], textColor: 255, fontStyle: 'bold' },
        columnStyles: { 0: { cellWidth: 220 }, 1: { cellWidth: 'auto' } },
        margin: { left: margin, right: margin },
      });

      // Plain-text appendix on its own page
      pdf.addPage();
      y = margin;
      addHeading('PLAIN-TEXT MESSAGE (Appendix L-23)');
      pdf.setFont('courier', 'normal');
      pdf.setFontSize(8);
      const plainText = renderSearchActionPlanText(data);
      const textLines = pdf.splitTextToSize(plainText, maxWidth);
      // Render line by line so we can paginate
      for (const line of textLines) {
        if (y > pageHeight - 20) {
          pdf.addPage();
          y = margin;
        }
        pdf.text(line, margin, y);
        y += 10;
      }

      // Metadata
      pdf.setProperties({
        title: `IAMSAR Search Action Plan — ${data.searchObjectId}`,
        subject: 'Search Action Plan (IAMSAR Manual Vol. II Appendix L-23)',
        author: 'IAMSAR Mission Co-ordinator Workbench',
        creator: 'Z.ai IAMSAR Workbench',
      });

      pdf.save(`${safeName}.pdf`);
      toast.success(`Exported ${safeName}.pdf`);
    } catch (e) {
      toast.error('PDF export failed', { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const handleXlsx = async () => {
    if (!data) {
      toast.error('No search plan to export — complete the worksheets first.');
      return;
    }
    setBusy('xlsx');
    try {
      await new Promise((r) => setTimeout(r, 50));
      const wb = XLSX.utils.book_new();

      // Sheet 1: Header / Situation
      const headerRows: (string | number)[][] = [
        ['IAMSAR SEARCH ACTION PLAN'],
        ['Appendix L-23 — IAMSAR Manual Volume II (2016)'],
        [],
        ['Message DTG', data.messageDateTime],
        ['From (RCC)', data.fromRcc],
        ['To', data.toRecipients.join('; ')],
        ['Info', data.infoAgencies.join('; ')],
        [],
        ['Emergency Phase', data.emergencyPhase],
        ['Search Object', data.searchObjectId],
        ['Flag State', data.flagState],
        ['Cause', data.causeDescription],
        ['General Location', data.generalLocation],
        ['Search Date', data.searchDate],
        [],
        ['1. SITUATION'],
        ['A. Summary', data.situationSummary],
        ['B. Description', data.descriptionOfCraft],
        ['C. Persons on Board', data.personsOnBoard],
        ['D. Primary Search Object', data.primarySearchObject],
        ['   Secondary', data.secondarySearchObject],
        ['E. Forecast period', data.weatherForecastPeriod],
        ['   Ceiling', data.weatherCeiling],
        ['   Visibility', data.weatherVisibility],
        ['   Wind', data.weatherWind],
        ['   Seas', data.weatherSeas],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(headerRows);
      ws1['!cols'] = [{ wch: 28 }, { wch: 60 }];
      XLSX.utils.book_append_sheet(wb, ws1, 'Situation');

      // Sheet 2: Action
      const actionRows: (string | number)[][] = [
        ['Section 2 — Action'],
        ['Agency', 'Tasking'],
        ...data.actions.map((a) => [a.agency, a.tasking]),
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(actionRows);
      ws2['!cols'] = [{ wch: 30 }, { wch: 80 }];
      XLSX.utils.book_append_sheet(wb, ws2, 'Action');

      // Sheet 3: Search Areas
      const areaRows: (string | number)[][] = [
        ['Section 3 — Search Areas'],
        ['Designation', 'Corner 1 Lat', 'Corner 1 Lng', 'Corner 2 Lat', 'Corner 2 Lng', 'Corner 3 Lat', 'Corner 3 Lng', 'Corner 4 Lat', 'Corner 4 Lng', 'Size (NM²)'],
        ...data.searchAreas.map((a) => {
          const c = a.cornerPoints;
          return [
            a.designation,
            c[0]?.lat ?? '',
            c[0]?.lng ?? '',
            c[1]?.lat ?? '',
            c[1]?.lng ?? '',
            c[2]?.lat ?? '',
            c[2]?.lng ?? '',
            c[3]?.lat ?? '',
            c[3]?.lng ?? '',
            a.sizeNm2 != null ? a.sizeNm2.toFixed(0) : '',
          ];
        }),
      ];
      const ws3 = XLSX.utils.aoa_to_sheet(areaRows);
      XLSX.utils.book_append_sheet(wb, ws3, 'Search Areas');

      // Sheet 4: Execution
      const execRows: (string | number)[][] = [
        ['Section 4 — Execution'],
        ['Area', 'SAR Facility', 'Location', 'Pattern', 'Creep', 'CSP Lat', 'CSP Lng', 'Altitude'],
        ...data.execution.map((e) => [
          e.area,
          e.facility,
          e.location,
          e.pattern,
          e.creep,
          formatDMS(e.commenceSearchPoint.lat, false),
          formatDMS(e.commenceSearchPoint.lng, true),
          e.altitude,
        ]),
      ];
      const ws4 = XLSX.utils.aoa_to_sheet(execRows);
      XLSX.utils.book_append_sheet(wb, ws4, 'Execution');

      // Sheet 5: Coordination & Comms
      const coordRows: (string | number)[][] = [
        ['Section 5 — Coordination'],
        ['SMC', data.smc],
        ['OSC', data.osc],
        ['Search commences', data.startTime],
        ['Track spacing', data.trackSpacing],
        ['Max aircraft speed', data.maxAircraftSpeed],
        ['OSC authorizations', data.oscAuthorizations],
        ['Other', data.otherCoordination],
        [],
        ['Section 6 — Communications'],
        ['Control channel (primary)', data.controlChannelPrimary],
        ['Control channel (secondary)', data.controlChannelSecondary],
        ['On-scene (primary)', data.onScenePrimary],
        ['On-scene (secondary)', data.onSceneSecondary],
        ['Air/ground (primary)', data.airGroundPrimary],
        ['Air/ground (secondary)', data.airGroundSecondary],
        ['Air/air (primary)', data.airAirPrimary],
        ['Air/air (secondary)', data.airAirSecondary],
        [],
        ['Section 7 — Reports'],
        ['OSC SITREP schedule', data.oscReportInstructions],
        ['Facility reporting', data.facilityReportInstructions],
        ['Parent activity reports', data.parentActivityReports],
      ];
      const ws5 = XLSX.utils.aoa_to_sheet(coordRows);
      ws5['!cols'] = [{ wch: 32 }, { wch: 60 }];
      XLSX.utils.book_append_sheet(wb, ws5, 'Coord & Comms');

      // Sheet 6: Worksheet Summary
      const s = data.summary;
      const summaryRows: (string | number)[][] = [
        ['Worksheet Summary'],
        ['Parameter', 'Value', 'Unit'],
        ['LKP Latitude', formatDMS(s.lkp.lat, false), 'DMS'],
        ['LKP Longitude', formatDMS(s.lkp.lng, true), 'DMS'],
        ['Datum Left Latitude', formatDMS(s.datumLeft.lat, false), 'DMS'],
        ['Datum Left Longitude', formatDMS(s.datumLeft.lng, true), 'DMS'],
        ['Datum Right Latitude', formatDMS(s.datumRight.lat, false), 'DMS'],
        ['Datum Right Longitude', formatDMS(s.datumRight.lng, true), 'DMS'],
        ['Drift Distance', s.driftDistanceNm.toFixed(2), 'NM'],
        ['Divergence Distance DD', s.divergenceDistanceNm.toFixed(2), 'NM'],
        ['Total Probable Error E', s.E_nm.toFixed(2), 'NM'],
        ['Total Search Effort Zta', s.Zta_nm2.toFixed(0), 'NM²'],
        ['Optimal Search Radius Ro', s.Ro_nm.toFixed(2), 'NM'],
        ['Optimal Search Area Ao', s.Ao_nm2.toFixed(0), 'NM²'],
        ['Coverage Factor C', s.coverageFactor.toFixed(2), 'ratio'],
        ['POD', s.POD_pct.toFixed(1), '%'],
        ['Track Spacing S', s.trackSpacing_nm.toFixed(2), 'NM'],
        ['Search Area Length', s.searchAreaLength_nm.toFixed(1), 'NM'],
        ['Search Area Width', s.searchAreaWidth_nm.toFixed(1), 'NM'],
        ['ASW Direction (from)', s.aswDirFrom.toFixed(1), '°T'],
        ['ASW Speed', s.aswSpeedKts.toFixed(2), 'kts'],
        ['AWA Direction (ref, from)', s.awaDirFrom.toFixed(1), '°T'],
        ['AWA Speed (ref)', s.awaSpeedKts.toFixed(2), 'kts'],
        ['TWC Direction', s.twcDir.toFixed(1), '°T'],
        ['TWC Speed', s.twcSpeed.toFixed(3), 'kts'],
        ['Leeway Left Direction', s.lwLeftDir.toFixed(1), '°T'],
        ['Leeway Right Direction', s.lwRightDir.toFixed(1), '°T'],
        ['Leeway Speed', s.lwSpeed.toFixed(3), 'kts'],
      ];
      const ws6 = XLSX.utils.aoa_to_sheet(summaryRows);
      ws6['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, ws6, 'Worksheet Summary');

      XLSX.writeFile(wb, `${safeName}.xlsx`);
      toast.success(`Exported ${safeName}.xlsx`);
    } catch (e) {
      toast.error('Excel export failed', { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handlePdf}
        disabled={!data || busy !== null}
        className="h-8 bg-white/10 text-slate-100 border-white/15 hover:bg-white/20 hover:text-white"
      >
        {busy === 'pdf' ? (
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        ) : (
          <FileText className="h-3.5 w-3.5 mr-1.5" />
        )}
        PDF
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleXlsx}
        disabled={!data || busy !== null}
        className="h-8 bg-white/10 text-slate-100 border-white/15 hover:bg-white/20 hover:text-white"
      >
        {busy === 'xlsx' ? (
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        ) : (
          <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
        )}
        Excel
      </Button>
    </div>
  );
}

function fmtLL(p: { lat: number; lng: number }): string {
  if (!p) return '';
  const lat = formatDMS(p.lat, false);
  const lng = formatDMS(p.lng, true);
  return `${lat} ${lng}`;
}
