const E = require('./engine.js'); const fs=require('fs');
const cat = E.loadCatalog(fs.readFileSync('catalog.csv','utf8'));
console.log('blocked',cat.blocked,'warn',cat.warnings,'fixes',cat.fixes,'skipped',cat.skipped);
for (const id of ['CIQ-DCT-001','ciq-spw-001 ','COMP-DCT-101','NOPE']) {
  const r = E.resolveSku(cat,id); if (r.error){console.log(id,'->',r.error);continue;}
  const all=[r.client,...r.competitors]; const ctx={groupBrands: all.map(x=>x.brand)};
  for (const l of all){ const a=E.auditListing(l,ctx); console.log('\n==',l.sku_id,l.brand, E.summarise(a).text, 'qual:',E.qualifies(a));
    a.filter(x=>x.status==='not_met').forEach(x=>console.log('  X',x.rule.id,x.rule.strength,JSON.stringify(x.evidence)));}
}
