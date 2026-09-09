const { Worker } = require('node:worker_threads');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

class WorkerManager extends EventEmitter {
  constructor(file, workerData, options = {}) {
    super();
    this.file=file; this.data=workerData; this.options=options;
    this.pending=new Map(); this.counter=0; this.restarts=[];
    this.start();
  }
  diagnostic(data) {
    // Whitelist metadata. Never persist exception messages, source paths, or upstream output.
    const entry={at:new Date().toISOString(),code:String(data.code||'worker_failure').replace(/[^a-z_]/g,'').slice(0,50)};
    if(Number.isFinite(data.count))entry.count=data.count;
    if(Array.isArray(data.items))entry.items=data.items.slice(0,20).map(i=>({code:String(i.code).replace(/[^a-z_]/g,''),fileId:/^[a-f0-9]{12}$/.test(i.fileId)?i.fileId:undefined}));
    try {
      const file=path.join(path.dirname(this.data.db),'diagnostics.jsonl');
      if(fs.existsSync(file)&&fs.statSync(file).size>256*1024)fs.renameSync(file,file+'.previous');
      fs.appendFileSync(file,JSON.stringify(entry)+'\n');
    } catch {}
  }
  start() {
    const child=this.child=new Worker(this.file,{workerData:this.data});
    let failed=false;
    child.on('message',msg=>{
      if(child!==this.child || failed)return;
      if(msg.id) {
        const p=this.pending.get(msg.id);
        if(p) {clearTimeout(p.timer);this.pending.delete(msg.id);msg.error?p.reject(new Error(msg.error)):p.resolve(msg.result);}
        return;
      }
      if(msg.type==='diagnostic')this.diagnostic(msg.data);
      if(msg.type==='updated' && this.recovering) {
        this.recovering=false;this.emit('message',{type:'recovered'});
      }
      this.emit('message',msg,value=>{if(child===this.child&&!failed)child.postMessage(value);});
    });
    const fail=()=>{
      if(failed)return;failed=true;
      this.child=null;
      for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('采集进程已退出，请稍后重试'));}
      this.pending.clear();
      if(this.closing)return;
      this.diagnostic({code:'worker_exit'});
      this.restarts=this.restarts.filter(t=>Date.now()-t<300000);
      if(this.restarts.length>=3) {
        this.emit('message',{type:'error',data:'采集进程连续异常，自动重试已停止。请重启应用；诊断记录位于数据目录。'});
        return;
      }
      this.restarts.push(Date.now());this.recovering=true;
      this.emit('message',{type:'error',data:'采集进程异常，正在自动恢复…'});
      this.timer=setTimeout(()=>this.start(),this.options.restartDelay??1000*this.restarts.length);
    };
    child.on('error',()=>{this.diagnostic({code:'worker_error'});});
    child.on('exit',fail);
  }
  request(method,args) {
    if(!this.child)return Promise.reject(new Error('采集进程暂不可用，请稍后重试'));
    const child=this.child;
    return new Promise((resolve,reject)=>{
      const id=++this.counter;
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('后台正在导入或查询，请稍后重试'));},120000);
      this.pending.set(id,{resolve,reject,timer});
      child.postMessage({id,method,args});
    });
  }
  async shutdown() {
    this.closing=true;clearTimeout(this.timer);
    if(this.child) {
      const exited=new Promise(resolve=>this.child.once('exit',resolve));
      await this.request('shutdown');
      await exited;
    }
  }
}
module.exports={WorkerManager};
