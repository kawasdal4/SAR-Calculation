'use client';

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Printer, Map as MapIcon } from 'lucide-react';
import WorksheetDisplay, { type WorksheetData } from './WorksheetDisplay';
import type { LatLng } from '@/lib/sar/sarCalculations';
import type { MapMarker, MapLine, MapPolygon, MapCircle } from './SeaMap';

const SeaMap = dynamic(() => import('./SeaMap'), { ssr: false });

interface PrintA3Props {
  worksheetData: WorksheetData;
  mapCenter: LatLng;
  markers: MapMarker[];
  lines: MapLine[];
  polygons: MapPolygon[];
  circles: MapCircle[];
}

const WORKSHEET_OPTIONS = [
  { id: '1', label: 'WS1: Average Wind Aloft (AWA)' },
  { id: '2', label: 'WS2: Average Surface Wind (ASW)' },
  { id: '3', label: 'WS3: Wind Current (WC)' },
  { id: '4', label: 'WS4: Leeway (LW)' },
  { id: '5', label: 'WS5: Total Water Current (TWC)' },
  { id: '6', label: 'WS6: Datum Position' },
  { id: '7', label: 'WS7: Total Search Effort (Zta)' },
  { id: '8', label: 'WS8: Effort Allocation' },
];

export default function PrintA3({ worksheetData, mapCenter, markers, lines, polygons, circles }: PrintA3Props) {
  const [selectedSheets, setSelectedSheets] = useState<string[]>(['1', '2', '3', '4', '5', '6', '7', '8']);
  const [showMap, setShowMap] = useState(true);

  const toggleSheet = (id: string) => {
    setSelectedSheets((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4">
      {/* Controls (hidden in print) */}
      <Card className="border-slate-200 shadow-sm print:hidden">
        <CardHeader className="bg-slate-50 pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Printer className="h-4 w-4" /> Print A3 — Peta + Worksheet
          </CardTitle>
          <CardDescription className="text-xs">
            Pilih worksheet yang ingin ditampilkan, lalu klik Print. Gunakan paper size A3 di dialog print.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <div>
            <Label className="text-xs">Pilih Worksheet:</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
              {WORKSHEET_OPTIONS.map((ws) => (
                <label key={ws.id} className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox
                    checked={selectedSheets.includes(ws.id)}
                    onCheckedChange={() => toggleSheet(ws.id)}
                  />
                  {ws.label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={showMap} onCheckedChange={() => setShowMap(!showMap)} />
              <MapIcon className="h-3 w-3" /> Tampilkan peta
            </label>
            <Button onClick={handlePrint} className="ml-auto">
              <Printer className="h-4 w-4 mr-2" /> Print A3
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Printable A3 layout */}
      <div className="print:block hidden">
        <div
          style={{
            width: '297mm',
            minHeight: '420mm',
            padding: '10mm',
            display: 'grid',
            gridTemplateColumns: showMap ? '1fr 1fr' : '1fr',
            gap: '10mm',
          }}
        >
          {/* Left: Map */}
          {showMap && (
            <div>
              <h2 className="text-sm font-bold mb-2">Peta Pencarian SAR</h2>
              <div style={{ height: '200mm', border: '1px solid #cbd5e1', borderRadius: '4px', overflow: 'hidden' }}>
                <SeaMap
                  center={mapCenter}
                  zoom={8}
                  markers={markers}
                  lines={lines}
                  polygons={polygons}
                  circles={circles}
                  height="200mm"
                />
              </div>
            </div>
          )}

          {/* Right: Worksheets */}
          <div>
            <h2 className="text-sm font-bold mb-2">Worksheet IAMSAR Vol. II</h2>
            <WorksheetDisplay data={worksheetData} />
          </div>
        </div>
      </div>

      {/* Screen preview */}
      <Card className="border-slate-200 shadow-sm print:hidden">
        <CardHeader className="bg-slate-50 pb-2">
          <CardTitle className="text-sm">Preview A3</CardTitle>
        </CardHeader>
        <CardContent className="pt-3">
          <div
            style={{
              border: '1px solid #cbd5e1',
              borderRadius: '4px',
              padding: '8px',
              background: '#f8fafc',
              overflow: 'auto',
            }}
          >
            <div
              style={{
                width: '297mm',
                minHeight: '200mm',
                padding: '5mm',
                background: '#fff',
                display: 'grid',
                gridTemplateColumns: showMap ? '1fr 1fr' : '1fr',
                gap: '5mm',
                transformOrigin: 'top left',
                transform: 'scale(0.5)',
              }}
            >
              {showMap && (
                <div>
                  <h3 className="text-[10px] font-bold mb-1">Peta Pencarian SAR</h3>
                  <div style={{ height: '150mm', border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                    <SeaMap
                      center={mapCenter}
                      zoom={8}
                      markers={markers}
                      lines={lines}
                      polygons={polygons}
                      circles={circles}
                      height="150mm"
                    />
                  </div>
                </div>
              )}
              <div>
                <h3 className="text-[10px] font-bold mb-1">Worksheet</h3>
                <div style={{ fontSize: '8px' }}>
                  <WorksheetDisplay data={worksheetData} />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
