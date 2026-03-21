/**
 * Generates SVG file-type icons as data URIs.
 * Icon style: white document with folded corner + coloured label band.
 */

interface IconDef {
  label: string;
  /** Hex colour for the label band */
  color: string;
}

const EXT_MAP: Record<string, IconDef> = {
  // Documents
  pdf:  { label: 'PDF',  color: '#E53935' },
  doc:  { label: 'DOC',  color: '#1565C0' },
  docx: { label: 'DOCX', color: '#1565C0' },
  odt:  { label: 'ODT',  color: '#1565C0' },
  rtf:  { label: 'RTF',  color: '#1565C0' },
  // Spreadsheets
  xls:  { label: 'XLS',  color: '#2E7D32' },
  xlsx: { label: 'XLSX', color: '#2E7D32' },
  ods:  { label: 'ODS',  color: '#2E7D32' },
  csv:  { label: 'CSV',  color: '#2E7D32' },
  // Presentations
  ppt:  { label: 'PPT',  color: '#BF360C' },
  pptx: { label: 'PPTX', color: '#BF360C' },
  odp:  { label: 'ODP',  color: '#BF360C' },
  // Archives
  zip:  { label: 'ZIP',  color: '#6D4C41' },
  rar:  { label: 'RAR',  color: '#6D4C41' },
  '7z': { label: '7Z',   color: '#6D4C41' },
  tar:  { label: 'TAR',  color: '#6D4C41' },
  gz:   { label: 'GZ',   color: '#6D4C41' },
  // Code
  js:   { label: 'JS',   color: '#F57F17' },
  ts:   { label: 'TS',   color: '#0D47A1' },
  tsx:  { label: 'TSX',  color: '#0D47A1' },
  jsx:  { label: 'JSX',  color: '#F57F17' },
  py:   { label: 'PY',   color: '#283593' },
  cs:   { label: 'C#',   color: '#6A1B9A' },
  java: { label: 'JAVA', color: '#BF360C' },
  // Data / markup
  json: { label: 'JSON', color: '#37474F' },
  xml:  { label: 'XML',  color: '#37474F' },
  yaml: { label: 'YAML', color: '#37474F' },
  yml:  { label: 'YAML', color: '#37474F' },
  sql:  { label: 'SQL',  color: '#37474F' },
  // Text
  txt:  { label: 'TXT',  color: '#546E7A' },
  log:  { label: 'LOG',  color: '#546E7A' },
  // Diagrams
  drawio: { label: 'DRAW', color: '#FF6F00' },
  // Video
  mp4:  { label: 'MP4',  color: '#212121' },
  mov:  { label: 'MOV',  color: '#212121' },
  avi:  { label: 'AVI',  color: '#212121' },
  mkv:  { label: 'MKV',  color: '#212121' },
  // Audio
  mp3:  { label: 'MP3',  color: '#AD1457' },
  wav:  { label: 'WAV',  color: '#AD1457' },
  flac: { label: 'FLAC', color: '#AD1457' },
};

const GENERIC: IconDef = { label: 'FILE', color: '#455A64' };

function buildSvg(def: IconDef): string {
  // Document shape: 32×40, folded top-right corner at (22,0)→(32,10)
  // Label band at the bottom.  Font size shrinks for labels > 4 chars.
  const fontSize = def.label.length > 4 ? 6.5 : 7.5;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40" width="32" height="40">
  <path d="M2 0h20l10 10v30H2z" fill="#FAFAFA" stroke="#CFD8DC" stroke-width="1.2"/>
  <path d="M22 0l10 10H22z" fill="#CFD8DC"/>
  <rect x="2" y="27" width="30" height="13" rx="2" fill="${def.color}"/>
  <text x="17" y="37.5" font-family="Arial,Helvetica,sans-serif" font-size="${fontSize}" font-weight="bold" fill="#ffffff" text-anchor="middle">${def.label}</text>
</svg>`;
}

const cache = new Map<string, string>();

export function getFileIconDataUri(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (cache.has(ext)) return cache.get(ext)!;
  const def = EXT_MAP[ext] ?? GENERIC;
  const uri = 'data:image/svg+xml,' + encodeURIComponent(buildSvg(def));
  cache.set(ext, uri);
  return uri;
}
