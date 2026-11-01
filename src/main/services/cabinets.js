const fs=require('fs').promises,path=require('path'),crypto=require('crypto');
const manifest=require('../../renderer/data/cabs/manifest.json');
const pending=new Map();
async function bassBytes(dir,id,fetchImpl){
  const {zipList,zipExtract}=require('../core/files');const item=manifest[id];
  const archive=path.join(dir,'shift-line-bass.zip');
  const archiveKey=archive+':download';
  if(!pending.has(archiveKey))pending.set(archiveKey,(async()=>{
    try{const b=await fs.readFile(archive);if(crypto.createHash('sha256').update(b).digest('hex')===item.archiveSha256)return;}catch{}
    const r=await fetchImpl(item.url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Bass cabinet download unavailable');
    const b=Buffer.from(await r.arrayBuffer());if(crypto.createHash('sha256').update(b).digest('hex')!==item.archiveSha256)throw Error('Bass cabinet download changed; use your own IR until the pack is updated.');
    await fs.writeFile(archive+'.tmp',b);await fs.rename(archive+'.tmp',archive);
  })().catch(e=>{pending.delete(archiveKey);throw e;}));
  await pending.get(archiveKey);
  const entry=(await zipList(archive)).find(e=>e.name===item.entry);
  if(!entry||entry.usize>1024*1024)throw Error('Cabinet not found in downloaded pack');
  const temp=path.join(dir,id+'.extract');await zipExtract(archive,entry,temp);
  try{return await fs.readFile(temp);}finally{await fs.unlink(temp).catch(()=>{});}
}
async function ensureCab(dir,id,fetchImpl){
  if(!manifest[id])throw Error('Unknown cabinet');
  const key=path.join(dir,id+'.wav');if(pending.has(key))return pending.get(key);
  const valid=b=>crypto.createHash('sha256').update(b).digest('hex')===manifest[id].sha256;
  const job=(async()=>{
    try{if(valid(await fs.readFile(key)))return key;}catch{}
    await fs.mkdir(dir,{recursive:true});let bytes;
    try{
      if(manifest[id].downloadOnly){bytes=await bassBytes(dir,id,fetchImpl);}else{
      try{const bundled=await fs.readFile(path.join(__dirname,'../../renderer/data/cabs',id+'.wav'));if(valid(bundled)){await fs.writeFile(key+'.tmp',bundled);await fs.rename(key+'.tmp',key);return key;}}catch{}
      const r=await fetchImpl(manifest[id].url,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Download failed');
      bytes=Buffer.from(await r.arrayBuffer());}
      if(!valid(bytes))throw Error('Cabinet checksum mismatch');
    }catch(e){if(manifest[id].downloadOnly)throw e;bytes=await fs.readFile(path.join(__dirname,'../../renderer/data/cabs',id+'.wav'));if(!valid(bytes))throw Error('Cabinet integrity check failed');}
    await fs.writeFile(key+'.tmp',bytes);await fs.rename(key+'.tmp',key);return key;
  })();pending.set(key,job);try{return await job;}finally{pending.delete(key);}
}
module.exports={ensureCab};
