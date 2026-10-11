const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../miniprogram');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(dir,x.name)):[path.join(dir,x.name)]);}
const files=walk(root);let checked=0;
for(const file of files){const source=fs.readFileSync(file,'utf8');if(file.endsWith('.json'))JSON.parse(source);if(file.endsWith('.js'))new vm.Script(source,{filename:file});if(file.endsWith('.wxml')){
 for(const match of source.matchAll(/\{\{([\s\S]*?)\}\}/g)){
  if(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/i.test(match[1])){
   const line=source.slice(0,match.index).split('\n').length;
   throw Error(`HTML entity in WXML expression: ${file}:${line}. Write operators directly, e.g. && instead of &amp;&amp;.`);
  }
 }
 for(const match of source.matchAll(/(?:src="([^"]+)"|bind(?:tap|change|input)="([^"]+)")/g)){if(match[1]&&!fs.existsSync(path.resolve(path.dirname(file),match[1])))throw Error('Missing import: '+file+' '+match[1]);}
 }checked++;}
const app=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));
for(const page of app.pages)for(const ext of ['.js','.json','.wxml','.wxss'])if(!fs.existsSync(path.join(root,page+ext)))throw Error('Missing page file: '+page+ext);
for(const tab of app.tabBar.list)if(!app.pages.includes(tab.pagePath))throw Error('Unregistered tab: '+tab.pagePath);
console.log(`Checked ${checked} files; ${app.pages.length} pages and all tab routes registered. JS syntax, JSON and WXML expression entity checks passed. This does not replace WeChat compilation.`);
