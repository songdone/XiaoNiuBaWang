// Scoped, loopback-only emulator acceptance harness. SPDX-License-Identifier: GPL-2.0-or-later
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const prefix='/app/xiaoniubawang/';
const routes=new Map([
  [prefix,join(project,'emulator/browser-harness.html')],
  [prefix+'matrix-diagnostic.nes',join(project,'emulator/diagnostics/matrix-diagnostic.nes')],
  [prefix+'keytest.nes',join(project,'emulator/diagnostics/keytest/keytest.nes')],
  [prefix+'game.nes',join(project,'build/20261121-core-01/downloads/void-lancer/VOID-LANCER-v1.0.0.nes')],
  ...['fceumm.js','fceumm-core.mjs','fceumm-core.wasm'].map(name=>[prefix+'cores/'+name,join(project,'web/public/cores',name)])
]);
createServer(async(request,response)=>{
  const pathname=new URL(request.url,'http://127.0.0.1').pathname;
  if(request.method==='POST'&&pathname===prefix+'evidence'){
    let content='';for await(const chunk of request){content+=chunk;if(content.length>100000){response.writeHead(413).end();return;}}
    await writeFile(join(project,'build/20261121-core-01/emulator/browser-results.json'),JSON.stringify(JSON.parse(content),null,2));
    response.writeHead(200).end('ok');return;
  }
  const path=routes.get(pathname);
  if(!path){response.writeHead(404).end('not found');return;}
  try{
    const data=await readFile(path);
    const type=path.endsWith('.wasm')?'application/wasm':/\.(mjs|js)$/.test(path)?'text/javascript':path.endsWith('.html')?'text/html':'application/octet-stream';
    response.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'}).end(data);
  }catch(error){response.writeHead(500).end(String(error));}
}).listen(8787,'127.0.0.1',()=>console.log('Emulator harness http://127.0.0.1:8787/app/xiaoniubawang/'));
