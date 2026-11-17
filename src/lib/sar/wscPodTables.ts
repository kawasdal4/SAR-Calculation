/** Source tables transcribed from the user's Appendix I PDF (Tables I-3–I-8 and Figure I-12). */
export type SearchPlatform = 'fixed-wing' | 'helicopter' | 'vessel';
export type W2Target = 'piw' | 'raft1' | 'raft4' | 'raft6' | 'raft10' | 'raft15' | 'raft20' | 'raft25' | 'boatSmall' | 'boat10' | 'boat16' | 'boat24' | 'sail5' | 'sail8' | 'sail12' | 'sail15' | 'sail21' | 'sail25' | 'ship27' | 'ship46' | 'shipOver91';
export type W8Target = 'person' | 'raft1' | 'raft4' | 'raft6' | 'raft8' | 'raft10' | 'raft15' | 'raft20' | 'raft25' | 'boatUnder5' | 'boat5to8' | 'boat8to12' | 'boat12to20' | 'boat20to27' | 'sail5' | 'sail6' | 'sail8' | 'sail9' | 'sail12' | 'sail15' | 'sail20to23' | 'sail23to27';

export const W2_TARGET_OPTIONS: Array<{ id: W2Target; label: string; fsRow: string; fwGroup: 'small' | 'other'; isPiw: boolean }> = [
  { id: 'piw', label: 'Person in Water', fsRow: 'Person in Water', fwGroup: 'small', isPiw: true },
  { id: 'raft1', label: 'Raft 1 person', fsRow: 'Raft - 1-4 Person', fwGroup: 'small', isPiw: false },
  { id: 'raft4', label: 'Raft 4 person', fsRow: 'Raft - 1-4 Person', fwGroup: 'small', isPiw: false },
  { id: 'raft6', label: 'Raft 6 person', fsRow: 'Raft 6-25 Person', fwGroup: 'small', isPiw: false },
  { id: 'raft10', label: 'Raft 10 person', fsRow: 'Raft 6-25 Person', fwGroup: 'small', isPiw: false },
  { id: 'raft15', label: 'Raft 15 person', fsRow: 'Raft 6-25 Person', fwGroup: 'small', isPiw: false },
  { id: 'raft20', label: 'Raft 20 person', fsRow: 'Raft 6-25 Person', fwGroup: 'small', isPiw: false },
  { id: 'raft25', label: 'Raft 25 person', fsRow: 'Raft 6-25 Person', fwGroup: 'small', isPiw: false },
  { id: 'boatSmall', label: 'Power Boat <5m (<15 ft)', fsRow: 'Power Boat <8m (<25ft)', fwGroup: 'small', isPiw: false },
  { id: 'boat10', label: 'Power Boat 10m (33 ft)', fsRow: 'Power Boat - 10m (33ft)', fwGroup: 'other', isPiw: false },
  { id: 'boat16', label: 'Power Boat 16m (53 ft)', fsRow: 'Power Boat - 16m (53ft)', fwGroup: 'other', isPiw: false },
  { id: 'boat24', label: 'Power Boat 24m (78 ft)', fsRow: 'Power Boat - 24m (78ft)', fwGroup: 'other', isPiw: false },
  { id: 'sail5', label: 'Sail Boat 5m (15 ft)', fsRow: 'Sail Boat - <8m (<25ft)', fwGroup: 'small', isPiw: false },
  { id: 'sail8', label: 'Sail Boat 8m (26 ft)', fsRow: 'Sail Boat - <8m (<25ft)', fwGroup: 'small', isPiw: false },
  { id: 'sail12', label: 'Sail Boat 12m (39 ft)', fsRow: 'Sail Boat - 12m (39ft)', fwGroup: 'other', isPiw: false },
  { id: 'sail15', label: 'Sail Boat 15m (49 ft)', fsRow: 'Sail Boat - 25m (83ft)', fwGroup: 'other', isPiw: false },
  { id: 'sail21', label: 'Sail Boat 21m (69 ft)', fsRow: 'Sail Boat - 25m (83ft)', fwGroup: 'other', isPiw: false },
  { id: 'sail25', label: 'Sail Boat 25m (83 ft)', fsRow: 'Sail Boat - 25m (83ft)', fwGroup: 'other', isPiw: false },
  { id: 'ship27', label: 'Ship 27–46m (90–150 ft)', fsRow: 'Ship -> 27m (>90ft)', fwGroup: 'other', isPiw: false },
  { id: 'ship46', label: 'Ship 46–91m (150–300 ft)', fsRow: 'Ship -> 27m (>90ft)', fwGroup: 'other', isPiw: false },
  { id: 'shipOver91', label: 'Ship >91m (>300 ft)', fsRow: 'Ship -> 27m (>90ft)', fwGroup: 'other', isPiw: false },
];

