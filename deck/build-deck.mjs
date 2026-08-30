import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = join(process.env.HOME, 'Desktop/systems-bench');
const SP = '/private/tmp/claude-501/-Users-aditisingh-Desktop/b0b84e12-2ed5-4d68-a38f-11663e744748/scratchpad';

// reuse the exact payload the case study was built from, so the two cannot disagree
const page = readFileSync(join(ROOT,'case2/out.html'),'utf8');
const payload = page.match(/window\.__SYSBENCH__=(\{[\s\S]*?\});\n/)[1];

const fonts = JSON.parse(readFileSync(join(SP,'fonts.json'),'utf8'));
const face = (f,w,st,b) => b ? `@font-face{font-family:"${f}";font-style:${st};font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${b}) format("woff2")}` : '';
const faces = [face('Archivo Display',900,'normal',fonts.A9), face('Fraunces',400,'italic',fonts.FR)].join('\n');

const js = [
  `window.__SYSBENCH__=${payload};`,
  readFileSync(join(ROOT,'case2/diagrams.js'),'utf8'),
  readFileSync(join(ROOT,'shared-charts.js'),'utf8'),
  readFileSync(join(ROOT,'deck/content.js'),'utf8'),
  readFileSync(join(ROOT,'deck/deck.js'),'utf8'),
].join('\n');

const html = readFileSync(join(ROOT,'deck/deck.html'),'utf8')
  .replace('__CSS__', faces + '\n' + readFileSync(join(ROOT,'deck/deck.css'),'utf8'))
  .replace('__JS__', js);

writeFileSync(join(ROOT,'deck/out.html'), html);
writeFileSync(join(process.env.HOME,'Desktop','Systems Bench - deck.html'), html);
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>')+8);
const body  = html.slice(html.indexOf('<body>')+6, html.lastIndexOf('</body>'));
writeFileSync(join(ROOT,'deck/artifact.html'),
  '<title>Four companies, one sentence, four different businesses</title>\n' + style + body);
console.log('deck built:', (Buffer.byteLength(html)/1024).toFixed(0), 'KB');
