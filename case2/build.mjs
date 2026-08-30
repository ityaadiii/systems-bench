import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.env.HOME, 'Desktop/systems-bench');
const SP = '/private/tmp/claude-501/-Users-aditisingh-Desktop/b0b84e12-2ed5-4d68-a38f-11663e744748/scratchpad';

// newest run that actually holds scenario results
const runs = readdirSync(join(ROOT, 'runs')).filter(d => existsSync(join(ROOT,'runs',d,'scenarios.json'))).sort();
const runId = process.argv[2] || runs[runs.length - 1];
const raw = JSON.parse(readFileSync(join(ROOT,'runs',runId,'scenarios.json'),'utf8'));

const meta = JSON.parse(readFileSync(join(SP,'archetypes.json'),'utf8'));

// One result per archetype: the model that produced the most business value,
// with failed cells excluded rather than silently ranked.
const byArchetype = {};
for (const r of raw.results) {
  if (r.detail?.error) continue;
  const cur = byArchetype[r.archetype];
  if (!cur || r.valueInrPerMonth > cur.valueInrPerMonth) byArchetype[r.archetype] = r;
}
// DROP_VOLUME: the catalogue archetype is the one shape a benchmark already
// fits, and it earned the weakest panel. It survives in the code as the control
// and is named in one line rather than given a section of its own.
delete byArchetype.volume;
for (const k of Object.keys(byArchetype)) {
  const s = meta.scenarios[byArchetype[k].scenarioId];
  Object.assign(byArchetype[k], { title: s.title, whyThisMethod: s.whyThisMethod, brief: s.brief });
}

const payload = {
  runId, evidential: raw.evidential,
  disclaimer: meta.disclaimer,
  archetypes: meta.archetypes,
  accounts: Object.fromEntries(Object.entries(byArchetype).map(([k,v]) => [k, v.account])),
  byArchetype,
  totals: {
    accounts: Object.keys(byArchetype).length,
    machines: Object.keys(byArchetype).length,
    attempts: raw.results.reduce((a,r) => a + (r.attempts||0), 0),
    costUsd: raw.results.reduce((a,r) => a + (r.costUsd||0), 0),
  },
};

// one real generated listing, so the extraction diagram shows the actual task
const { build: buildListings, acceptableFor } = await import(join(ROOT,'src/scenarios/catalogue/index.ts'));
// Pick a listing that is MISSING at least one attribute: the caption points at
// the blank rows, and a sample where everything is present makes it a lie.
const pool = buildListings(160, 7);
const sample = pool.find(x => x.raw.length > 50 && x.raw.length < 120
    && ['brand','colour','size','material'].some(k => {
         const a = acceptableFor(x.truth[k], x.raw); return a.length === 1 && a[0] === '';
       }))
  || pool[0];
// What must come out is not the source record: it is what a careful human would
// accept given only the text. Attributes the listing never stated must come back
// blank, and the diagram has to show that or its caption is describing nothing.
const shown = {};
for (const k of ['category','brand','colour','size','material']) {
  const acc = acceptableFor(sample.truth[k], sample.raw);
  shown[k] = (acc.length === 1 && acc[0] === '') ? '' : sample.truth[k];
}
payload.sample = { raw: sample.raw, truth: shown };

const fonts = JSON.parse(readFileSync(join(SP,'fonts.json'),'utf8'));
const face = (fam,w,st,b64) => b64 ? `@font-face{font-family:"${fam}";font-style:${st};font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2")}` : '';
const faces = [face('Archivo Display',900,'normal',fonts.A9), face('Fraunces',400,'italic',fonts.FR)].join('\n');

let html = readFileSync(join(ROOT,'case2/template.html'),'utf8')
  .replace('__CSS__', faces + '\n' + readFileSync(join(ROOT,'case2/style.css'),'utf8'))
  .replace('__JS__', `window.__SYSBENCH__=${JSON.stringify(payload)};\n`
      + readFileSync(join(ROOT,'case2/diagrams.js'),'utf8') + '\n'
      + readFileSync(join(ROOT,'shared-charts.js'),'utf8') + '\n'
      + readFileSync(join(ROOT,'case2/app.js'),'utf8'));

writeFileSync(join(ROOT,'case2/out.html'), html);
writeFileSync(join(process.env.HOME,'Desktop','Systems Bench - case study.html'), html);
// body-only variant for the Artifact skeleton
const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>')+8);
const body  = html.slice(html.indexOf('<body>')+6, html.lastIndexOf('</body>'));
writeFileSync(join(ROOT,'case2/artifact.html'),
  '<title>Four companies, four ways of asking for AI</title>\n' + style + body);

console.log('run:', runId, '| archetypes:', Object.keys(byArchetype).join(', '));
console.log('built:', (Buffer.byteLength(html)/1024).toFixed(0), 'KB');