type W2Rows = Record<500 | 1000 | 1500 | 2000, Record<W2Target, readonly [number, number, number, number, number, number]>>;

// Explicit Table I-5/I-6 visibility columns: 2, 5, 10, 20, 30, and >40 km.
const FIXED: W2Rows = {
  500: {
    piw:[0,.1,.1,.1,.1,.1],raft1:[.3,.7,.9,1.2,1.4,1.4],raft4:[.4,1,1.3,1.8,2,2.2],raft6:[.4,1.1,1.5,2.2,2.5,2.8],raft10:[.4,1.3,1.7,2.5,2.9,3.2],raft15:[.5,1.3,1.9,2.7,3.3,3.6],raft20:[.5,1.5,2.1,3.2,3.8,4.2],raft25:[.5,1.6,2.3,3.4,4.1,4.6],boatSmall:[.4,.9,1.2,1.5,1.7,1.8],boat10:[.6,2.1,3.3,5.3,6.7,7.7],boat16:[.6,2.7,4.5,8.1,10.9,13.1],boat24:[.6,2.8,5,9.8,13.5,16.7],sail5:[.5,1.6,2.2,3.2,3.9,4.3],sail8:[.6,2,3.1,4.9,6.1,7],sail12:[.6,2.6,4.3,7.6,10,11.9],sail15:[.6,2.7,4.6,8.4,11.3,13.7],sail21:[.6,2.8,4.9,9.3,12.7,15.5],sail25:[.6,2.8,5.1,9.9,13.7,17],ship27:[.6,2.9,5.4,11.1,15.9,20.1],ship46:[.6,3,5.7,12.5,18.9,24.7],shipOver91:[.7,3,5.8,13.2,20.6,27.9],
  },
  1000: {
    piw:[0,.1,.1,.1,.1,.1],raft1:[.3,.7,.9,1.2,1.4,1.4],raft4:[.4,1,1.3,1.8,2.1,2.3],raft6:[.3,1.1,1.6,2.2,2.6,2.8],raft10:[.4,1.3,1.8,2.6,3,3.3],raft15:[.4,1.4,2,2.8,3.4,3.7],raft20:[.4,1.5,2.2,3.2,3.9,4.3],raft25:[.5,1.6,2.3,3.5,4.2,4.7],boatSmall:[.4,1,1.3,1.7,1.8,2],boat10:[.5,2.2,3.4,5.4,6.8,7.8],boat16:[.6,2.7,4.5,8.2,10.9,13.1],boat24:[.6,2.8,5.1,9.8,13.6,16.7],sail5:[.5,1.6,2.2,3.3,4,4.4],sail8:[.5,2.1,3.2,5,6.2,7.1],sail12:[.6,2.6,4.3,7.6,10.9,12],sail15:[.6,2.7,4.6,8.5,11.4,13.7],sail21:[.6,2.8,4.9,9.3,12.8,15.6],sail25:[.6,2.8,5.1,9.9,13.8,17],ship27:[.6,2.9,5.4,11.1,15.9,20.1],ship46:[.6,3,5.7,12.5,18.9,24.7],shipOver91:[.7,3,5.8,13.2,20.6,27.9],
  },
  1500: {
    piw:[0,0,0,0,0,.1],raft1:[.2,.7,.9,1.3,1.4,1.4],raft4:[.3,1,1.3,1.9,2.1,2.3],raft6:[.3,1.1,1.6,2.2,2.6,2.8],raft10:[.3,1.3,1.8,2.6,3.1,3.4],raft15:[.3,1.4,2,2.9,3.4,3.8],raft20:[.4,1.5,2.2,3.3,4,4.4],raft25:[.4,1.6,2.4,3.6,4.3,4.8],boatSmall:[.3,1,1.3,1.7,2,2.1],boat10:[.5,2.2,3.4,5.5,6.8,7.9],boat16:[.5,2.6,4.5,8.2,11,13.2],boat24:[.5,2.8,5.1,10,13.6,16.7],sail5:[.4,1.6,2.3,3.4,4.1,4.5],sail8:[.5,2.1,3.2,5.1,6.3,7.2],sail12:[.5,2.6,4.3,7.7,10.1,12],sail15:[.5,2.7,4.6,8.5,11.4,13.8],sail21:[.5,2.8,4.9,9.4,12.8,15.7],sail25:[.5,2.8,5.1,10,13.8,17.1],ship27:[.5,2.9,5.4,11.1,16,20.1],ship46:[.5,3,5.7,12.5,18.9,24.7],shipOver91:[.6,3,5.8,13.2,20.7,27.9],
  },
  2000: {
    piw:[0,0,0,0,0,0],raft1:[.1,.6,.9,1.2,1.4,1.4],raft4:[.2,.9,1.3,1.9,2.1,2.3],raft6:[.2,1.1,1.6,2,2.7,2.9],raft10:[.2,1.2,1.8,2.7,3.1,3.5],raft15:[.2,1.4,2,3,3.5,3.9],raft20:[.4,1.5,2.2,3.4,4,4.5],raft25:[.3,1.6,2.4,3.6,4.4,4.9],boatSmall:[.2,1,1.3,1.8,2,2.2],boat10:[.3,2.2,3.4,5.5,6.9,8],boat16:[.4,2.6,4.5,8.3,11,13.3],boat24:[.4,2.8,5,9.8,13.6,16.8],sail5:[.3,1.6,2.3,3.5,4.1,4.5],sail8:[.4,2.1,3.3,5.2,6.4,7.2],sail12:[.4,2.5,4.3,7.7,10.2,12.1],sail15:[.4,2.7,4.6,8.6,11.5,13.9],sail21:[.4,2.7,4.9,9.4,12.9,15.7],sail25:[.4,2.8,5,10,13.9,17.1],ship27:[.4,2.9,5.4,11.1,16,20.1],ship46:[.4,3,5.7,12.5,18.9,24.7],shipOver91:[.5,3,5.8,13.2,20.7,27.9],
  },
};

