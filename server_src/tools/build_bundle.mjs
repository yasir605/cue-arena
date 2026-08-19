import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const entry='src/main.js';

const norm=p=>p.split(path.sep).join('/');
function resolveImport(from,spec){
  if(!spec.startsWith('.')) throw new Error(`Only relative imports are supported: ${spec} in ${from}`);
  return norm(path.normalize(path.join(path.dirname(from),spec)));
}
function parseImports(source){
  return [...source.matchAll(/^\s*import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm)]
    .map(m=>({bindings:m[1].trim(),spec:m[2],full:m[0]}));
}
function exportedNames(source){
  return [...new Set([...source.matchAll(/^\s*export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m=>m[1]))];
}
function transformModule(id,source){
  const imports=parseImports(source);
  for(const im of imports){
    const target=resolveImport(id,im.spec);
    const destructured=im.bindings.split(',').map(s=>{
      const bits=s.trim().split(/\s+as\s+/);
      return bits.length===2?`${bits[0].trim()}: ${bits[1].trim()}`:bits[0].trim();
    }).join(', ');
    source=source.replace(im.full,`const { ${destructured} } = require(${JSON.stringify(target)});`);
  }
  const names=exportedNames(source);
  source=source.replace(/(^|\n)(\s*)export\s+(?=(?:const|let|var|function|class)\b)/g,'$1$2');
  if(/\bexport\s+default\b/.test(source)) throw new Error(`export default is not supported in ${id}`);
  if(names.length) source+=`\nObject.assign(exports,{${names.join(',')}});\n`;
  return {source,imports:imports.map(im=>resolveImport(id,im.spec))};
}

const modules=new Map();
function collect(id){
  if(modules.has(id)) return;
  const full=path.join(root,id);
  if(!fs.existsSync(full)) throw new Error(`Missing module ${id}`);
  const transformed=transformModule(id,fs.readFileSync(full,'utf8'));
  modules.set(id,transformed.source);
  for(const dep of transformed.imports) collect(dep);
}
collect(entry);

const chunks=[`(function(){\n'use strict';\nconst __modules=Object.create(null),__cache=Object.create(null);\n`];
for(const [id,source] of modules){
  chunks.push(`\n__modules[${JSON.stringify(id)}]=function(require,module,exports){\n${source}\n};\n`);
}
chunks.push(`\nfunction __require(id){\n  if(__cache[id]) return __cache[id].exports;\n  const factory=__modules[id];\n  if(!factory) throw new Error('Module not bundled: '+id);\n  const module={exports:{}};\n  __cache[id]=module;\n  factory(__require,module,module.exports);\n  return module.exports;\n}\n__require(${JSON.stringify(entry)});\nwindow.__SNOOKER_2D_BOOTED__=true;\nwindow.__CUE_ARENA_BOOTED__=true;\n})();\n`);
fs.mkdirSync(path.join(root,'web'),{recursive:true});
fs.writeFileSync(path.join(root,'web/game.js'),chunks.join(''));
console.log(`Built web/game.js (${modules.size} modules)`);
