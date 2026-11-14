/**
 * Self-built latitude/longitude grid for Leaflet maps.
 *
 * Draws polylines at 1°, 30', 10' intervals depending on zoom level,
 * with labels in degrees-minutes format. Built on top of L.LayerGroup
 * so it can be toggled like any other Leaflet layer.
 *
 * Why self-built: leaflet-plugin "Leaflet.Graticule" lacks TypeScript types
 * out-of-the-box and the user explicitly asked for strict typing.
 */
import type L from 'leaflet';

export interface LatLonGridOptions {
  /** Stroke colour for major (1°) lines. */
  majorColor?: string;
  /** Stroke colour for medium (30') lines. */
  mediumColor?: string;
  /** Stroke colour for minor (10') lines. */
  minorColor?: string;
  /** Label text colour. */
  labelColor?: string;
}

interface GridInterval {
  /** Interval in degrees. */
  interval: number;
  /** CSS colour. */
  color: string;
  /** Stroke weight. */
  weight: number;
  /** Opacity 0..1. */
  opacity: number;
  /** Show labels for this interval. */
  showLabels: boolean;
  /** Major interval label format: "1°" / "30'" / "10'". */
  label?: string;
}

/** Choose the grid intervals to draw based on map zoom. */
function intervalsForZoom(zoom: number): GridInterval[] {
  // Zoom levels (Leaflet): 0 = world, 7 = city, 11 = neighbourhood, 15 = street
  if (zoom >= 12) {
    // High zoom: 1° (major) + 30' (medium) + 10' (minor)
    return [
      { interval: 1 / 6, color: '#94a3b8', weight: 0.5, opacity: 0.5, showLabels: true, label: "10'" },
      { interval: 0.5, color: '#64748b', weight: 0.7, opacity: 0.6, showLabels: true, label: "30'" },
      { interval: 1, color: '#0f172a', weight: 1.0, opacity: 0.7, showLabels: true, label: '1°' },
    ];
  }
  if (zoom >= 9) {
    return [
      { interval: 0.5, color: '#94a3b8', weight: 0.5, opacity: 0.5, showLabels: true, label: "30'" },
      { interval: 1, color: '#0f172a', weight: 1.0, opacity: 0.7, showLabels: true, label: '1°' },
    ];
  }
  if (zoom >= 6) {
    return [
      { interval: 1, color: '#64748b', weight: 0.7, opacity: 0.6, showLabels: true, label: '1°' },
      { interval: 5, color: '#0f172a', weight: 1.0, opacity: 0.7, showLabels: true, label: '5°' },
    ];
  }
  // Low zoom: just 5° and 10°
  return [
    { interval: 5, color: '#64748b', weight: 0.7, opacity: 0.6, showLabels: true, label: '5°' },
    { interval: 10, color: '#0f172a', weight: 1.0, opacity: 0.7, showLabels: true, label: '10°' },
  ];
}

/** Format a coordinate value (lat or lng) as degrees-minutes. */
function formatDegMin(value: number, isLat: boolean): string {
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return `${deg}°${min.toFixed(min < 10 ? 1 : 0)}'${hemi}`;
}

/**
 * Rebuild the graticule layer group based on current map bounds & zoom.
 * Caller is responsible for clearing the layerGroup before calling this.
 */
export function drawGraticule(
  map: L.Map,
  layerGroup: L.LayerGroup,
  options: LatLonGridOptions = {},
): void {
  const opts: Required<LatLonGridOptions> = {
    majorColor: options.majorColor ?? '#0f172a',
    mediumColor: options.mediumColor ?? '#64748b',
    minorColor: options.minorColor ?? '#94a3b8',
    labelColor: options.labelColor ?? '#0f172a',
  };

  const zoom = map.getZoom();
  const bounds = map.getBounds();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();

  const intervals = intervalsForZoom(zoom);

  for (const interval of intervals) {
    const color =
      interval.interval >= 1
        ? opts.majorColor
        : interval.interval >= 1 / 6
        ? opts.mediumColor
        : opts.minorColor;

    // Meridians (lines of constant longitude, varying latitude)
    const startLng = Math.ceil(west / interval.interval) * interval.interval;
    for (let lng = startLng; lng <= east; lng += interval.interval) {
      // Wrap longitude to [-180, 180]
      const wrappedLng = ((lng + 540) % 360) - 180;
      const line = (window as unknown as { L: typeof L }).L.polyline(
        [
          [south, wrappedLng],
          [north, wrappedLng],
        ],
        {
          color,
          weight: interval.weight,
          opacity: interval.opacity,
          interactive: false,
        },
      );
      layerGroup.addLayer(line);

      if (interval.showLabels) {
        // Place label at top of viewport, just inside the visible area
        const labelLat = Math.min(north, 85); // avoid polar weirdness
        const label = (window as unknown as { L: typeof L }).L.marker(
          [labelLat, wrappedLng],
          {
            interactive: false,
            icon: (window as unknown as { L: typeof L }).L.divIcon({
              className: 'sar-graticule-label',
              html: `<div style="color:${opts.labelColor};font-size:10px;font-family:monospace;font-weight:600;background:rgba(255,255,255,0.75);padding:1px 4px;border-radius:2px;white-space:nowrap;">${formatDegMin(wrappedLng, false)}</div>`,
              iconSize: [60, 14],
              iconAnchor: [30, 0],
            }),
          },
        );
        layerGroup.addLayer(label);
      }
    }

    // Parallels (lines of constant latitude, varying longitude)
    const startLat = Math.ceil(south / interval.interval) * interval.interval;
    for (let lat = startLat; lat <= north; lat += interval.interval) {
      // Clamp latitude to [-85, 85] to avoid projection issues in Web Mercator
      const clampedLat = Math.max(-85, Math.min(85, lat));
      const line = (window as unknown as { L: typeof L }).L.polyline(
        [
          [clampedLat, west],
          [clampedLat, east],
        ],
        {
          color,
          weight: interval.weight,
          opacity: interval.opacity,
          interactive: false,
        },
      );
      layerGroup.addLayer(line);

      if (interval.showLabels) {
        const labelLng = west + (east - west) * 0.01;
        const label = (window as unknown as { L: typeof L }).L.marker(
          [clampedLat, labelLng],
          {
            interactive: false,
            icon: (window as unknown as { L: typeof L }).L.divIcon({
              className: 'sar-graticule-label',
              html: `<div style="color:${opts.labelColor};font-size:10px;font-family:monospace;font-weight:600;background:rgba(255,255,255,0.75);padding:1px 4px;border-radius:2px;white-space:nowrap;">${formatDegMin(clampedLat, true)}</div>`,
              iconSize: [60, 14],
              iconAnchor: [0, 7],
            }),
          },
        );
        layerGroup.addLayer(label);
      }
    }
  }
}