const HELI: W2Rows = {
  500: {
    piw:[0,.1,.1,.1,.1,.1],raft1:[.4,.9,1.2,1.6,1.8,1.8],raft4:[.5,1.2,1.6,2.2,2.6,2.8],raft6:[.5,1.4,1.9,2.7,3,3.5],raft10:[.6,1.6,2.2,3.1,3.6,4],raft15:[.6,1.7,2.3,3.3,3.8,4.4],raft20:[.6,1.8,2.6,3.8,4.6,5.1],raft25:[.6,1.9,2.7,4.1,5,5.6],boatSmall:[.5,1.2,1.5,1.9,2.2,2.3],boat10:[.8,2.5,3.9,6.2,7.8,9],boat16:[.8,3.1,5.1,9.2,12.3,14.7],boat24:[.8,3.3,5.7,10.8,15,18.4],sail5:[.7,1.9,2.7,3.9,4.7,5.2],sail8:[.8,2.4,3.7,5.7,7.1,8.2],sail12:[.8,3,4.9,8.3,11.3,13.5],sail15:[.8,3.1,5.2,9.5,12.7,15.3],sail21:[.8,3.2,5.5,10.4,14.1,17.3],sail25:[.8,3.3,5.7,11,15.2,18.7],ship27:[.8,3.4,6,12.2,17.4,21.9],ship46:[.8,3.4,6.3,13.6,20.4,26.6],shipOver91:[.8,3.5,6.4,14.3,22.1,29.8],
  },
  1000: {
    piw:[0,.1,.1,.1,.1,.1],raft1:[.4,.9,1.2,1.6,1.8,1.8],raft4:[.5,1.2,1.7,2.3,2.6,2.9],raft6:[.5,1.4,2,2.8,3.2,3.5],raft10:[.5,1.6,2.2,3.2,3.7,4.1],raft15:[.6,1.7,2.4,3.5,4.1,4.4],raft20:[.6,1.8,2.7,3.9,4.7,5.2],raft25:[.6,1.9,2.8,4.2,5.1,5.7],boatSmall:[.5,1.2,1.6,2.1,2.3,2.5],boat10:[.7,2.6,3.9,6.3,8,9.1],boat16:[.7,3.1,5.2,9.2,12.3,14.8],boat24:[.8,3.3,5.7,10.9,15,18.5],sail5:[.6,1.9,2.8,4,4.8,5.4],sail8:[.7,2.5,3.7,5.8,7.3,8.3],sail12:[.7,3,4.9,8.6,11.4,13.5],sail15:[.7,3.1,5.3,9.5,12.8,15.4],sail21:[.7,3.2,5.6,10.4,14.2,17.3],sail25:[.8,3.3,5.7,11,15.3,18.8],ship27:[.8,3.4,6,12.2,17.4,21.9],ship46:[.8,3.4,6.3,13.6,20.4,26.6],shipOver91:[.8,3.5,6.4,14.3,22.2,29.8],
  },
  1500: {
    piw:[0,0,0,0,.1,.1],raft1:[.3,.9,1.2,1.6,1.8,1.8],raft4:[.4,1.2,1.7,2.3,2.7,2.9],raft6:[.4,1.4,2,2.8,3.3,3.5],raft10:[.4,1.6,2.2,3.2,3.8,4.2],raft15:[.5,1.7,2.4,3.5,4.2,4.6],raft20:[.5,1.9,2.7,4,4.8,5.3],raft25:[.5,2,2.9,4.3,5.2,5.7],boatSmall:[.4,1.3,1.7,2.2,2.5,2.6],boat10:[.5,2.6,4,6.3,7.9,9.2],boat16:[.7,3.1,5.2,9.3,12.4,14.8],boat24:[.7,3.2,5.7,10.9,15.1,18.5],sail5:[.6,2,2.8,4.1,4.9,5.5],sail8:[.6,2.5,3.8,5.9,7.4,8.4],sail12:[.6,3,4.9,8.7,11.4,13.6],sail15:[.7,3.1,5.3,9.6,12.8,15.5],sail21:[.7,3.2,5.6,10.5,14.3,17.4],sail25:[.7,3.3,5.7,11.1,15.3,18.8],ship27:[.7,3.4,6,12.2,17.4,21.9],ship46:[.7,3.4,6.3,13.6,20.4,26.6],shipOver91:[.7,3.4,6.4,14.3,22.2,29.8],
  },
  2000: {
    piw:[0,0,0,0,0,.1],raft1:[.2,.8,1.2,1.6,1.8,1.8],raft4:[.3,1.2,1.7,2.3,2.7,3],raft6:[.3,1.4,2,2.8,3.3,3.6],raft10:[.3,1.6,2.3,3.3,3.9,4.2],raft15:[.4,1.7,2.5,3.6,4.3,4.7],raft20:[.4,1.9,2.7,4,4.9,5.4],raft25:[.4,1.9,2.9,4.3,5.3,5.9],boatSmall:[.3,1.3,1.7,2.3,2.6,2.7],boat10:[.4,2.6,4,6.4,8,9.3],boat16:[.5,3,5.2,9.3,12.4,14.9],boat24:[.5,3.2,5.7,10.9,15.1,18.5],sail5:[.4,1.9,2.8,4,4.8,5.6],sail8:[.5,2.5,3.8,6,7.5,8.6],sail12:[.5,3,4.9,8.7,11.4,13.6],sail15:[.5,3.1,5.3,9.6,12.9,15.5],sail21:[.5,3.2,5.6,10.5,14.3,17.4],sail25:[.5,3.3,5.7,11.1,15.4,18.9],ship27:[.5,3.3,6,12.2,17.5,22],ship46:[.5,3.4,6.3,13.6,20.4,26.6],shipOver91:[.6,3.4,6.4,14.3,22.2,29.8],
  },
};

