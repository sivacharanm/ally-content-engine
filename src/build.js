const fs=require('fs');
const OUT=process.argv[2]||'deploy';   // in the repository: node build.js ..
let t=fs.readFileSync('template.html','utf8');
const rep=(k,v)=>{t=t.split(k).join(v);};
const cats=[['Provided: client_skus_ciq_assignment 2.csv','client_skus_ciq_assignment 2.csv','catalog.csv'],
['Test: mock catalog (fictional brands, 25 rows)','mock_catalog.csv','mock_catalog.csv'],
['Test: broken, empty file (V1)','broken_empty.csv','broken_empty.csv'],
['Test: broken, no header row (V1)','broken_no_header.csv','broken_no_header.csv'],
['Test: broken, missing column (V2)','broken_missing_column.csv','broken_missing_column.csv']].map(([label,file,src])=>({label,file,csv:fs.readFileSync(src,'utf8')}));
rep('/*CATALOGS*/',JSON.stringify(cats).replace(/<\//g,'<\\/'));
rep('/*ENGINE*/',fs.readFileSync('engine.js','utf8'));
rep('/*AI*/',fs.readFileSync('ai.js','utf8'));
rep('/*APP*/',fs.readFileSync('app.js','utf8'));
const base=t;
// Preview: prompts built in the page, two tabs
fs.writeFileSync('preview.html',base.split('/*CONFIG*/').join('').split('/*PROMPTS*/').join(fs.readFileSync('prompts.js','utf8')));
// Hosted (D67): no prompts in the page; one view per URL
fs.mkdirSync(OUT+'/lib',{recursive:true});
const hosted=v=>base.split('/*PROMPTS*/').join('').split('/*CONFIG*/').join('const ALLY_HOSTED = true; const ALLY_VIEW = '+JSON.stringify(v)+';').split('<span class="pill">Preview</span>').join('');
fs.writeFileSync(OUT+'/index.html',hosted('brand'));
fs.writeFileSync(OUT+'/admin.html',hosted('admin'));
fs.copyFileSync('prompts.js',OUT+'/lib/prompts.js');
console.log('built',base.length);
