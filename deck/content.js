/* Shared narrative content: the architecture per account, and the defect list.
   Kept out of the renderers so the page and the deck cannot drift apart. */
window.__BUILDS__ = {
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
};

/* [text, foundOnlyWithRealModels] */
window.__DEFECTS__ = [
  ["A credential check that passed on a comment", true],
  ["My own queueing counted as model latency", true],
  ["A per-model fix for a per-device problem", true],
  ["Truth demanding more than the input showed. Three times", false],
  ["Recalibration that destroyed the ranking", false],
  ["Compositions judged on a laxer gate", true],
  ["Numerator and denominator from different item sets", true],
  ["One hung call taking a whole run with it", true],
  ["Captions narrating the finding I expected", false],
];