export function lookupW2Wu(platform: 'fixed-wing' | 'helicopter', target: W2Target, altitudeFt: 500 | 1000 | 1500 | 2000, visibilityColumn: number): number | null {
  const columns = platform === 'fixed-wing' ? FIXED[altitudeFt][target] : HELI[altitudeFt][target];
  return columns[visibilityColumn] ?? null;
}

export function fwFactor(windKts: number, group: 'small' | 'other'): number {
  if (!Number.isFinite(windKts) || windKts <= 0) return 0;
  if (windKts < 15) return 1;
  if (windKts <= 25) return group === 'small' ? 0.5 : 0.8;
  return group === 'small' ? 0.25 : 0.5;
}

export const TABLE_I8_ROWS: Record<string, Record<string, number[]>> = {
  'Person in Water': { 'fixed-wing':[1.2,1,0.9], helicopter:[1.5,1,0.8] },
  'Raft - 1-4 Person': { 'fixed-wing':[1.1,1,0.9], helicopter:[1.3,1,0.9] },
  'Raft 6-25 Person': { 'fixed-wing':[1.1,1,0.9], helicopter:[1.2,1,0.9] },
  'Power Boat <8m (<25ft)': { 'fixed-wing':[1.1,1,0.9], helicopter:[1.2,1,0.9] },
  'Power Boat - 10m (33ft)': { 'fixed-wing':[1.1,1,0.9], helicopter:[1.1,1,0.9] },
  'Power Boat - 16m (53ft)': { 'fixed-wing':[1.1,1,1], helicopter:[1.1,1,0.9] },
  'Power Boat - 24m (78ft)': { 'fixed-wing':[1.1,1,1], helicopter:[1.1,1,1] },
  'Sail Boat - <8m (<25ft)': { 'fixed-wing':[1.1,1,0.9], helicopter:[1.2,1,0.9] },
  'Sail Boat - 12m (39ft)': { 'fixed-wing':[1.1,1,1], helicopter:[1.1,1,0.9] },
  'Sail Boat - 25m (83ft)': { 'fixed-wing':[1.1,1,1], helicopter:[1.1,1,1] },
  'Ship -> 27m (>90ft)': { 'fixed-wing':[1,1,1], helicopter:[1.1,1,0.9] },
};

