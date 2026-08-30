/* Mechanism diagrams. Each one shows a thing the prose cannot: what is observed,
   what is not, and where the missing part sits. currentColor everywhere so both
   themes work; one literal hue per figure for the element carrying the claim. */
window.__DIAGRAMS__ = {

/* B — selective labels. The dashed branch is the entire argument. */
selective: function(n, approved, declined){ return `
<figure class="dia">
<svg viewBox="0 0 620 220" role="img" aria-label="Applicants pass a decision gate. Only the approved branch ever produces an observed outcome; the declined branch is never observed." style="max-width:100%;height:auto">
  <defs><marker id="ar1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
    <polygon points="0,0 10,5 0,10" fill="currentColor"/></marker></defs>
  <rect x="8" y="86" width="112" height="48" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="64" y="106" text-anchor="middle" font-size="12" fill="currentColor">${n} applicants</text>
  <text x="64" y="122" text-anchor="middle" font-size="11" fill="currentColor" opacity=".65">thin file</text>

  <line x1="120" y1="110" x2="176" y2="110" stroke="currentColor" stroke-width="1.5" marker-end="url(#ar1)"/>
  <polygon points="186,110 226,84 266,110 226,136" fill="none" stroke="#1f3fff" stroke-width="1.8"/>
  <text x="226" y="114" text-anchor="middle" font-size="11" fill="#1f3fff">decide</text>

  <line x1="266" y1="98" x2="330" y2="62" stroke="currentColor" stroke-width="1.5" marker-end="url(#ar1)"/>
  <text x="292" y="70" text-anchor="middle" font-size="10.5" fill="currentColor">approve</text>
  <rect x="336" y="38" width="120" height="48" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="396" y="58" text-anchor="middle" font-size="12" fill="currentColor">${approved} funded</text>
  <text x="396" y="74" text-anchor="middle" font-size="11" fill="currentColor" opacity=".65">repaid or not</text>
  <line x1="456" y1="62" x2="512" y2="62" stroke="currentColor" stroke-width="1.5" marker-end="url(#ar1)"/>
  <text x="484" y="52" text-anchor="middle" font-size="10" fill="currentColor" opacity=".7">18 months</text>
  <text x="574" y="58" text-anchor="middle" font-size="12" fill="currentColor">label</text>
  <text x="574" y="74" text-anchor="middle" font-size="11" fill="currentColor" opacity=".65">exists</text>

  <line x1="266" y1="122" x2="330" y2="162" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#ar1)"/>
  <text x="292" y="158" text-anchor="middle" font-size="10.5" fill="currentColor">decline</text>
  <rect x="336" y="140" width="120" height="48" fill="none" stroke="#a3232f" stroke-width="1.5" stroke-dasharray="5 4"/>
  <text x="396" y="160" text-anchor="middle" font-size="12" fill="#a3232f">${declined} turned away</text>
  <text x="396" y="176" text-anchor="middle" font-size="11" fill="#a3232f" opacity=".8">they go elsewhere</text>
  <line x1="456" y1="164" x2="512" y2="164" stroke="#a3232f" stroke-width="1.5" stroke-dasharray="4 3"/>
  <text x="574" y="160" text-anchor="middle" font-size="12" fill="#a3232f">no label</text>
  <text x="574" y="176" text-anchor="middle" font-size="11" fill="#a3232f" opacity=".8">ever</text>
</svg>
<figcaption><b>Why accuracy is undefined here.</b> You find out what happened to the ones you funded. You never find out about the ones you turned away, so there is no answer key to score against. A policy that declines everyone has a perfect record and earns nothing.</figcaption>
</figure>`; },

/* C — the missing counterfactual, then the overlap that decides what is knowable. */
counterfactual: function(rows, ess){ return `
<figure class="dia">
<svg viewBox="0 0 620 250" role="img" aria-label="One price was set and its outcome observed. Outcomes at every other price are unknown. Learning is only possible where the old policy and the new policy chose the same price." style="max-width:100%;height:auto">
  <defs><marker id="ar2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
    <polygon points="0,0 10,5 0,10" fill="currentColor"/></marker></defs>
  <text x="8" y="18" font-size="11" fill="currentColor" opacity=".7">one car, seven prices you could have set</text>
  ${[0,1,2,3,4,5,6].map(function(i){
    var x=30+i*82, chosen=i===3;
    return '<rect x="'+x+'" y="30" width="62" height="34" fill="'+(chosen?'#1f3fff':'none')+'" stroke="'+(chosen?'#1f3fff':'currentColor')+'" stroke-width="1.4" '+(chosen?'':'stroke-dasharray="4 3" opacity=".5"')+'/>'+
      '<text x="'+(x+31)+'" y="52" text-anchor="middle" font-size="11" fill="'+(chosen?'#fafaf7':'currentColor')+'" '+(chosen?'':'opacity=".6"')+'>'+[0.88,0.92,0.96,'1.00',1.04,1.08,1.12][i]+'</text>'+
      '<line x1="'+(x+31)+'" y1="64" x2="'+(x+31)+'" y2="84" stroke="currentColor" stroke-width="1.2" '+(chosen?'':'stroke-dasharray="3 3" opacity=".45"')+' marker-end="url(#ar2)"/>'+
      '<text x="'+(x+31)+'" y="100" text-anchor="middle" font-size="'+(chosen?12:15)+'" fill="'+(chosen?'currentColor':'#a3232f')+'" '+(chosen?'':'opacity=".75"')+'>'+(chosen?'sold':'?')+'</text>';
  }).join('')}
  <text x="8" y="132" font-size="11" fill="currentColor" opacity=".7">only the filled one produced an outcome. the six question marks never happened and never will</text>

  <line x1="8" y1="152" x2="612" y2="152" stroke="currentColor" stroke-width="1" opacity=".3"/>
  <text x="8" y="176" font-size="11" fill="currentColor" opacity=".7">so a new policy is only checkable where it agrees with the old one</text>
  <rect x="30" y="188" width="200" height="26" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <rect x="150" y="188" width="200" height="26" fill="none" stroke="currentColor" stroke-width="1.4"/>
  <rect x="150" y="188" width="80" height="26" fill="#1f3fff" opacity=".22"/>
  <text x="88" y="205" text-anchor="middle" font-size="11.5" fill="currentColor">old policy</text>
  <text x="292" y="205" text-anchor="middle" font-size="11.5" fill="currentColor">new policy</text>
  <line x1="190" y1="214" x2="190" y2="234" stroke="#1f3fff" stroke-width="1.4"/>
  <text x="198" y="233" font-size="11.5" fill="#1f3fff">they agree on ${ess} of ${rows} rows. that is your whole sample</text>
</svg>
<figcaption><b>Why nothing can be graded here.</b> There is no correct price, only what happened at the one you picked. A new policy can only be judged where it happens to agree with the old one, so a log of ${rows} rows answers the question with ${ess}.</figcaption>
</figure>`; },

/* D — the branching the log never visited. */
trajectory: function(){ return `
<figure class="dia">
<svg viewBox="0 0 620 220" role="img" aria-label="Each weekly action leads to a different state the following week, so a logged test set contains one path through a branching tree and none of the states a different policy would reach." style="max-width:100%;height:auto">
  <defs><marker id="ar3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
    <polygon points="0,0 10,5 0,10" fill="currentColor"/></marker></defs>
  <text x="8" y="16" font-size="11" fill="currentColor" opacity=".7">week 1</text>
  <text x="212" y="16" font-size="11" fill="currentColor" opacity=".7">week 2</text>
  <text x="416" y="16" font-size="11" fill="currentColor" opacity=".7">week 3</text>
  <circle cx="40" cy="110" r="15" fill="#1f3fff"/>
  <text x="40" y="140" text-anchor="middle" font-size="10.5" fill="currentColor">past due</text>
  ${[[70,'call'],[110,'offer'],[150,'wait']].map(function(r,i){
    var y=[52,110,168][i];
    return '<line x1="55" y1="110" x2="196" y2="'+y+'" stroke="'+(i===0?'#1f3fff':'currentColor')+'" stroke-width="'+(i===0?1.8:1.2)+'" '+(i===0?'':'opacity=".4" stroke-dasharray="4 3"')+' marker-end="url(#ar3)"/>'+
      '<text x="120" y="'+(y+(i===0?-8:i===1?-6:14))+'" text-anchor="middle" font-size="10.5" fill="'+(i===0?'#1f3fff':'currentColor')+'" '+(i===0?'':'opacity=".5"')+'>'+r[1]+'</text>'+
      '<circle cx="212" cy="'+y+'" r="12" fill="'+(i===0?'#1f3fff':'none')+'" stroke="currentColor" stroke-width="1.3" '+(i===0?'':'opacity=".4"')+'/>';
  }).join('')}
  ${[[36,0],[68,0],[100,1],[132,1],[164,2],[196,2]].map(function(p,i){
    var y0=[52,110,168][p[1]], y=[30,64,96,128,160,192][i];
    var live=i<2;
    return '<line x1="226" y1="'+y0+'" x2="400" y2="'+y+'" stroke="'+(live?'#1f3fff':'currentColor')+'" stroke-width="'+(live?1.6:1)+'" '+(live?'':'opacity=".28" stroke-dasharray="3 3"')+'/>'+
      '<circle cx="412" cy="'+y+'" r="9" fill="'+(i===0?'#1f3fff':'none')+'" stroke="currentColor" stroke-width="1.2" '+(live?'':'opacity=".3"')+'/>';
  }).join('')}
  <rect x="440" y="18" width="172" height="60" fill="none" stroke="#1f3fff" stroke-width="1.5"/>
  <text x="526" y="40" text-anchor="middle" font-size="11.5" fill="#1f3fff">your logged test set</text>
  <text x="526" y="58" text-anchor="middle" font-size="11" fill="#1f3fff" opacity=".8">one path, in blue</text>
  <rect x="440" y="130" width="172" height="60" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 4" opacity=".55"/>
  <text x="526" y="152" text-anchor="middle" font-size="11.5" fill="currentColor" opacity=".7">every other state</text>
  <text x="526" y="170" text-anchor="middle" font-size="11" fill="currentColor" opacity=".55">never visited, never logged</text>
</svg>
<figcaption><b>Why a test set cannot judge this.</b> What you do in week one decides which states exist in week two. A log holds one path through the tree, so it can only score the policy that produced it. Any other policy reaches states the log never recorded.</figcaption>
</figure>`; },

/* A — the actual task, shown rather than described. */
extraction: function(sample){ return `
<figure class="dia">
<svg viewBox="0 0 620 176" role="img" aria-label="A seller-written listing on the left, the structured attributes that must be extracted from it on the right." style="max-width:100%;height:auto">
  <defs><marker id="ar4" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
    <polygon points="0,0 10,5 0,10" fill="currentColor"/></marker></defs>
  <rect x="8" y="26" width="286" height="122" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="8" y="18" font-size="10.5" fill="currentColor" opacity=".65">what the seller typed</text>
  ${(sample.raw||'').match(/.{1,34}(\s|$)/g).slice(0,5).map(function(l,i){
    return '<text x="20" y="'+(50+i*20)+'" font-size="12" fill="currentColor" font-family="ui-monospace,monospace">'+
      l.replace(/&/g,'&amp;').replace(/</g,'&lt;').trim()+'</text>';}).join('')}
  <line x1="294" y1="87" x2="340" y2="87" stroke="#1f3fff" stroke-width="1.6" marker-end="url(#ar4)"/>
  <rect x="348" y="26" width="264" height="122" fill="none" stroke="#1f3fff" stroke-width="1.5"/>
  <text x="348" y="18" font-size="10.5" fill="#1f3fff" opacity=".8">what has to come out</text>
  ${['category','brand','colour','size','material'].map(function(k,i){
    var v=(sample.truth||{})[k]; v=(v===''||v===undefined)?'(not stated)':v;
    return '<text x="362" y="'+(50+i*20)+'" font-size="11.5" fill="currentColor" opacity=".6">'+k+'</text>'+
      '<text x="600" y="'+(50+i*20)+'" font-size="11.5" text-anchor="end" fill="'+(v==='(not stated)'?'#a3232f':'currentColor')+'" font-family="ui-monospace,monospace">'+v+'</text>';}).join('')}
</svg>
<figcaption><b>The one task here that has a right answer.</b> Every field is checkable, labels are free, and feedback is instant. Note the red rows: when the seller never wrote an attribute, the correct output is blank, and a model that fills it with something plausible is wrong.</figcaption>
</figure>`; },
};

