const E=require('./engine.js'),fs=require('fs');
for (const f of ['broken_empty.csv','broken_missing_column.csv','broken_no_header.csv']) console.log(f,'->',E.loadCatalog(fs.readFileSync(f,'utf8')).blocked);
const c=E.loadCatalog(fs.readFileSync('mock_catalog.csv','utf8'));
console.log('WARN');c.warnings.forEach(w=>console.log(' ',w.code,w.text));console.log('FIXES');c.fixes.forEach(w=>console.log(' ',w.code,w.text));
for (const id of [...c.skus.values()].filter(r=>r.is_client).map(r=>r.sku_id).concat(['MOCK-ERR-07','MOCK-ERR-08','MOCK-T10-K01','mock-t1-c01 ','NOPE'])) {
  const r=E.resolveSku(c,id); if(r.error){console.log('\n#',id,'->',r.error);continue;}
  const ctx={groupBrands:[r.client,...r.competitors].map(x=>x.brand)};
  const a=E.auditListing(r.client,ctx);
  console.log('\n#',r.client.sku_id,'| comps:',r.competitors.map(x=>x.sku_id).join(',')||'none','| notes:',r.client.notes.map(n=>n.code).join(','));
  console.log('  ',E.summarise(a).text);
  a.filter(x=>x.status==='not_met').forEach(x=>console.log('   X',x.rule.id,JSON.stringify(x.evidence).slice(0,110)));
  r.competitors.forEach(k=>{const ka=E.auditListing(k,ctx);const q=E.qualifies(ka);const bad=ka.filter(x=>x.status==='not_met'&&x.rule.strength==='Prohibition').map(x=>x.rule.id);console.log('   comp',k.sku_id,bad.length?'BREAKS '+bad:'no plain prohibition broken');});
}