const visibility6 = [2,5,10,15,20,26] as const; // final value represents >25 km
export const W8_TARGET_OPTIONS: Array<{ id: W8Target; label: string }> = [
  {id:'person',label:'Person in water'},{id:'raft1',label:'Raft 1 Person'},{id:'raft4',label:'Raft 4 Person'},{id:'raft6',label:'Raft 6 Person'},{id:'raft8',label:'Raft 8 Person'},{id:'raft10',label:'Raft 10 Person'},{id:'raft15',label:'Raft 15 Person'},{id:'raft20',label:'Raft 20 Person'},{id:'raft25',label:'Raft 25 Person'},
  {id:'boatUnder5',label:'Power Boat <5m (15 ft)'},{id:'boat5to8',label:'Power Boat 5–8m (15–25 ft)'},{id:'boat8to12',label:'Power Boat 8–12m (25–40 ft)'},{id:'boat12to20',label:'Power Boat 12–20m (40–65 ft)'},{id:'boat20to27',label:'Power Boat 20–27m (65–90 ft)'},
  {id:'sail5',label:'Sail Boat 5m (15 ft)'},{id:'sail6',label:'Sail Boat 6m (20 ft)'},{id:'sail8',label:'Sail Boat 8m (25 ft)'},{id:'sail9',label:'Sail Boat 9m (30 ft)'},{id:'sail12',label:'Sail Boat 12m (40 ft)'},{id:'sail15',label:'Sail Boat 15m (50 ft)'},{id:'sail20to23',label:'Sail Boat 20–23m (65–75 ft)'},{id:'sail23to27',label:'Sail Boat 23–27m (75–90 ft)'},
];
// Table I-3 rows; each visibility vector is [2,5,10,15,20,>25] km, then eye-height 14 ft.
const W8_I3: Record<W8Target, [number[], number[]]> = {
  person:[[.2,.2,.3,.3,.3,.3],[.3,.4,.5,.6,.6,.6]],raft1:[[.7,1.2,1.8,2.1,2.4,2.5],[1,1.6,2.5,2.9,3.2,3.3]],raft4:[[.8,1.5,2.3,2.9,3.2,3.4],[1.1,2,3.1,3.8,4.2,4.4]],raft6:[[.9,1.7,2.7,3.4,3.8,4.1],[1.2,2.2,3.5,4.4,5,5.3]],raft8:[[.9,1.7,2.8,3.5,4,4.2],[1.2,2.3,3.6,4.5,5.1,5.4]],raft10:[[.9,1.8,2.9,3.7,4.2,4.6],[1.2,2.3,3.7,4.7,5.4,5.8]],raft15:[[1,2,3.2,4,4.5,4.9],[1.2,2.5,4,5.1,5.7,6.2]],raft20:[[1,2.1,3.5,4.4,5.1,5.6],[1.3,2.6,4.3,5.7,6.4,6.9]],raft25:[[1,2.2,3.7,4.7,5.5,6],[1.3,2.7,4.3,5.8,6.7,7.5]],
  boatUnder5:[[.5,.7,1,1.2,1.3,1.4],[.5,1,1.5,1.8,1.9,2]],boat5to8:[[.8,1.4,2.3,2.9,3.4,3.8],[1,1.9,3,3.9,4.5,5]],boat8to12:[[.8,1.8,3.1,4.1,4.9,5.6],[1.2,2.3,4,5.3,6.4,7.3]],boat12to20:[[.9,2.2,4.2,5.9,7.4,8.7],[1.2,3,5.4,7.6,9.6,11.3]],boat20to27:[[.9,2.3,4.6,6.8,8.8,10.6],[1.2,3,6,8.7,11.3,13.6]],
  sail5:[[.8,1.4,2.2,2.7,3.1,3.4],[1,1.8,2.8,3.5,4.1,4.5]],sail6:[[.8,1.6,2.6,3.3,3.9,4.4],[1.1,2,3.3,4.3,5,5.6]],sail8:[[.9,1.8,2.9,3.9,4.9,5.1],[1.1,2.2,3.8,5,5.9,6.7]],sail9:[[.9,2,3.4,4.6,5.5,6.3],[1.2,2.5,4.4,5.9,7.1,8.1]],sail12:[[.9,2.2,4.1,5.7,7,8.1],[1.3,2.8,5.2,7.2,9,10.5]],sail15:[[.9,2.2,4.3,6.1,7.7,9.1],[1.2,2.9,5.2,7.9,9.9,11.7]],sail20to23:[[.9,2.2,4.5,6.5,8.3,9.9],[1.2,3,5.8,8.4,10.8,12.9]],sail23to27:[[.9,2.2,4.5,6.8,8.9,10.7],[1.2,3.1,6.1,8.9,11.5,13.8]],
};

