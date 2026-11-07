// Minimal XLSX reader for the catalog build: cell text of every sheet, by sheet name. Enough for plain data
// workbooks such as CoFID (no formulas evaluated, no styles); not a general spreadsheet library.
import fs from 'node:fs';
import zlib from 'node:zlib';

// Zip archive -> Map(entry name -> Buffer), from the central directory (no ZIP64; workbooks here are small).
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end of central directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, zlib.inflateRawSync(raw));
    else throw new Error(`zip entry ${name} uses unsupported compression method ${method}`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e]);
// Text of all <t> elements in a fragment (shared strings and inline strings may be split into rich-text runs).
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1])).join('');
const colIndex = (ref) => [...ref.replace(/\d+$/, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/**
 * Read a workbook.
 * @param {string} file path to an .xlsx file
 * @returns {Record<string, string[][]>} rows of cell text per sheet name; empty cells are ''
 */
export function readXlsx(file) {
  const files = unzip(fs.readFileSync(file));
  const xml = (name) => {
    const b = files.get(name);
    if (!b) throw new Error(`${file}: missing ${name}`);
    return b.toString('utf8');
  };
  const shared = files.has('xl/sharedStrings.xml')
    ? [...xml('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
    : [];
  const targets = new Map([...xml('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
    m[0].match(/\bId="([^"]+)"/)[1], m[0].match(/\bTarget="([^"]+)"/)[1].replace(/^\/?(xl\/)?/, 'xl/'),
  ]));
  const sheets = {};
  for (const m of xml('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescape(m[0].match(/\bname="([^"]*)"/)[1]);
    const target = targets.get(m[0].match(/\br:id="([^"]+)"/)[1]);
    const rows = [];
    for (const r of xml(target).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = c[1].match(/\br="([A-Z]+\d+)"/)?.[1];
        const type = c[1].match(/\bt="([^"]+)"/)?.[1];
        const body = c[2] ?? '';
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const value = type === 's' ? shared[Number(v)] ?? ''
          : type === 'inlineStr' ? textOf(body)
          : v != null ? unescape(v) : '';
        const i = ref ? colIndex(ref) : row.length;
        while (row.length < i) row.push('');
        row[i] = value;
      }
      if (row.some((x) => x !== '')) rows.push(row);
    }
    sheets[name] = rows;
  }
  return sheets;
}
