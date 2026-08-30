(function(){
  "use strict";
  var D = window.__SYSBENCH__; if (!D) return;
  var $ = function(s){ return document.querySelector(s); };
  var NS = "http://www.w3.org/2000/svg";
  function el(n,a){ var e=document.createElementNS(NS,n); for(var k in a) e.setAttribute(k,a[k]); return e; }
  function tx(x,y,s,anchor,fill){ var t=el("text",{x:x,y:y,"class":"ax","text-anchor":anchor||"middle"}); if(fill)t.setAttribute("fill",fill); t.textContent=s; return t; }
  var inr = function(v){
    var n = Math.abs(v);
    if (n >= 1e7) return (v<0?"-":"")+"₹"+(n/1e7).toFixed(2)+" Cr";
    if (n >= 1e5) return (v<0?"-":"")+"₹"+(n/1e5).toFixed(2)+" L";
    return (v<0?"-":"")+"₹"+Math.round(n).toLocaleString("en-IN");
  };
  var pct = function(v,d){ return (v*100).toFixed(d===undefined?0:d)+"%"; };
  var esc = function(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;"); };

  $("[data-disclaimer]").textContent = D.disclaimer;

  /* ---------------- the map ---------------- */
  var ORDER = ["stakes","no-truth","adversarial"];
  var CODE = { stakes:"A", "no-truth":"B", adversarial:"C" };
  var map = $("[data-map]");
  ORDER.forEach(function(k){
    var m = D.archetypes[k], acct = D.accounts[k];
    var d = document.createElement("div");
    d.className = "arch " + (m.gradeable ? "works" : "breaks");
    d.innerHTML =
      '<span class="code">'+CODE[k]+'</span>'+
      '<span class="acct">'+esc(acct)+'</span>'+
      '<h4>'+esc(m.label)+'</h4>'+
      '<p class="unit">Unit of evaluation: <b>'+esc(m.unit)+'</b><br>'+esc(m.method)+'</p>'+
      '<p class="verdict">'+(m.gradeable ? "gradeable" : "cannot be graded")+'</p>'+
      '<p class="why">'+esc(m.note)+'</p>';
    map.appendChild(d);
  });

  /* Charts live in shared-charts.js so the deck renders the identical ones. */
  var CHART = window.__CHARTS__ || {}, CAPTION = window.__CAPTIONS__ || {};

  /* ---------------- panels ---------------- */
  var DIA = window.__DIAGRAMS__ || {};
  var host = $("[data-panels]");

  /* Every figure the page shows gets a one-line definition next to it. A number
     the reader cannot define is decoration. */
  function diffBlock(rows, note){
    return '<div class="diff"><table><thead><tr><th class="l"></th><th>today</th><th>with the system</th></tr></thead><tbody>'+
      rows.map(function(r){ return '<tr><td class="l">'+esc(r[0])+'</td><td>'+esc(r[1])+'</td><td class="aft">'+esc(r[2])+'</td></tr>'; }).join('')+
      '</tbody></table>'+(note?'<p class="dn">'+esc(note)+'</p>':'')+'</div>';
  }

  function stat(value, label, gloss, tone){
    return '<div class="stat"><span class="sv'+(tone?" "+tone:"")+'">'+esc(value)+'</span>'+
      '<span class="sl">'+esc(label)+'</span><span class="sg">'+esc(gloss)+'</span></div>';
  }

  ORDER.forEach(function(k){
    var r = D.byArchetype[k]; if (!r) return;
    var m = D.archetypes[k], d = r.detail || {};
    var p = document.createElement("section");
    p.className = "panel";

    var problem = {
      volume: "Four million listings a month arrive as search-optimised prose. Until they are structured, filters do not work, recommendations do not work, and the listing is effectively invisible to anyone who does not search its exact words. Today a catalogue team touches all of it.",
      stakes: "Nine thousand applications a month, four lakh each, from businesses with no audited books. A credit officer visits, reads an informal ledger, and forms a view. The queue caps how fast the book can grow, and the cutoff they apply is set by instinct.",
      "no-truth": "Twelve thousand cars a month sitting on the platform's own balance sheet at four hundred and twenty rupees a day. Price high and the car ages. Price low and the margin is gone. A desk sets a markup on a valuation and nobody can say whether a different markup would have been better.",
      adversarial: "Forty thousand past-due accounts. Every contact costs money, risks a complaint, and changes how the borrower responds to the next one. The floor runs a fixed escalation ladder because nobody can test an alternative without trying it on real people.",
    }[k];

    var BUILD = {
      volume: { alt:'A pipeline: deterministic normalisation, a model that extracts attributes, a confidence gate, automatic publishing, and a human review lane, with corrections feeding back.',
        stages:[{who:'code',label:'normalise|strip filler'},{who:'model',label:'extract|attributes'},{who:'code',label:'confidence|gate'},{who:'code',label:'auto-publish'},{who:'human',label:'review|the tail'}],
        returnTo:1, loop:'reviewer corrections retrain the extractor and extend the taxonomy',
        own:'Deployment owns the enrichment rate, not the model.',
        note:'The contract is a share of the catalogue live and correct inside an error budget. The review lane is sized to exactly what the model cannot carry, and it shrinks as the loop runs.' },
      stakes: { alt:'A pipeline: document parsing, a model that reads the file and scores it, calibration against observed defaults, a policy threshold set from book economics, and a referral band for a credit officer.',
        stages:[{who:'code',label:'parse file|GST, ledger'},{who:'model',label:'read and|score'},{who:'code',label:'calibrate|to observed PD'},{who:'guard',label:'policy|threshold'},{who:'human',label:'refer band|officer'}],
        returnTo:3, loop:'eighteen month outcomes retune the threshold, not the model',
        own:'Deployment owns profit per application.',
        note:'The model produces a probability. Turning it into a decision is a threshold set from the book economics, and that threshold is worth more than the model is.' },
      'no-truth': { alt:'A pipeline: reference valuation, a model that proposes a price, an exploration sampler that deliberately randomises, listing, and outcome logging that makes future evaluation possible.',
        stages:[{who:'code',label:'reference|valuation'},{who:'model',label:'propose|price'},{who:'guard',label:'exploration|sampler'},{who:'code',label:'list'},{who:'code',label:'log the|outcome'}],
        returnTo:1, loop:'the log can now evaluate any future pricing policy, which it could not before',
        own:'Deployment owns margin per car, and the ability to keep improving it.',
        note:'The exploration sampler is the stage nobody asks for and the only one that makes the rest possible. Without deliberate randomisation the history cannot evaluate anything, and every future pricing change stays a guess.' },
      adversarial: { alt:'A pipeline: account state, a model that chooses the weekly action, hard contact limits, execution, and observation of the response which updates the state.',
        stages:[{who:'code',label:'account|state'},{who:'model',label:'choose|action'},{who:'guard',label:'contact|limits'},{who:'code',label:'execute'},{who:'code',label:'observe|response'}],
        returnTo:0, loop:'every response changes the state the next decision will see',
        own:'Deployment owns recovery net of complaint cost.',
        note:'Policies are tested in the simulator before they touch a borrower, and the contact limits are hard rules the model is not allowed to argue with.' },
    }[k];

    var dia = k === "volume"      ? (DIA.extraction ? DIA.extraction(D.sample||{raw:"",truth:{}}) : "")
            : k === "stakes"      ? (DIA.selective ? DIA.selective(d.n||0, (d.best&&d.best.approved)||0, (d.selectiveLabels&&d.selectiveLabels.declined)||0) : "")
            : k === "no-truth"    ? (DIA.counterfactual ? DIA.counterfactual(d.n||0, Math.round((d.collapse&&d.collapse.essExploring)||0)) : "")
            :                       (DIA.trajectory ? DIA.trajectory() : "");

    var stats = "";
    if (k === "volume") {
      stats = stat(pct(d.accuracy||0,1), "all five fields right", "one wrong field fails the row") +
              stat(String(d.inventedBrands||0)+" of "+(d.n||0), "attributes invented", "filled a blank the listing never stated") +
              stat(d.coverage ? pct(d.coverage) : "none", "safe to auto-approve", "inside a 2% escaped-error budget", d.coverage?"":"bad");
    } else if (k === "stakes") {
      var fr = d.frontier||[], best = d.best||{};
      /* The frontier is a step, not a curve: the model emits only a handful of
         distinct probabilities, so the threshold behaves as a switch rather than
         a dial. Comparing against an arbitrary tighter cutoff produced a
         degenerate row where nobody is approved, which measures nothing. */
      var reachable = [];
      fr.forEach(function(x){
        var rr = Math.round(x.approvalRate*100);
        if (rr > 0 && reachable.indexOf(rr) < 0) reachable.push(rr);
      });
      reachable.sort(function(a,b){ return a-b; });
      diff = diffBlock([
        ["Who sets the cutoff", "a credit officer, file by file", "one policy, from book economics"],
        ["Approval rates actually reachable", "anything, by judgement",
          reachable.length ? reachable.join("%, ")+"%" : "none"],
        ["Profit per application at the best of them", "not measured today", inr(best.profitPerApplication||0)],
        ["Default rate there", "not measured today", pct(best.defaultRate||0,1)],
      ], reachable.length <= 4
        ? "Look at the second row. This model emits so few distinct risk scores that the book can only be run at "+reachable.join("%, ")+"%, and nothing in between. A lender tunes approval rate to funding and appetite, so the first thing to build here is not a better model. It is a calibration layer that turns a coarse score into a dial."
        : "The threshold is the product. The model supplies a probability; the decision comes from book economics, and moving that cutoff is worth more than swapping the model underneath it.");
    } else if (k === "no-truth") {
      var e2=d.exploring||{}, c=d.collapse||{};
      stats = stat(inr(Math.abs((e2.direct||0)-(e2.truth||0))), "how far the obvious method is off", "fit a demand model on history, simulate the new policy, believe it", "bad") +
              stat(Math.round(c.essExploring||0)+" of "+(d.n||0), "rows that actually inform", "importance weights collapse the rest to nothing") +
              stat(inr(((d.deterministic||{}).ips)||0), "same estimate, unexplored log", "was "+inr(e2.ips||0)+". the only difference is the old desk never randomised", "bad");
    } else {
      var my=d.myopia||{}, pol=(d.policies||[])[0]||{};
      stats = stat(pct(pol.recoveryRate||0,1), "of the book recovered", "across an eight week horizon, not one decision") +
              stat("₹"+(pol.costPerRupee||0).toFixed(2), "spent per ₹1 recovered", "contact cost, including complaints") +
              stat(String(pol.complaints||0), "accounts complained", "a complaint ends the account and costs money", "bad");
    }

    /* The difference, before and after. Derived from measurement wherever a
       measurement exists, and explicitly not invented where it does not. */
    var diff = "";
    if (k === "volume") {
      var hrsNow = Math.round(4000000*30/3600), hrsAfter = Math.round(hrsNow*(1-(d.coverage||0)));
      diff = diffBlock([
        ["Listings a person touches", "all 4,000,000", d.coverage ? pct(1-d.coverage)+" of them" : "still all of them"],
        ["Catalogue hours a month", hrsNow.toLocaleString("en-IN"), d.coverage ? hrsAfter.toLocaleString("en-IN") : "unchanged"],
        ["Monthly cost", inr(d.manualInr||0), inr((d.reviewInr||0)+(d.inferInr||0))],
      ], d.coverage ? null
        : "At this accuracy nothing clears a 2% error budget, so the honest answer is that the review lane does not shrink yet. The system still pays, because reviewing a draft beats starting blank, but the headline is not automation.");
    } else if (k === "stakes") {
      var fr = d.frontier||[], best = d.best||{}, reachable = [];
      /* The frontier is a step, not a curve: the model emits only a handful of
         distinct probabilities, so the threshold behaves as a switch rather than
         a dial. An earlier version compared against an arbitrary tighter cutoff
         and produced a row where nobody was approved, which measures nothing. */
      fr.forEach(function(x){
        var rr = Math.round(x.approvalRate*100);
        if (rr > 0 && reachable.indexOf(rr) < 0) reachable.push(rr);
      });
      reachable.sort(function(a,b){ return a-b; });
      diff = diffBlock([
        ["Who sets the cutoff", "a credit officer, file by file", "one policy, from book economics"],
        ["Approval rates actually reachable", "anything, by judgement", reachable.length ? reachable.join("%, ")+"%" : "none"],
        ["Profit per application at the best of them", "not measured today", inr(best.profitPerApplication||0)],
        ["Default rate there", "not measured today", pct(best.defaultRate||0,1)],
      ], reachable.length <= 4
        ? "Look at the second row. This model emits so few distinct risk scores that the book can only be run at "+reachable.join("%, ")+"%, and nothing in between. A lender tunes approval rate to funding and appetite, so the first thing to build is not a better model. It is a calibration layer that turns a coarse score into a dial."
        : "The threshold is the product. The model supplies a probability; the decision comes from book economics, and moving that cutoff is worth more than swapping the model underneath it.");
    } else if (k === "no-truth") {
      var e3 = d.exploring||{}, x3 = d.deterministic||{};
      diff = diffBlock([
        ["Can a new pricing policy be evaluated?", "no, the history has no exploration", "yes, off-policy against the log"],
        ["What today's log would have said it earns", inr(x3.ips||0), inr(e3.ips||0)],
        ["Best estimate of this policy", "unavailable at any sample size", inr(e3.doublyRobust||0)+" per car"],
      ], "The first row is the engagement. Adding deliberate randomisation costs a little margin today and is the only thing that makes every future pricing decision measurable at all.");
    } else {
      var pols = d.policies||[], mine = pols[0]||{}, ladder = pols[2]||pols[1]||{};
      diff = diffBlock([
        ["Policy", "fixed escalation ladder", "weekly policy, horizon aware"],
        ["Recovered over eight weeks", pct(ladder.recoveryRate||0,1), pct(mine.recoveryRate||0,1)],
        ["Spent per rupee recovered", "₹"+(ladder.costPerRupee||0).toFixed(2), "₹"+(mine.costPerRupee||0).toFixed(2)],
        ["Complaints", String(ladder.complaints||0), String(mine.complaints||0)],
      ], "Both policies were walked forward against the same simulated borrowers. That is the only way to compare two collections strategies without running both of them on real people first.");
    }

    p.innerHTML =
      '<div class="phead"><span class="acct">'+esc(r.account)+' &#183; archetype '+CODE[k]+'</span>'+
        '<h3>'+esc(r.title)+'</h3><p class="prob">'+esc(problem)+'</p></div>'+
      dia +
      (DIA.deployment ? DIA.deployment(BUILD) : '') +
      '<div class="two"><figure data-fig></figure><div class="stats">'+stats+
        '<details class="fine"><summary>what this evaluation cannot tell you</summary><ul>'+
          (r.caveats||[]).map(function(c){ return '<li>'+esc(c)+'</li>'; }).join('')+'</ul></details>'+
      '</div></div>' + diff;

    var fig = p.querySelector("[data-fig]");
    fig.appendChild((CHART[k]||chartCoverage)(d));
    var cap = document.createElement("figcaption"); cap.innerHTML = "<b>Measured.</b> " + CAPTION[k]; fig.appendChild(cap);
    host.appendChild(p);
  });

  /* ---------------- defects ---------------- */
  var DEF = [
    ["A credential check that passed on a comment","The env parser read everything after the equals sign, so a commented-out placeholder became a truthy API key. The run marked itself as real evidence and switched off the banner that says it is not.",true],
    ["My own scheduling counted as model latency","Two local models on one GPU each reported 12.8 seconds. Alone, the same model answers in 2.3. They were queueing, and the wait landed inside the measurement.",true],
    ["A per-model fix for a per-device problem","The first repair gave each model its own concurrency limit, which fixed nothing, because the contention was between different models sharing one card.",true],
    ["Generated truth demanding more than the input showed","Three times, in three workloads: a PIN absent from the address, a size absent from the listing, a priority that was only ever my opinion. Each time the grader punished a model for correctly declining to invent one.",false],
    ["Recalibration that destroyed the ranking","Isotonic regression is monotone, so it can never improve ordering, and it can pool distinct confidences into one and make them unseparable by any threshold.",false],
    ["Compositions judged on a laxer gate","Single models were held to the upper confidence bound while compositions were held to the point estimate. Compositions are what the bench argues for.",true],
    ["A numerator and a denominator from different sets","Coverage divided a count taken from 266 held-out items by a total of 400, understating every single model's coverage by a third.",true],
    ["One hung call taking a whole run with it","A single request wedged, hit a five minute timeout, retried four times, and discarded 150 items of completed work twenty-five minutes later. The main runner had always recorded a failure and continued; the scenarios were written later and inherited none of that.",true],
    ["A Devanagari digit inside a hex colour","A stylesheet token read #1d6b४f. It parsed as nothing, so the colour silently fell back and no error was raised anywhere.",false],
  ];
  var ol = $("[data-defects]");
  DEF.forEach(function(d){ var li=document.createElement("li"); if(d[2]) li.className="self";
    li.innerHTML="<b>"+esc(d[0])+"</b><span>"+esc(d[1])+"</span>"; ol.appendChild(li); });

  /* ---------------- totals ---------------- */
  var t = $("[data-totals]");
  [["Accounts modelled",D.totals.accounts],["Evaluation machines",D.totals.machines],
   ["Model calls",D.totals.attempts.toLocaleString("en-IN")],["Spend",inr(D.totals.costUsd*88)]]
   .forEach(function(p){ var d=document.createElement("div");
     d.innerHTML="<dt>"+p[0]+"</dt><dd><span class='num'>"+p[1]+"</span></dd>"; t.appendChild(d); });
})();
