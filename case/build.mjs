import { readFileSync, writeFileSync } from 'node:fs';
const SP = '/private/tmp/claude-501/-Users-aditisingh-Desktop/b0b84e12-2ed5-4d68-a38f-11663e744748/scratchpad';
const fonts = JSON.parse(readFileSync(`${SP}/fonts.json`, 'utf8'));
const data  = readFileSync('data.json', 'utf8');
let css = readFileSync('style.css', 'utf8');
const js  = readFileSync('app.js', 'utf8');
let html  = readFileSync('template.html', 'utf8');

const face = (fam, wght, style, b64) => b64 ? `@font-face{font-family:"${fam}";font-style:${style};font-weight:${wght};font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2")}` : '';
const faces = [
  face('Archivo Display', 900, 'normal', fonts.A9),
  face('Archivo Body',    800, 'normal', fonts.A8),
  face('Archivo Body',    400, 'normal', fonts.A8),
  face('Fraunces',        400, 'italic', fonts.FR),
].join('\n');

// Archivo 800 is a display weight; body text falls back to the system stack rather
// than being set in a heavy face it was never drawn for.
css = css.replace('font-family:"Archivo Body",system-ui', 'font-family:system-ui');

html = html
  .replace('__CSS__', faces + '\n' + css)
  .replace('__JS__', `window.__BENCH__=${data};\n${js}`);

writeFileSync('../../case-study.html', html);
writeFileSync(process.env.HOME + '/Desktop/Partner Bench - case study.html', html);
console.log('built:', (Buffer.byteLength(html) / 1024).toFixed(0), 'KB');