const W8_I4: Partial<Record<W8Target, number[]>> = {
  person:[.4,.5,.6,.7,.7],raft4:[2.3,3.2,4.2,4.9,5.5],raft6:[2.5,3.6,5,6.2,6.9],raft15:[2.6,4,5.1,6.4,7.3],raft25:[2.7,4.2,5.2,6.5,7.5],boatUnder5:[1.1,1.4,1.9,2.1,2.3],boat5to8:[2,2.9,4.3,5.2,5.8],boat8to12:[2.8,4.5,7.6,9.4,11.6],boat12to20:[3.2,5.6,10.7,14.7,18.1],
};

export function lookupW8Wu(target: W8Target, eye: '8'|'14'|'MERSHIP', visibility: string): number | null {
  if (eye === 'MERSHIP') {
    const index = ['5','10','20','30','40'].indexOf(visibility);
    return index < 0 ? null : W8_I4[target]?.[index] ?? null;
  }
  const col = eye === '8' ? 0 : 1;
  const index = ['2','5','10','15','20','>25'].indexOf(visibility);
  return index < 0 ? null : W8_I3[target][col][index] ?? null;
}

export function lookupFw(wind: number, group: 'small'|'other'): number {
  if (!(wind > 0)) return 0;
  if (wind < 15) return 1;
  if (wind <= 25) return group === 'small' ? .5 : .8;
  return group === 'small' ? .25 : .5;
}

