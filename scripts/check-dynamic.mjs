// Syntax-check the two blocks inside dynamic/dsh-vision-paste.js
import { readFileSync } from 'node:fs';

const code = readFileSync(new URL('../dynamic/dsh-vision-paste.js', import.meta.url), 'utf8');

const hostMark = code.lastIndexOf('HOST 半区');
const clientMark = code.lastIndexOf('CLIENT 半区');
if (hostMark < 0 || clientMark < 0 || clientMark <= hostMark) {
  console.log('FAIL: markers not found or mis-ordered');
  process.exit(1);
}
const hostStart = code.indexOf('*/', hostMark) + 2;
const clientCommentStart = code.lastIndexOf('/*', clientMark);
const clientStart = code.indexOf('*/', clientMark) + 2;
const hostBlock = code.slice(hostStart, clientCommentStart);
const clientBlock = code.slice(clientStart);

let ok = true;
for (const [name, body] of [['HOST', hostBlock], ['CLIENT', clientBlock]]) {
  try {
    new Function(body); // parse only, never execute
    console.log(`OK: ${name} block parses (${body.length} chars)`);
  } catch (e) {
    ok = false;
    console.log(`FAIL: ${name} block: ${e.message}`);
  }
}
process.exit(ok ? 0 : 1);
