(function(){
  "use strict";
  var D = window.__BENCH__;
  if (!D) return;

  var $ = function(s,r){ return (r||document).querySelector(s); };
  var cellOf = function(k){ for (var i=0;i<D.cells.length;i++) if (D.cells[i].key===k) return D.cells[i]; return null; };
  var shortName = function(l){ return l.replace(" (local)","").replace(" (no model)",""); };
  var inr = function(v){
    if (v >= 1e7) return "₹" + (v/1e7).toFixed(2) + " Cr";
    if (v >= 1e5) return "₹" + (v/1e5).toFixed(2) + " L";
    return "₹" + Math.round(v).toLocaleString("en-IN");
  };
  var pct = function(v,d){ return (v*100).toFixed(d===undefined?0:d) + "%"; };
  var E = D.econ, V = E.volume, perSec = E.wage/3600;

  /* Eval-set size and total errors come FROM THE CURVE, never from the cell's
     gradeable count. The curve is built on the held-out third; a numerator from
     it over a denominator from everything gradeable is the same mismatch that
     understated coverage by a third inside the bench itself. At the lowest
     threshold coverage is 1, so that point carries both figures exactly. */
  function frame(cell){
    var c = cell.curve, lo = c[0];
    for (var i=1;i<c.length;i++) if (c[i].cov > lo.cov) lo = c[i];
    return { n: lo.nAuto, errors: lo.errs };
  }

  /* Mirrors src/core/economics.ts. Reviewing a correct draft is faster than
     working from scratch; reviewing a wrong one is slower, because the error
     has to be found before it can be fixed. */
  function price(cell, pt){
    var f = frame(cell), n = f.n, totalErrors = f.errors;
    var cov = pt ? pt.cov : 0, nAuto = pt ? pt.nAuto : 0, esc = pt ? pt.errs : 0;
    var escRate = nAuto ? esc/nAuto : 0;
    var reviewed = n - nAuto;
    var wrongShare = reviewed > 0 ? Math.max(0, totalErrors - esc)/reviewed : 0;
    var factor = (1-wrongShare)*E.fCorrect + wrongShare*E.fWrong;
    var reviewSec = V*(1-cov)*E.humanSec*factor;
    var reworkSec = V*cov*escRate*E.reworkSec;
    return {
      cov: cov, escRate: escRate,
      hours: (reviewSec+reworkSec)/3600,
      total: (reviewSec+reworkSec)*perSec,
      holds: nAuto > 0 && pt.hi <= E.budget
    };
  }

  /* ---------- curve ---------- */
  var W=640,H=300,PL=52,PB=42,PT=16,PR=16, IW=W-PL-PR, IH=H-PT-PB;
  var NS="http://www.w3.org/2000/svg";
  function el(n,a){ var e=document.createElementNS(NS,n); for(var k in a) e.setAttribute(k,a[k]); return e; }
  function txt(x,y,cls,anchor,s,fill){
    var t=el("text",{x:x,y:y,"class":cls,"text-anchor":anchor}); if(fill) t.setAttribute("fill",fill);
    t.textContent=s; return t;
  }

  function drawCurve(cell, pt, animate){
    var g = $("[data-curve]"); if(!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    var pts = cell.curve.slice().sort(function(a,b){ return a.cov-b.cov; });
    if (!pts.length) return;
    var maxY = E.budget*2.2, i;
    for (i=0;i<pts.length;i++) if (pts[i].hi>maxY) maxY=pts[i].hi;
    var X=function(v){ return PL+v*IW; }, Y=function(v){ return PT+IH-(Math.min(v,maxY)/maxY)*IH; };

    g.appendChild(el("rect",{x:PL,y:PT,width:IW,height:IH,fill:"#e9e7de",opacity:".55"}));
    var up=[], lo=[];
    for (i=0;i<pts.length;i++) up.push(X(pts[i].cov).toFixed(1)+","+Y(pts[i].hi).toFixed(1));
    for (i=pts.length-1;i>=0;i--) lo.push(X(pts[i].cov).toFixed(1)+","+Y(0).toFixed(1));
    g.appendChild(el("polygon",{points:up.concat(lo).join(" "),"class":"band95"}));

    g.appendChild(el("line",{x1:PL,y1:Y(E.budget),x2:W-PR,y2:Y(E.budget),"class":"budget"}));
    g.appendChild(txt(W-PR-4, Y(E.budget)-7, "ax", "end", pct(E.budget,0)+" error budget", "#a3232f"));

    var d=""; for(i=0;i<pts.length;i++) d += (i?"L":"M")+X(pts[i].cov).toFixed(1)+","+Y(pts[i].risk).toFixed(1);
    var path = el("path",{d:d,"class":"line"});
    g.appendChild(path);

    g.appendChild(el("line",{x1:PL,y1:PT+IH,x2:W-PR,y2:PT+IH,stroke:"#d8d6cf"}));
    g.appendChild(el("line",{x1:PL,y1:PT,x2:PL,y2:PT+IH,stroke:"#d8d6cf"}));
    g.appendChild(txt(PL, H-16, "ax", "start", "0"));
    g.appendChild(txt(PL+IW/2, H-16, "ax", "middle", "50%"));
    g.appendChild(txt(W-PR, H-16, "ax", "end", "100%"));
    g.appendChild(txt(PL-8, PT+9, "ax", "end", pct(maxY,1)));
    g.appendChild(txt(PL-8, PT+IH, "ax", "end", "0"));
    g.appendChild(txt(PL+IW/2, H-2, "ax", "middle", "share auto-approved"));

    if (pt) g.appendChild(el("circle",{cx:X(pt.cov),cy:Y(pt.risk),r:6,"class":"mark"}));

    /* the one authored motion moment: the curve draws itself, once per column */
    if (animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      try {
        var len = path.getTotalLength();
        path.style.strokeDasharray = len;
        path.style.strokeDashoffset = len;
        path.getBoundingClientRect();
        path.style.transition = "stroke-dashoffset 1.1s cubic-bezier(0.22,1,0.36,1)";
        path.style.strokeDashoffset = 0;
      } catch(e) {}
    }
  }

  /* ---------- instrument ---------- */
  var current = "baseline:gazetteer", drawn = {}, thr = $("#thr");

  function nearest(cell, t){
    var best=null, bd=9;
    for (var i=0;i<cell.curve.length;i++){
      var dd = Math.abs(cell.curve[i].t - t);
      if (dd < bd){ bd = dd; best = cell.curve[i]; }
    }
    return best;
  }

  function render(animate){
    var cell = cellOf(current); if (!cell) return;
    var t = (+thr.value)/100, pt = nearest(cell, t), r = price(cell, pt);
    $("#thrOut").textContent = t.toFixed(2);
    $("[data-out=cov]").textContent  = pt ? pct(r.cov) : "0%";
    $("[data-out=esc]").textContent  = pt ? pct(r.escRate,2) : "—";
    $("[data-out=hrs]").textContent  = Math.round(r.hours).toLocaleString("en-IN");
    $("[data-out=cost]").textContent = inr(r.total);

    var v = $("[data-out=verdict]");
    if (!pt || pt.nAuto === 0){
      v.className = "verdict over";
      v.innerHTML = "Nothing is auto-approved at this threshold, so every item is reviewed by hand.";
    } else if (r.holds){
      v.className = "verdict holds";
      v.innerHTML = "<b>Holds.</b> " + pct(r.cov) + " auto-approved, " + pt.errs + " of " + pt.nAuto +
        " wrong, and the upper bound on escaped errors stays inside the " + pct(E.budget) +
        " budget. Saves " + inr(D.manual.total - r.total) + " a month against doing it by hand.";
    } else {
      v.className = "verdict over";
      v.innerHTML = "<b>Over budget.</b> " + pct(r.cov) + " auto-approved, but the upper bound on escaped errors reaches " +
        pct(pt.hi,1) + ", past the " + pct(E.budget) + " you allowed. Cheaper on paper, and not shippable.";
    }
    drawCurve(cell, pt, animate && !drawn[current]);
    if (animate) drawn[current] = true;
  }

  thr.addEventListener("input", function(){ render(false); });
  Array.prototype.forEach.call(document.querySelectorAll("[data-col]"), function(b){
    b.addEventListener("click", function(){
      Array.prototype.forEach.call(document.querySelectorAll("[data-col]"), function(o){
        o.setAttribute("aria-pressed", String(o === b));
      });
      current = b.getAttribute("data-col");
      render(true);
    });
  });

  /* ---------- grid ---------- */
  var tb = $("[data-grid]");
  D.cells.slice().sort(function(a,b){ return b.acc - a.acc; }).forEach(function(c){
    var tr = document.createElement("tr");
    if (c.key.indexOf("baseline") === 0) tr.className = "win";
    var lat = c.p95 < 5 ? "&lt;1 ms" : (c.p95 >= 1000 ? (c.p95/1000).toFixed(1)+" s" : Math.round(c.p95)+" ms");
    tr.innerHTML =
      '<td class="l"><b>' + shortName(c.label) + '</b><i>' +
        (c.key.indexOf("baseline") === 0 ? "deterministic" : "local model") + '</i></td>' +
      '<td class="num">' + pct(c.acc,1) + '<span class="ci">' + pct(c.ci.lo) + "–" + pct(c.ci.hi) + '</span></td>' +
      '<td class="num">' + (c.aurc === null ? "—" : c.aurc.toFixed(3)) + '</td>' +
      '<td class="num">' + lat + '</td>' +
      '<td class="num' + (c.auto === null ? "" : " hit") + '">' + (c.auto === null ? '<span class="none">none</span>' : pct(c.auto)) + '</td>' +
      '<td class="num">' + (c.esc === null ? "—" : pct(c.esc,2)) + '</td>' +
      '<td class="num">' + inr(c.total) + '</td>';
    tb.appendChild(tr);
  });

  /* ---------- comparisons ---------- */
  var ct = $("[data-cmp]");
  var nameOf = function(k){ var c = cellOf(k); return c ? shortName(c.label) : k; };
  D.comparisons.forEach(function(c){
    var tr = document.createElement("tr");
    tr.innerHTML = '<td>' + nameOf(c.a) + " vs " + nameOf(c.b) + '</td>' +
      '<td class="num v">' + (c.delta >= 0 ? "+" : "") + (c.delta*100).toFixed(1) + "pt</td>" +
      '<td class="num v">' + (c.pAdj < 0.001 ? "&lt;0.001" : c.pAdj.toFixed(3)) + '</td>' +
      '<td class="v"><span class="tag ' + (c.sig ? "real" : "noise") + '">' + (c.sig ? "real" : "noise") + '</span></td>';
    ct.appendChild(tr);
  });

  /* ---------- the eight ---------- */
  var defects = [
    ["A credential check that passed on a comment", "The env parser read everything after the equals sign, so a commented-out placeholder became a truthy API key. The run marked itself as real evidence and switched off the banner that says it is not, over a grid of 401 errors.", true],
    ["My own scheduling counted as model latency", "Two local models on one GPU each reported 12.8 seconds. Alone, the same model answers in 2.3. Nothing was slow; they were queueing, and the wait landed inside the measurement.", true],
    ["A per-model fix for a per-device problem", "The first repair gave each model its own concurrency limit, which fixed nothing, because the contention was between different models sharing one card. Limits belong to the resource, not the caller.", true],
    ["A grader that contradicted its own prompt", "The instructions said to abstain rather than guess. The answer key then demanded the guess anyway, so a model that obeyed was marked wrong. Fixing it moved one model from 3 of 12 to 8 of 12, with no change to the model.", false],
    ["Ground truth that was really an opinion", "Both models scored 93% on routing and 38% on priority from the same message. On several the model applied my own stated rubric more faithfully than my label did. Priority is now shown but excluded, until it has two annotators and a kappa.", false],
    ["Recalibration that destroyed the ranking", "Isotonic regression is monotone, so it can never improve ordering, and it can pool distinct confidences into one and make them unseparable. Building the curve on recalibrated values reported every model as automating nothing.", false],
    ["Compositions judged on a laxer gate", "Single models were held to the upper confidence bound while compositions were held to the point estimate. Compositions are what the bench argues for, so the headline was partly an artefact of its own scoring.", true],
    ["A numerator and a denominator from different sets", "Coverage divided a count taken from 266 held-out items by a total of 400. Every single model's coverage was understated by a third, which made compositions look like the only designs that could clear the budget.", true]
  ];
  var ol = $("[data-defects]");
  defects.forEach(function(d){
    var li = document.createElement("li");
    if (d[2]) li.className = "self";
    li.innerHTML = "<b>" + d[0] + "</b><span>" + d[1] + "</span>";
    ol.appendChild(li);
  });

  render(true);
})();