/* The deployment shape: one architecture, instantiated four times. Colour encodes
   WHO does each stage, because the argument is that most of it is not the model. */
window.__DIAGRAMS__.deployment = function(cfg){
  var W=620, x=8, gap=10, n=cfg.stages.length;
  var bw=(W-16-gap*(n-1))/n;
  var fill={model:'#1f3fff',code:'none',human:'none',guard:'none'};
  var stroke={model:'#1f3fff',code:'currentColor',human:'#a3232f',guard:'#a3232f'};
  var dash={model:'0',code:'0',human:'5 4',guard:'5 4'};
  var boxes = cfg.stages.map(function(s,i){
    var bx=x+i*(bw+gap), textFill = s.who==='model' ? '#fafaf7' : (s.who==='human'||s.who==='guard') ? '#a3232f' : 'currentColor';
    var lines = s.label.split('|');
    return '<rect x="'+bx.toFixed(1)+'" y="46" width="'+bw.toFixed(1)+'" height="58" fill="'+fill[s.who]+'" stroke="'+stroke[s.who]+'" stroke-width="1.6" stroke-dasharray="'+dash[s.who]+'"/>'+
      lines.map(function(l,j){ return '<text x="'+(bx+bw/2).toFixed(1)+'" y="'+(70+j*14)+'" text-anchor="middle" font-size="11" fill="'+textFill+'">'+l+'</text>';}).join('')+
      (i<n-1 ? '<line x1="'+(bx+bw).toFixed(1)+'" y1="75" x2="'+(bx+bw+gap).toFixed(1)+'" y2="75" stroke="currentColor" stroke-width="1.4"/>' : '')+
      '<text x="'+(bx+bw/2).toFixed(1)+'" y="118" text-anchor="middle" font-size="9.5" fill="currentColor" opacity=".55">'+
        (s.who==='model'?'model':s.who==='human'?'human':s.who==='guard'?'hard rule':'deterministic')+'</text>';
  }).join('');
  return `
<figure class="dia">
<svg viewBox="0 0 620 190" role="img" aria-label="${cfg.alt}" style="max-width:100%;height:auto">
  <defs><marker id="ard" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
    <polygon points="0,0 10,5 0,10" fill="currentColor"/></marker></defs>
  <text x="8" y="30" font-size="11" fill="currentColor" opacity=".7">what we would build and own</text>
  ${boxes}
  <path d="M ${(x+(n-1)*(bw+gap)+bw/2).toFixed(1)} 130 L ${(x+(n-1)*(bw+gap)+bw/2).toFixed(1)} 150 L ${(x+cfg.returnTo*(bw+gap)+bw/2).toFixed(1)} 150 L ${(x+cfg.returnTo*(bw+gap)+bw/2).toFixed(1)} 130"
        fill="none" stroke="#1f3fff" stroke-width="1.4" stroke-dasharray="4 3" marker-end="url(#ard)"/>
  <text x="${(W/2).toFixed(1)}" y="176" text-anchor="middle" font-size="11" fill="#1f3fff">${cfg.loop}</text>
</svg>
<figcaption><b>${cfg.own}</b> ${cfg.note}</figcaption>
</figure>`;
};


