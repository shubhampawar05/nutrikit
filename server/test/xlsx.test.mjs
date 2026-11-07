// The build's XLSX reader (scripts/xlsx.mjs), on a workbook assembled here so the test needs no binary fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { readXlsx } from '../scripts/xlsx.mjs';

// A zip archive with the given entries: the first stored, the rest deflated, so both methods are read.
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  entries.forEach(([name, text], i) => {
    const data = Buffer.from(text);
    const method = i === 0 ? 0 : 8;
    const body = method ? zlib.deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(method, 8);
    head.writeUInt32LE(zlib.crc32(data), 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(zlib.crc32(data), 16); dir.writeUInt32LE(body.length, 20); dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28); dir.writeUInt32LE(offset, 42);
    local.push(head, nameBuf, body);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + body.length;
  });
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dirBuf, end]);
}

test('reads shared, inline and numeric cells into rows by sheet name, keeping column positions', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-')), 'book.xlsx');
  fs.writeFileSync(file, zip([
    ['xl/workbook.xml', '<workbook xmlns:r="r"><sheets><sheet name="1.3 Proximates &amp; more" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', '<sst><si><t>Food Code</t></si><si><r><t>Curry, </t></r><r><t xml:space="preserve">red &lt;kidney&gt; bean</t></r></si></sst>'],
    ['xl/worksheets/sheet1.xml', '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Energy</t></is></c></row>'
      + '<row r="2"><c r="A2" t="str"><v>15-146</v></c><c r="B2" t="s"><v>1</v></c><c r="C2"><v>106</v></c><c r="D2"/></row>'
      + '<row r="3"><c r="A3"/></row>'
      + '</sheetData></worksheet>'],
  ]));
  assert.deepEqual(readXlsx(file), {
    '1.3 Proximates & more': [
      ['Food Code', '', 'Energy'],
      ['15-146', 'Curry, red <kidney> bean', '106', ''],
    ],
  });
});

test('refuses a file that is not a zip archive', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-')), 'bad.xlsx');
  fs.writeFileSync(file, 'not a workbook');
  assert.throws(() => readXlsx(file), /not a zip archive/);
});
