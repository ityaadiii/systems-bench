(function(){
  "use strict";
  var D = window.__SYSBENCH__, DIA = window.__DIAGRAMS__ || {};
  if (!D) return;
  var inr = function(v){ var n=Math.abs(v);
    if(n>=1e7) return (v<0?"-":"")+"₹"+(n/1e7).toFixed(2)+" Cr";
    if(n>=1e5) return (v<0?"-":"")+"₹"+(n/1e5).toFixed(2)+" L";
    return (v<0?"-":"")+"₹"+Math.round(n).toLocaleString("en-IN"); };
  var pct = function(v,d){ return (v*100).toFixed(d===undefined?0:d)+"%"; };
  var esc = function(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;"); };
  var A = D.byArchetype, M = D.archetypes;
  var CH = window.__CHARTS__ || {}, CAP = window.__CAPTIONS__ || {};
  function chartSlide(k, kicker, head, aside){
    var holder = document.createElement('div');
    var fn = CH[k]; if (!fn) return null;
    holder.appendChild(fn((A[k]||{}).detail||{}));
    return '<p class="kick">'+kicker+'</p><h2 class="display">'+head+'</h2>'+
      '<div class="cols"><figure>'+holder.innerHTML+
        '<figcaption><b>Measured.</b> '+esc(CAP[k]||'')+'</figcaption></figure>'+
      '<div>'+aside+'</div></div>';
  }
  // Assigned before the slide list is built: `var` hoists the declaration but not
  // the value, so referencing these below their old position gave undefined.
  var DEFECTS = window.__DEFECTS__ || [];
  var CODE = { stakes:"A", "no-truth":"B", adversarial:"C" };
  var ORDER = ["stakes","no-truth","adversarial"];
  var g = function(k,p,f){ var o=(A[k]||{}).detail||{}; return p.split(".").reduce(function(a,x){return a&&a[x];},o) || f; };

  /* A problem slide leads with the number that makes it a business problem.
     The paragraph underneath is support, not the point. */
  /* Two columns, not one. A text-only slide stacked on the left leaves the
     right half of a 16:9 frame empty and the weight lopsided. */
  function problem(fig, unit, head, line){
    return '<p class="kick">the problem</p>'+
      '<div class="split2">'+
        '<div><div class="hero-n"><span class="hn num">'+fig+'</span></div>'+
          '<span class="hu">'+unit+'</span></div>'+
        '<div><h2 class="display" style="margin-bottom:.3em">'+head+'</h2>'+
          '<p class="big" style="max-width:38ch">'+line+'</p></div>'+
      '</div>';
  }

  function stat(v,l,gl,tone){ return '<div class="stat"><span class="sv'+(tone?" "+tone:"")+'">'+esc(v)+
    '</span><span class="sl">'+esc(l)+'</span><span class="sg">'+esc(gl)+'</span></div>'; }

  /* ---- the deck. one idea per slide, in the order the argument builds. ---- */
  var S = [];
  var push = function(cls, html){ S.push({cls:cls, html:html}); };

  push("ctr", '<h1 class="display" style="max-width:20ch">One choice sets our margin for the next five years.</h1>'+
    '<p class="big" style="margin-top:.9em">Which kind of problem we become known for solving.</p>');

  push("mid", '<p class="kick">two kinds of work</p><h2 class="display">Both are real. They build different companies.</h2>'+
    '<div class="split2" style="margin-top:.6em">'+
      '<div><span class="sv" style="font-size:clamp(1.15rem,2.2vw,1.7rem)">work with a right answer</span>'+
        '<p style="margin-top:.5em">Cheap, high volume, checkable per row. Fast to sell, easy to prove, and any buyer can compare four vendors on the same score.</p></div>'+
      '<div><span class="sv" style="font-size:clamp(1.15rem,2.2vw,1.7rem)">work where nobody can say</span>'+
        '<p style="margin-top:.5em">Decisions worth lakhs. Prices with no correct answer. Systems that act. Slower to sell, and the buyer keeps you once you are in.</p></div>'+
    '</div>'+
    '<p style="margin-top:1.1em">The first pool is bigger. The second is where a deployment company compounds.</p>');

  if (DIA.matrix) push("mid", '<p class="kick">the map</p>'+
    '<h2 class="display" style="max-width:24ch">The second pool is open because it is hard to prove.</h2>'+DIA.matrix());

  push("ctr", '<h2 class="display" style="max-width:22ch">Which makes proof the product.</h2>'+
    '<p class="big" style="margin-top:.8em">If we can measure work the buyer cannot measure, we can take work nobody else can price.</p>');

  push("mid", '<p class="kick">three of them</p>'+
    '<h2 class="display">Three of them, and what each one needs.</h2>'+
    '<div class="map4" style="grid-template-columns:repeat(3,1fr)">'+ORDER.map(function(k){
      var m=M[k]; return '<div class="breaks">'+
        '<span class="code">'+CODE[k]+'</span>'+
        '<span class="acct">'+esc((A[k]||{}).account||"")+'</span>'+
        '<h4>'+esc(m.label)+'</h4>'+
        '<p class="u" style="font-size:.92em">'+esc(m.note)+'</p>'+
        '<p class="v">'+esc(m.method)+'</p></div>'; }).join('')+
    '</div>'+
    '<p style="margin-top:1em">Each needs a different way of proving it worked. That is the capability, and it is what the rest of this is. <span style="font-size:.86em">Accounts hypothesised from public business models.</span></p>');

  /* ---- B ---- */
  push("mid", '<p class="kick">'+esc((A.stakes||{}).account)+' &#183; archetype A</p>'+
    problem("\u20B94,00,000","lent against a workshop with no books","One decision, nine thousand times a month.",
      "An officer visits, reads an informal ledger, forms a view. The queue caps growth. The cutoff is instinct."));
  if (DIA.selective) push("mid", DIA.selective(g("stakes","n",0), g("stakes","best.approved",0), g("stakes","selectiveLabels.declined",0)));
  push("ctr", '<p class="quote">You only ever see outcomes for the ones you approved. So accuracy here is not hard to compute. It is undefined.</p>');
  if (DIA.deployment) push("mid", DIA.deployment(BUILD("stakes")));
  push("mid", '<p class="kick">what we measured</p><h2 class="display">A switch, not a dial.</h2>'+
    '<div class="cols"><div class="tw"><table><thead><tr><th class="l"></th><th>today</th><th>with the system</th></tr></thead><tbody>'+
      '<tr><td class="l">Who sets the cutoff</td><td>an officer, file by file</td><td class="aft">one policy, from book economics</td></tr>'+
      '<tr><td class="l">Approval rates reachable</td><td>anything, by judgement</td><td class="aft">'+REACH()+'</td></tr>'+
      '<tr><td class="l">Profit per application</td><td>not measured today</td><td class="aft">'+inr(g("stakes","best.profitPerApplication",0))+'</td></tr>'+
    '</tbody></table></div>'+
    '<div><p><strong>So few distinct risk scores</strong> that the book runs at those rates and nothing between. A lender tunes approval rate to funding and appetite.</p>'+
    '<p style="color:var(--tx)">So the first thing to build is not a better model. It is a calibration layer that turns a coarse score into a dial.</p></div></div>');

  (function(){ var sl = chartSlide("stakes","the frontier","Profit against where you draw the line.",
    '<p><strong>Profit per application against the cutoff.</strong> Accuracy appears nowhere. It cannot be computed here.</p>'+
    '<p>A step, not a curve. That is the coarse-score problem seen side on.</p>');
    if (sl) push("mid", sl); })();

  /* ---- C ---- */
  push("mid", '<p class="kick">'+esc((A["no-truth"]||{}).account)+' &#183; archetype B</p>'+
    problem("\u20B9420","a day, per car, while it sits","Twelve thousand cars on your own balance sheet.",
      "Price high and it ages. Price low and the margin is gone. Nobody can say whether another markup was better."));
  if (DIA.counterfactual) push("mid", DIA.counterfactual(g("no-truth","n",0), Math.round(g("no-truth","collapse.essExploring",0))));
  push("mid", '<p class="kick">what we measured</p><h2 class="display">The obvious method is the wrong one.</h2>'+
    '<div class="cols"><div class="stats">'+
      stat(inr(Math.abs(g("no-truth","exploring.direct",0)-g("no-truth","exploring.truth",0))),"how far the obvious method is off","fit a demand model on history, simulate the new policy, believe it","bad")+
      stat(Math.round(g("no-truth","collapse.essExploring",0))+" of "+g("no-truth","n",0),"rows that actually inform","importance weights collapse the rest to nothing")+
      stat(inr(g("no-truth","deterministic.ips",0)),"same estimate, unexplored log","was "+inr(g("no-truth","exploring.ips",0))+". the only difference is the old desk never randomised","bad")+
    '</div><div><p><strong>Fit a demand model on your pricing history and simulate a new policy through it</strong>, and you will believe it earns far more than it does. It extrapolates into prices the log never contained.</p></div></div>');
  (function(){ var sl = chartSlide("no-truth","four estimators","Only one of them is close.",
    '<p><strong>The rule is the truth</strong>, knowable only because this market is simulated. On real data you never find out.</p>'+
    '<p>Red overshoots. The obvious method is the worst of the four.</p>');
    if (sl) push("mid", sl); })();

  push("ctr", '<p class="quote">Your four years of pricing history cannot evaluate a new pricing policy. You find that out after building one.</p>');
  if (DIA.deployment) push("mid", DIA.deployment(BUILD("no-truth")));

  /* ---- D ---- */
  push("mid", '<p class="kick">'+esc((A.adversarial||{}).account)+' &#183; archetype C</p>'+
    problem("40,000","past-due accounts that answer back","Every contact changes the next one.",
      "Contact costs money and risks a complaint. The floor runs a fixed ladder because testing an alternative means testing it on people."));
  if (DIA.trajectory) push("mid", DIA.trajectory());
  if (DIA.deployment) push("mid", DIA.deployment(BUILD("adversarial")));
  push("mid", '<p class="kick">what we measured</p><h2 class="display">Walked forward, not scored.</h2>'+
    '<div class="cols"><div class="tw"><table><thead><tr><th class="l">policy</th><th>recovered</th><th>per ₹1</th><th>complaints</th></tr></thead><tbody>'+
      (g("adversarial","policies",[])||[]).slice(0,3).map(function(p,i){
        return '<tr><td class="l">'+esc(p.name.split(" (")[0])+'</td><td class="'+(i===0?"aft":"")+'">'+pct(p.recoveryRate||0,1)+
          '</td><td>₹'+(p.costPerRupee||0).toFixed(2)+'</td><td>'+(p.complaints||0)+'</td></tr>'; }).join('')+
    '</tbody></table></div>'+
    '<div><p><strong>Walked forward against the same borrowers.</strong> The only way to compare two strategies without running both on people.</p></div></div>');

  (function(){ var sl = chartSlide("adversarial","eight weeks","Where the difference actually lives.",
    '<p><strong>Cumulative recovery, three policies</strong>, walked forward against the same borrowers.</p>'+
    '<p>At week one they are indistinguishable. The horizon is the only place the gap exists.</p>');
    if (sl) push("mid", sl); })();

  /* ---- the argument ---- */
  push("ctr", '<h2 class="display" style="max-width:22ch">Three problems, three ways to prove it worked.</h2>'+
    '<p class="big" style="margin-top:.7em">A cohort backtest. An off-policy estimator. An adversarial rollout. Each one is a capability we would own.</p>');
  push("mid", '<p class="kick">what it buys</p><h2 class="display">Nobody can undercut a number they cannot produce.</h2>'+
    '<div class="split2" style="margin-top:.6em">'+
      '<div><p><strong>On a benchmark, the best score wins and the price falls.</strong> That is what a benchmark is for.</p></div>'+
      '<div><p><strong>On profit per application over an eighteen month cohort, we set the terms</strong>, because we are the ones who can compute it.</p></div>'+
    '</div>'+
    '<p style="margin-top:1em">$30&#8211;40bn went into enterprise GenAI pilots and 95% returned nothing measurable. Not because the models were weak. Because nobody could tell. <span style="font-size:.86em">MIT Project NANDA</span></p>');

  push("mid", '<p class="kick">and it kept catching me</p><h2 class="display">Nine defects, found by its own tests.</h2>'+
    '<ol class="nine">'+DEFECTS.map(function(d){ return '<li'+(d[1]?' class="self"':'')+'>'+esc(d[0])+'</li>'; }).join('')+'</ol>'+
    '<p style="margin-top:.8em">Three pointed the same way, toward the conclusion the bench was built to argue for. They flattered the thesis.</p>');

  push("mid", '<p class="kick">the models</p><h2 class="display">Newer is not better. It is better at some things.</h2>'+
    '<div class="tw"><table><thead><tr><th class="l">model</th><th>size</th><th>catalogue</th><th>underwriting</th><th>collections</th></tr></thead><tbody>'+
      '<tr><td class="l">qwen2.5 7b-instruct</td><td>7.6B</td><td>51.7%</td><td class="aft">\u20B941,217</td><td>31.1%</td></tr>'+
      '<tr><td class="l">qwen3 8b</td><td>8.2B</td><td>51.7%</td><td>\u20B940,050</td><td class="aft">36.5%</td></tr>'+
      '<tr><td class="l" style="color:var(--bad)">qwen2.5 14b-instruct</td><td>14.8B</td><td colspan="3" style="text-align:left;color:var(--bad)">disqualified on measured latency, 72.8s per invoice</td></tr>'+
    '</tbody></table></div>'+
    '<div class="cols" style="margin-top:1em"><div><p><strong>A generation apart, and they split the workloads.</strong> Older wins underwriting. Newer wins collections.</p></div>'+
    '<div><p><strong>The 14b was cut on evidence.</strong> 72.8s per invoice is ~2,000 GPU-hours a month. A deployment constraint no leaderboard reports.</p></div></div>');

  push("mid", '<p class="kick">how it runs</p><h2 class="display">No cloud, no keys, no dependencies.</h2>'+
    '<div class="bignums">'+
      [["0","runtime dependencies. Node 24 strips the types, so there is no build step"],
       ["2","open models served locally by Ollama, Q4_K_M, one at a time on the GPU"],
       [D.totals.attempts.toLocaleString("en-IN"),"calls, content-addressed and cached, so re-analysis costs nothing"],
       ["40","unit tests. Wilson intervals and exact McNemar checked against textbook values"],
       ["4,889","lines of TypeScript, 408 of them tests"],
       [inr(D.totals.costUsd*88),"spent. No API key was ever present in the environment"]]
      .map(function(r){ return '<div><span class="bn num">'+r[0]+'</span><span class="bl">'+r[1]+'</span></div>'; }).join('')+
    '</div>'+
    '<p style="max-width:78ch;margin-top:.4em">Local inference was the deliberate choice: on a hosted API you cannot separate your own rate limiting from the model being slow, and the latency numbers had to mean something. <strong>Three rewrites. The two abandoned versions are why this one is shaped the way it is.</strong></p>');

  push("ctr", '<p class="quote">The deliverable is not a score. It is knowing, in a first meeting, which of a prospect’s problems can be measured the usual way and what to do instead for the ones that cannot.</p>');

  push("ctr", '<h1 class="display" style="font-size:clamp(1.8rem,4.4vw,3.4rem)">Aditi Singh</h1>'+
    '<p style="margin-top:1em">'+esc(D.totals.attempts.toLocaleString("en-IN"))+' model calls, run locally, '+inr(D.totals.costUsd*88)+' spent.</p>'+
    '<p style="font-size:12.5px;max-width:70ch">'+esc(D.disclaimer)+'</p>');

  function BUILD(k){ return window.__BUILDS__[k]; }
  function REACH(){
    var fr = g("stakes","frontier",[])||[], r=[];
    fr.forEach(function(x){ var v=Math.round(x.approvalRate*100); if(v>0&&r.indexOf(v)<0) r.push(v); });
    r.sort(function(a,b){return a-b;});
    return r.length ? r.join("%, ")+"%" : "none";
  }

  /* ---- render + navigation ---- */
  var deck = document.getElementById("deck");
  S.forEach(function(s,i){
    var el = document.createElement("section");
    el.className = "slide " + (s.cls||"");
    el.setAttribute("aria-hidden","true");
    el.innerHTML = s.html;
    deck.appendChild(el);
  });
  var slides = deck.querySelectorAll(".slide"), n = slides.length, at = 0;
  var bar = document.querySelector("nav i"), hud = document.querySelector(".hud");

  function show(i){
    at = Math.max(0, Math.min(n-1, i));
    for (var j=0;j<n;j++){
      slides[j].classList.toggle("on", j===at);
      slides[j].setAttribute("aria-hidden", j===at ? "false" : "true");
    }
    bar.style.width = ((at+1)/n*100)+"%";
    hud.textContent = (at+1)+" / "+n;
    if (location.hash !== "#"+(at+1)) history.replaceState(null,"","#"+(at+1));
  }
  document.addEventListener("keydown", function(e){
    if (e.key==="ArrowRight"||e.key==="ArrowDown"||e.key===" "||e.key==="PageDown"){ e.preventDefault(); show(at+1); }
    if (e.key==="ArrowLeft"||e.key==="ArrowUp"||e.key==="PageUp"){ e.preventDefault(); show(at-1); }
    if (e.key==="Home") show(0);
    if (e.key==="End") show(n-1);
  });
  deck.addEventListener("click", function(e){ show(at + (e.clientX < innerWidth*0.28 ? -1 : 1)); });
  var x0=null;
  deck.addEventListener("touchstart", function(e){ x0=e.touches[0].clientX; }, {passive:true});
  deck.addEventListener("touchend", function(e){
    if(x0===null) return; var dx=e.changedTouches[0].clientX-x0;
    if(Math.abs(dx)>44) show(at + (dx<0?1:-1)); x0=null; }, {passive:true});
  show(Math.max(0,(parseInt(location.hash.slice(1),10)||1)-1));
})();