/* The portfolio argument as a picture: pool size against defensibility.
   A sits alone in the corner everyone competes for. */
window.__DIAGRAMS__.matrix = function(){ return `
<figure class="dia">
<svg viewBox="0 0 620 340" role="img" aria-label="A two by two of pool size against defensibility. Archetype A has the largest pool and the least defensibility. B, C and D have smaller pools and are far harder to displace." style="max-width:100%;height:auto">
  <defs><marker id="arm" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
    <polygon points="0,0 10,5 0,10" fill="currentColor"/></marker></defs>
  <line x1="70" y1="290" x2="592" y2="290" stroke="currentColor" stroke-width="1.4" marker-end="url(#arm)"/>
  <line x1="70" y1="290" x2="70" y2="26" stroke="currentColor" stroke-width="1.4" marker-end="url(#arm)"/>
  <text x="330" y="316" text-anchor="middle" font-size="12" fill="currentColor" opacity=".72">size of the pool in India</text>
  <text x="20" y="160" text-anchor="middle" font-size="12" fill="currentColor" opacity=".72" transform="rotate(-90 20 160)">how hard you are to displace</text>
  <line x1="70" y1="150" x2="592" y2="150" stroke="currentColor" stroke-width="1" opacity=".18"/>
  <line x1="330" y1="26" x2="330" y2="290" stroke="currentColor" stroke-width="1" opacity=".18"/>

  <circle cx="492" cy="238" r="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5 4" opacity=".5"/>
  <text x="492" y="236" text-anchor="middle" font-size="11.5" fill="currentColor" opacity=".62">gradeable</text>
  <text x="492" y="252" text-anchor="middle" font-size="11.5" fill="currentColor" opacity=".62">work</text>
  <text x="492" y="292" text-anchor="middle" font-size="11.5" fill="currentColor" opacity=".62">priced per unit</text>

  <circle cx="176" cy="86" r="28" fill="#1f3fff" opacity=".14"/>
  <circle cx="176" cy="86" r="28" fill="none" stroke="#1f3fff" stroke-width="1.8"/>
  <text x="176" y="93" text-anchor="middle" font-size="18" font-weight="700" fill="#1f3fff">A</text>
  <circle cx="256" cy="134" r="28" fill="#1f3fff" opacity=".14"/>
  <circle cx="256" cy="134" r="28" fill="none" stroke="#1f3fff" stroke-width="1.8"/>
  <text x="256" y="141" text-anchor="middle" font-size="18" font-weight="700" fill="#1f3fff">B</text>
  <circle cx="158" cy="182" r="28" fill="#1f3fff" opacity=".14"/>
  <circle cx="158" cy="182" r="28" fill="none" stroke="#1f3fff" stroke-width="1.8"/>
  <text x="158" y="189" text-anchor="middle" font-size="18" font-weight="700" fill="#1f3fff">C</text>
  <text x="206" y="42" text-anchor="middle" font-size="11.5" fill="#1f3fff">decisions and actions you own</text>

  <text x="404" y="70" font-size="12" fill="currentColor" opacity=".55">every lab and every consultancy</text>
  <text x="404" y="88" font-size="12" fill="currentColor" opacity=".55">is already chasing the corner</text>
  <text x="404" y="106" font-size="12" fill="currentColor" opacity=".55">that can be benchmarked</text>
</svg>
<figcaption><b>The benchmarkable corner is where margin goes to die.</b> Work with a right answer per row is the most legible in the market, so it is the most competed and the easiest thing for a procurement team to price per unit. A system that underwrites, prices or acts is not swapped out on a per-unit price, because nobody can produce a number that says the replacement is as good.</figcaption>
</figure>`; };
