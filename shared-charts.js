/* Result charts, shared by the case study and the deck so the two cannot drift.
   Four archetypes, four chart types: the argument made visually rather than
   restated. Attached to window rather than imported, because both surfaces are
   single self-contained files with no module loader. */
(function(){
  var inr = function(v){ var n=Math.abs(v);
    if(n>=1e7) return (v<0?"-":"")+"\u20B9"+(n/1e7).toFixed(2)+" Cr";
    if(n>=1e5) return (v<0?"-":"")+"\u20B9"+(n/1e5).toFixed(2)+" L";
    return (v<0?"-":"")+"\u20B9"+Math.round(n).toLocaleString("en-IN"); };
  var pct = function(v,d){ return (v*100).toFixed(d===undefined?0:d)+"%"; };
  var NS = "http://www.w3.org/2000/svg";
  function el(n,a){ var e=document.createElementNS(NS,n); for(var k in a) e.setAttribute(k,a[k]); return e; }
  function tx(x,y,s,anchor,fill){
    var t=el("text",{x:x,y:y,"class":"ax","text-anchor":anchor||"middle"}); if(fill)t.setAttribute("fill",fill);
    t.textContent=s; return t; }

  var W=560,H=260,PL=54,PR=16,PT=14,PB=38, IW=W-PL-PR, IH=H-PT-PB;
  function frame(g){ g.appendChild(el("rect",{x:PL,y:PT,width:IW,height:IH,fill:"#e9e7de",opacity:".5"}));
    g.appendChild(el("line",{x1:PL,y1:PT+IH,x2:W-PR,y2:PT+IH,stroke:"#d8d6cf"}));
    g.appendChild(el("line",{x1:PL,y1:PT,x2:PL,y2:PT+IH,stroke:"#d8d6cf"})); }
  function svg(cls){ var s=el("svg",{viewBox:"0 0 "+W+" "+H,"class":"chart "+(cls||""),role:"img"}); return s; }

  /* A, coverage vs escaped-error risk */
  function chartCoverage(d){
    var s=svg(), g=el("g",{}); s.appendChild(g); frame(g);
    var pts=(d.curve||[]).slice().sort(function(a,b){return a.coverage-b.coverage;});
    if(!pts.length){ g.appendChild(tx(W/2,H/2,"no coverage at any threshold")); return s; }
    var maxY=0.06; pts.forEach(function(p){ if(p.riskCi.hi>maxY) maxY=p.riskCi.hi; });
    var X=function(v){return PL+v*IW;}, Y=function(v){return PT+IH-(Math.min(v,maxY)/maxY)*IH;};
    var up=[],lo=[];
    pts.forEach(function(p){ up.push(X(p.coverage).toFixed(1)+","+Y(p.riskCi.hi).toFixed(1)); });
    pts.slice().reverse().forEach(function(p){ lo.push(X(p.coverage).toFixed(1)+","+Y(0).toFixed(1)); });
    g.appendChild(el("polygon",{points:up.concat(lo).join(" "),fill:"#1f3fff",opacity:".13"}));
    g.appendChild(el("line",{x1:PL,y1:Y(0.02),x2:W-PR,y2:Y(0.02),stroke:"#a3232f","stroke-width":1.4,"stroke-dasharray":"5 4"}));
    g.appendChild(tx(W-PR-3,Y(0.02)-6,"2% budget","end","#a3232f"));
    var dd=""; pts.forEach(function(p,i){ dd+=(i?"L":"M")+X(p.coverage).toFixed(1)+","+Y(p.risk).toFixed(1); });
    g.appendChild(el("path",{d:dd,fill:"none",stroke:"#1f3fff","stroke-width":2.2}));
    g.appendChild(tx(PL,H-8,"0","start")); g.appendChild(tx(W-PR,H-8,"100% auto-approved","end"));
    g.appendChild(tx(PL-7,PT+8,pct(maxY,1),"end")); g.appendChild(tx(PL-7,PT+IH,"0","end"));
    return s;
  }

  /* B, profit per application against approval threshold */
  function chartFrontier(d){
    var s=svg(), g=el("g",{}); s.appendChild(g); frame(g);
    var f=d.frontier||[]; if(!f.length) return s;
    var ys=f.map(function(p){return p.profitPerApplication;});
    var lo=Math.min.apply(null,ys), hi=Math.max.apply(null,ys);
    var pad=(hi-lo)*0.12||1; lo-=pad; hi+=pad;
    var X=function(t){return PL+(t/0.6)*IW;}, Y=function(v){return PT+IH-((v-lo)/(hi-lo))*IH;};
    if(lo<0&&hi>0) { g.appendChild(el("line",{x1:PL,y1:Y(0),x2:W-PR,y2:Y(0),stroke:"#a3232f","stroke-width":1,"stroke-dasharray":"4 4"}));
      g.appendChild(tx(W-PR-3,Y(0)-5,"break even","end","#a3232f")); }
    var dd=""; f.forEach(function(p,i){ dd+=(i?"L":"M")+X(p.threshold).toFixed(1)+","+Y(p.profitPerApplication).toFixed(1); });
    g.appendChild(el("path",{d:dd,fill:"none",stroke:"#1f3fff","stroke-width":2.2}));
    var b=d.best;
    if(b){ g.appendChild(el("circle",{cx:X(b.threshold),cy:Y(b.profitPerApplication),r:5.5,fill:"#101013",stroke:"#fafaf7","stroke-width":2}));
      g.appendChild(tx(Math.min(W-PR-4,X(b.threshold)+8),Math.max(PT+12,Y(b.profitPerApplication)-9),"optimum "+b.threshold.toFixed(2),"start","#101013")); }
    g.appendChild(tx(PL,H-8,"approve below PD 0","start")); g.appendChild(tx(W-PR,H-8,"0.60","end"));
    g.appendChild(tx(PL-7,PT+8,inr(hi),"end")); g.appendChild(tx(PL-7,PT+IH,inr(lo),"end"));
    return s;
  }

  /* C, estimator error against the known truth */
  function chartEstimators(d){
    var s=svg(), g=el("g",{});
    s.appendChild(g);
    // Wider left gutter than the other charts: these rows carry words, not ticks,
    // and "doubly robust" was being clipped to "y robust".
    var PL2=104, IW2=W-PL2-PR;
    g.appendChild(el("rect",{x:PL2,y:PT,width:IW2,height:IH,fill:"#e9e7de",opacity:".5"}));
    g.appendChild(el("line",{x1:PL2,y1:PT+IH,x2:W-PR,y2:PT+IH,stroke:"#d8d6cf"}));
    var e=d.exploring; if(!e) return s;
    var rows=[["direct",e.direct],["IPS",e.ips],["SNIPS",e.snips],["doubly robust",e.doublyRobust]];
    var vals=rows.map(function(r){return r[1];}).concat([e.truth]);
    var lo=Math.min.apply(null,vals), hi=Math.max.apply(null,vals);
    var pad=(hi-lo)*0.2||1; lo-=pad; hi+=pad;
    var X=function(v){return PL2+((v-lo)/(hi-lo))*IW2;};
    var bh=IH/rows.length;
    g.appendChild(el("line",{x1:X(e.truth),y1:PT,x2:X(e.truth),y2:PT+IH,stroke:"#101013","stroke-width":2}));
    g.appendChild(tx(X(e.truth),PT-3,"truth "+inr(e.truth),"middle","#101013"));
    rows.forEach(function(r,i){
      var y=PT+i*bh+bh*0.24, h=bh*0.5;
      var x0=Math.min(X(r[1]),X(e.truth)), w=Math.abs(X(r[1])-X(e.truth));
      var over=r[1]>e.truth;
      g.appendChild(el("rect",{x:x0,y:y,width:Math.max(1.5,w),height:h,fill:over?"#a3232f":"#1f3fff",opacity:".82"}));
      g.appendChild(tx(PL2-8,y+h*0.72,r[0],"end"));
      var lx=over?X(r[1])+5:X(r[1])-5;
      g.appendChild(tx(Math.max(PL2+4,Math.min(W-PR-4,lx)),y+h*0.72,inr(r[1]),over?"start":"end"));
    });
    return s;
  }

  /* D, cumulative recovery per week, three policies */
  function chartRollout(d){
    var s=svg(), g=el("g",{}); s.appendChild(g); frame(g);
    var ps=d.policies||[]; if(!ps.length) return s;
    var wk=ps[0].weekly.length;
    var cum=ps.map(function(p){ var a=[],t=0; p.weekly.forEach(function(v){ t+=v; a.push(t); }); return a; });
    var hi=Math.max.apply(null,cum.map(function(c){return c[c.length-1];}))||1;
    var X=function(i){return PL+(i/(wk-1))*IW;}, Y=function(v){return PT+IH-(v/hi)*IH;};
    var cols=["#1f3fff","#a3232f","#55555c"];
    cum.forEach(function(c,i){
      var dd=""; c.forEach(function(v,j){ dd+=(j?"L":"M")+X(j).toFixed(1)+","+Y(v).toFixed(1); });
      g.appendChild(el("path",{d:dd,fill:"none",stroke:cols[i%3],"stroke-width":i===0?2.4:1.7,"stroke-dasharray":i===0?"0":"5 3"}));
    });
    // A legend on fixed rows rather than labels at the line ends: three policies
    // that converge by week eight put their end labels on top of each other.
    cum.forEach(function(c,i){
      var ly = PT + 12 + i*15;
      g.appendChild(el("line",{x1:PL+10,y1:ly-4,x2:PL+30,y2:ly-4,stroke:cols[i%3],"stroke-width":i===0?2.4:1.7,"stroke-dasharray":i===0?"0":"5 3"}));
      var t=el("text",{x:PL+36,y:ly,"class":"ax","text-anchor":"start"});
      t.setAttribute("fill",cols[i%3]);
      t.textContent = ps[i].name.split(" (")[0] + "  " + inr(c[c.length-1]);
      g.appendChild(t);
    });
    g.appendChild(tx(PL,H-8,"week 1","start")); g.appendChild(tx(W-PR,H-8,"week "+wk,"end"));
    g.appendChild(tx(PL-7,PT+8,inr(hi),"end")); g.appendChild(tx(PL-7,PT+IH,"0","end"));
    return s;
  }

  var CHART = { volume: chartCoverage, stakes: chartFrontier, "no-truth": chartEstimators, adversarial: chartRollout };
  var CAPTION = {
    volume: "Escaped-error rate as more listings are auto-approved. Shaded band is the 95% interval; the gate is judged on its upper edge.",
    stakes: "Expected profit per application against the approval threshold. Accuracy appears nowhere, because it cannot be computed.",
    "no-truth": "Four estimators against the true policy value. The vertical rule is the truth, which only exists because this market is simulated. Red overshoots.",
    adversarial: "Cumulative recovery across the eight week horizon, for three policies walked forward against a responding borrower.",
  };

  window.__CHARTS__ = CHART;
  window.__CAPTIONS__ = CAPTION;
})();