export const FIXED_WING_TAS_COLUMNS = [150,180,210] as const;
export const HELICOPTER_TAS_COLUMNS = [60,90,120,140] as const;
export function lookupFs(target: W2Target, platform: 'fixed-wing'|'helicopter', tas: number): number | null {
  const rowMeta = W2_TARGET_OPTIONS.find((x) => x.id === target);
  if (!rowMeta) return null;
  const values = TABLE_I8_ROWS[rowMeta.fsRow]?.[platform];
  if (!values) return null;
  const limits = platform === 'fixed-wing' ? FIXED_WING_TAS_COLUMNS : HELICOPTER_TAS_COLUMNS;
  const idx = platform === 'fixed-wing' && tas > 0 && tas <= 150 ? 0 : limits.indexOf(tas as never);
  return idx >= 0 ? values[idx] ?? null : null;
}

export type SearchNumber = 1|2|3|4|5;
// Digitized chart readings from Appendix I Figure I-12. Exact guide checkpoints are retained.
const POD_CURVES: Record<SearchNumber, Array<[number,number]>> = {
  1:[[0,0],[.1,10],[.2,20],[.3,30],[.4,40],[.5,47],[.54,50],[.6,56],[.7,64],[.8,70],[.9,75],[.95,76.53],[.99,78],[1.045,80],[1.08,82],[1.2,86],[1.4,90],[1.6,94],[1.8,97],[2,100]],
  2:[[0,0],[.1,22],[.2,40],[.3,55],[.4,67],[.5,76],[.6,83],[.7,89],[.8,93],[.9,96],[1,98],[1.2,99],[2,100]],
  3:[[0,0],[.1,31],[.2,52],[.3,68],[.4,79],[.5,87],[.6,92],[.7,96],[.8,98],[1,99],[2,100]],
  4:[[0,0],[.1,42],[.2,65],[.3,80],[.4,89],[.5,94],[.6,97],[.8,99],[2,100]],
  5:[[0,0],[.1,50],[.2,73],[.3,86],[.4,93],[.5,97],[.7,99],[2,100]],
};
export function readFigureI12(coverage: number, search: SearchNumber): number {
  const points = POD_CURVES[search];
  if (!(coverage > 0)) return 0;
  if (coverage >= 2) return 100;
  const upper = points.findIndex(([c]) => c >= coverage);
  if (upper <= 0) return points[0][1];
  const [c0,p0] = points[upper-1], [c1,p1] = points[upper];
  return p0 + (p1-p0) * (coverage-c0) / (c1-c0);
}

export const W2_VISIBILITY_LABELS = ['2','5','10','20','30','>40'] as const;
export const W8_VISIBILITY_LABELS = ['2','5','10','15','20','>25'] as const;
