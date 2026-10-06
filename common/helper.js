// Injected into the addon copy as scripts/__lab.js (never into bp/ itself): `js`, simulated players,
// form capture for simulated players, and the Script API tap (`events on`, `states on`).
import*as mc from"@minecraft/server";import*as gt from"@minecraft/server-gametest";
const{world,system}=mc,P=new Map(),AF=Object.getPrototypeOf(async function(){}).constructor;
const dim=()=>world.getDimension("overworld");
// `clock +1d` (tests): the addon's Date runs ahead by what the test said; kept in a world property, so /reload and a restart keep it
const RD=Date;let CLK=null;const clk=()=>{if(CLK===null){try{CLK=Number(world.getDynamicProperty("__lab_clock")??0)}catch{return 0}}return CLK};
globalThis.Date=new Proxy(RD,{construct(t,a,n){return Reflect.construct(t,a.length?a:[RD.now()+clk()],n)},apply(){return new RD(RD.now()+clk()).toString()},get(t,k,r){return k==="now"?()=>RD.now()+clk():Reflect.get(t,k,r)}});
globalThis.__labClock=ms=>{CLK=clk()+ms;world.setDynamicProperty("__lab_clock",CLK)};
const sim=(n="P",x=0,y=-60,z=0,gm="survival")=>{const g=mc.GameMode[gm]??mc.GameMode[gm[0].toUpperCase()+gm.slice(1)];const p=gt.spawnSimulatedPlayer({dimension:dim(),x,y,z},n,g);P.set(n,p);return p};
const p=n=>n?P.get(n)??world.getPlayers({name:n})[0]:[...P.values()].at(-1)??world.getAllPlayers()[0];
const inv=(q=p())=>{if(typeof q==="string")q=p(q);const c=q.getComponent("inventory").container,r=[];for(let i=0;i<c.size;i++){const s=c.getItem(i);if(s)r.push(i+":"+s.typeId+"*"+s.amount)}return r};
const num=v=>Number.isInteger(v)?v:Math.round(v*1e3)/1e3;
const fmt=(v,d=0)=>{if(typeof v==="number")return String(num(v));if(v===null||typeof v!=="object")return typeof v==="function"?"[fn]":d?JSON.stringify(v)??String(v):String(v);
if(Array.isArray(v))return"["+v.slice(0,50).map(x=>fmt(x,d+1)).join(",")+(v.length>50?",+"+(v.length-50):"")+"]";
const c=v.constructor?.name;if(c&&c!=="Object"){const o=[];for(const k of["typeId","id","name","nameTag","location","amount"]){try{const x=v[k];if(x!==undefined&&typeof x!=="function")o.push(k+":"+fmt(x,d+1))}catch{}}return c+"{"+o.join(",")+"}"}
const ks=Object.keys(v);if(ks.length===3&&"x"in v&&"y"in v&&"z"in v)return"{x:"+num(v.x)+",y:"+num(v.y)+",z:"+num(v.z)+"}";if(d>3)return"{..}";return"{"+Object.entries(v).slice(0,50).map(([k,x])=>k+":"+fmt(x,d+1)).join(",")+"}"};
const mob=(t="minecraft:pig",x=2,y=-60,z=0)=>dim().spawnEntity(t,{x,y,z});
const hit=(e,dmg=9999,by=p())=>e.applyDamage(dmg,{cause:"entityAttack",damagingEntity:by});
const $={};
const A=["mc","gt","world","system","dim","sim","p","inv","mob","hit","answer","$","tap"];
system.afterEvents.scriptEventReceive.subscribe(async e=>{if(e.id!=="lab:js")return;let f;
const src=e.message.replace(/^#/,"");try{f=new AF(...A,"return("+src+"\n)")}catch{const s2=src.trimEnd().replace(/;$/,""),i=s2.lastIndexOf(";");try{if(i<1)throw 0;f=new AF(...A,s2.slice(0,i+1)+"return("+s2.slice(i+1)+"\n)")}catch{try{f=new AF(...A,src)}catch(x){console.error("js: "+x);console.warn("LAB_JS_DONE");return}}}
try{const r=await f(mc,gt,world,system,dim(),sim,p,inv,mob,hit,answer,$,tap);if(r!==undefined)console.warn(fmt(r))}catch(x){console.error("js: "+(x?.message??x))}console.warn("LAB_JS_DONE")},{namespaces:["lab"]});
const txt=m=>typeof m==="string"?m:Array.isArray(m)?m.map(txt).join(""):m?.rawtext?m.rawtext.map(txt).join(""):m?.text??(m?.translate?"%"+m.translate:m?.score?"%score":JSON.stringify(m));
const isSim=q=>gt.SimulatedPlayer&&q instanceof gt.SimulatedPlayer;const noReal=()=>!world.getAllPlayers().some(q=>!isSim(q));
{const o=mc.World.prototype.sendMessage;try{mc.World.prototype.sendMessage=function(m){try{console.warn(txt(m))}catch{}return o.call(this,m)}}catch{}}
{const o=mc.Player.prototype.sendMessage;try{mc.Player.prototype.sendMessage=function(m){try{if(isSim(this))console.warn("@"+this.name+" "+txt(m))}catch{}return o.call(this,m)}}catch{}}
const sd=mc.ScreenDisplay?.prototype;for(const k of["setActionBar","setTitle"])if(sd?.[k]){const o=sd[k];try{sd[k]=function(m,...a){try{if(noReal())console.warn(k.slice(3).toLowerCase()+": "+txt(m))}catch{}return o.call(this,m,...a)}}catch{}}
const FQ=[],FW=[],rec=new WeakMap();
const answer=v=>{FW.length?FW.shift()(v):FQ.push(v);return"answered"};
const respond=(k,v)=>v==null?{canceled:true,cancelationReason:"UserClosed"}:k==="modal"?{canceled:false,formValues:v}:{canceled:false,selection:v};
const wrapForm=(C,kind)=>{const P=C?.prototype;if(!P)return;for(const k of Object.getOwnPropertyNames(P)){if(k==="constructor"||k==="show")continue;let o;try{o=P[k]}catch{continue}if(typeof o!=="function")continue;try{P[k]=function(...a){const r=rec.get(this)??[];r.push(k+"("+a.filter(x=>x!==undefined).map(x=>typeof x==="object"&&!x?.rawtext&&!x?.translate?JSON.stringify(x):JSON.stringify(txt(x))).join(",")+")");rec.set(this,r);return o.apply(this,a)}}catch{}}
const oshow=P.show;try{P.show=function(pl){if(!isSim(pl))return oshow.call(this,pl);console.warn("@"+pl?.name+" form "+kind+": "+(rec.get(this)??[]).join(" "));return new Promise(res=>{const go=v=>res(respond(kind,v));FQ.length?go(FQ.shift()):FW.push(go)})}}catch{}};
/*UI*/
const props=o=>{const s=new Set(Object.keys(o));let q=Object.getPrototypeOf(o);while(q&&q!==Object.prototype){for(const k of Object.getOwnPropertyNames(q)){const d=Object.getOwnPropertyDescriptor(q,k);if(d&&d.get&&k!=="constructor")s.add(k)}q=Object.getPrototypeOf(q)}return[...s].filter(k=>k!=="cancel").sort()};
const is=(v,C)=>{try{return!!C&&v instanceof C}catch{return false}};
const fv=(v,d=0)=>{if(v==null)return"-";if(typeof v!=="object")return typeof v==="number"?String(num(v)):JSON.stringify(v).length>60?JSON.stringify(v).slice(0,57)+"...":String(v);
if(Array.isArray(v))return"["+v.slice(0,6).map(x=>fv(x,d+1)).join(",")+(v.length>6?",+"+(v.length-6):"")+"]";
try{if(is(v,mc.Player))return v.name;if(is(v,mc.Entity))return v.typeId==="minecraft:item"?"item:"+fv(v.getComponent("item")?.itemStack):v.typeId;if(is(v,mc.Block))return v.typeId+"@"+v.x+","+v.y+","+v.z;if(is(v,mc.BlockPermutation))return v.type.id;if(is(v,mc.ItemStack))return v.typeId+"*"+v.amount;if(is(v,mc.Dimension))return v.id.replace("minecraft:","");if(is(v,mc.Effect))return v.typeId+"/"+v.amplifier+"/"+v.duration}catch{return"(invalid)"}
const ks=props(v);if(ks.length===3&&"x"in v&&"y"in v&&"z"in v)return num(v.x)+","+num(v.y)+","+num(v.z);
if(d>1)return"{..}";return"{"+ks.map(k=>{let x;try{x=v[k]}catch{x="?"}return typeof x==="function"?null:k+"="+fv(x,d+1)}).filter(Boolean).join(" ")+"}"};
// event tap: events on [names] prints every Script API event this addon receives, with its fields
const tap={subs:[],st:null,prev:new Map(),
events(on,names){for(const u of this.subs)try{u()}catch{}this.subs=[];if(!on)return"events off";const want=names?names.replace(/,/g," ").split(" ").filter(Boolean):null;let n=0;
for(const[sig,pre]of[[world.afterEvents,"after"],[world.beforeEvents,"before"],[system.afterEvents,"system"]])for(const k of props(sig)){const full=pre+"."+k;if(want&&!want.some(w=>full===w||k===w))continue;let s;try{s=sig[k]}catch{continue}if(typeof s?.subscribe!=="function")continue;
const cb=e=>{try{if(full==="system.scriptEventReceive"&&e.id.startsWith("lab:"))return;const f=props(e).map(x=>{let v;try{v=e[x]}catch{v="?"}return typeof v==="function"?null:x+"="+fv(v)}).filter(Boolean).join(" ");console.warn("EV "+full+(f?" "+f:""))}catch(x){console.warn("EV "+full+" (unreadable: "+x+")")}};
try{s.subscribe(cb);this.subs.push(()=>s.unsubscribe(cb));n++}catch{}}return"events on: "+n},
states(on,keys){if(this.st!==null)system.clearRun(this.st);this.st=null;this.prev.clear();if(!on)return"states off";
const want=keys?keys.replace(/,/g," ").split(" ").filter(Boolean):null;
this.st=system.runInterval(()=>{const here=new Set(world.getAllPlayers().filter(Boolean).map(q=>q.name));for(const n of this.prev.keys())if(!here.has(n))this.prev.delete(n);   // a player who left gets a fresh init line on return
for(const q of world.getAllPlayers()){if(!q)continue;let v;try{v=readState(q)}catch(x){console.warn("ST "+q.name+" (unreadable: "+x+")");continue}
if(want)for(const k of Object.keys(v))if(!want.some(w=>k===w||k.startsWith(w+".")))delete v[k];
const pv=this.prev.get(q.name);this.prev.set(q.name,v);
if(!pv){console.warn("ST "+q.name+" init "+Object.entries(v).map(([k,x])=>k+"="+x).join(" "));continue}
for(const k of new Set([...Object.keys(pv),...Object.keys(v)])){const a=pv[k]??"-",b=v[k]??"-";if(a!==b)console.warn("ST "+q.name+" "+k+"="+b)}}},1);return"states on"+(want?": "+want.join(" "):"")}};
// Player state by Script API name. Continuous values are bucketed so a line means a real change:
// location = block, rotation.x 15 deg, rotation.y 8 compass points, velocity sign, exhaustion in steps of 0.1.
const SKIP=new Set(["id","typeId","isValid","localizationKey","nameplateDepthTested","nameplateRenderDistance","persistentId","name","chatDisplayName","location","dimension","target","scoreboardIdentity","camera","onScreenDisplay","inputInfo","inputPermissions","clientSystemInfo","fogSettings","locatorBar"]);
const short=s=>String(s).replace("minecraft:","");
const stk=s=>s?short(s.typeId)+"*"+s.amount+(s.nameTag?'"'+s.nameTag+'"':""):"-";
const cont=c=>{const r=[];for(let i=0;i<c.size;i++){const s=c.getItem(i);if(s)r.push(i+":"+stk(s))}return r.join(",")||"-"};
const vb=x=>x>0.05?"+":x<-0.05?"-":"0";
const COOL=["ender_pearl","chorusfruit","goat_horn","wind_charge","shield","spear"];   // item cooldown categories (chorus fruit: "chorusfruit")
const COMP={
 "minecraft:inventory":(c,v)=>{v.inventory=cont(c.container)},
 "minecraft:ender_inventory":(c,v)=>{v.ender_inventory=cont(c.container)},
 "minecraft:cursor_inventory":(c,v)=>{v.cursor_inventory=stk(c.item)},
 "minecraft:equippable":(c,v)=>{for(const s of Object.values(mc.EquipmentSlot)){try{v["equippable."+s]=stk(c.getEquipment(s))}catch{}}v["equippable.totalArmor"]=c.totalArmor},
 "minecraft:breathable":(c,v)=>{v["breathable.airSupply"]=c.airSupply;v["breathable.canBreathe"]=c.canBreathe},
 "minecraft:riding":(c,v)=>{v.riding=short(c.entityRidingOn?.typeId??"?")},
 "minecraft:onfire":(c,v)=>{v.onfire=Math.ceil(c.onFireTicksRemaining/20)},
 "minecraft:rideable":(c,v)=>{v["rideable.riders"]=c.getRiders().length},
 "minecraft:player.exhaustion":(c,v)=>{v["player.exhaustion"]=Math.floor(c.currentValue*10)/10}};
function readState(q){const v={};const g=(k,f)=>{try{const x=f();if(x!==undefined)v[k]=x}catch{}};
 for(const k of props(q)){if(SKIP.has(k))continue;g(k,()=>{const x=q[k];return typeof x==="boolean"||typeof x==="number"||typeof x==="string"?(typeof x==="number"?num(x):x):undefined})}
 g("location",()=>{const l=q.location;return Math.floor(l.x)+","+Math.floor(l.y)+","+Math.floor(l.z)});
 g("dimension",()=>short(q.dimension.id));
 g("rotation.x",()=>Math.round(q.getRotation().x/15)*15);
 g("rotation.y",()=>["S","SW","W","NW","N","NE","E","SE"][((Math.round(q.getRotation().y/45)%8)+8)%8]);
 g("velocity.y",()=>vb(q.getVelocity().y));g("velocity.xz",()=>{const w=q.getVelocity();return Math.hypot(w.x,w.z)>0.05?"moving":"0"});
 g("gameMode",()=>q.getGameMode());g("totalXp",()=>q.getTotalXp());g("controlScheme",()=>q.getControlScheme()??"-");
 g("spawnPoint",()=>{const s=q.getSpawnPoint();return s?Math.floor(s.x)+","+Math.floor(s.y)+","+Math.floor(s.z)+"@"+short(s.dimension.id):"-"});
 g("effects",()=>q.getEffects().map(e=>short(e.typeId)+":"+e.amplifier).sort().join(",")||"-");
 g("tags",()=>q.getTags().sort().join(",")||"-");
 g("viewBlock",()=>{const h=q.getBlockFromViewDirection({maxDistance:6});return h?short(h.block.typeId)+"@"+h.block.x+","+h.block.y+","+h.block.z+" "+h.face:"-"});
 g("viewEntity",()=>{const h=q.getEntitiesFromViewDirection({maxDistance:6})[0];return h?short(h.entity.typeId):"-"});
 g("standingOn",()=>{const b=q.getBlockStandingOn();return b?short(b.typeId):"-"});
 g("dynamicProperties",()=>q.getDynamicPropertyIds().sort().join(",")||"-");
 for(const c of COOL)g("cooldown."+c,()=>q.getItemCooldown(c)>0?"yes":"no");
 const ii=q.inputInfo;
 g("inputInfo.lastInputModeUsed",()=>ii.lastInputModeUsed);g("inputInfo.touchOnlyAffectsHotbar",()=>ii.touchOnlyAffectsHotbar);
 g("inputInfo.movementVector",()=>{const m=ii.getMovementVector();return Math.round(m.x)+","+Math.round(m.y)});
 for(const b of Object.values(mc.InputButton??{}))g("inputInfo."+b,()=>ii.getButtonState(b));
 for(const c of Object.keys(mc.InputPermissionCategory??{}))if(isNaN(+c))g("inputPermissions."+c,()=>q.inputPermissions.isPermissionCategoryEnabled(mc.InputPermissionCategory[c]));
 for(const k of props(q.clientSystemInfo))g("clientSystemInfo."+k,()=>{const x=q.clientSystemInfo[k];return typeof x==="object"?undefined:x});
 for(const c of q.getComponents()){const id=c.typeId;if(COMP[id]){try{COMP[id](c,v)}catch{}continue}
  if("currentValue"in c){g(short(id),()=>num(Math.round(c.currentValue*10)/10));continue}
  for(const k of props(c)){if(k==="typeId"||k==="entity"||k==="isValid")continue;g(short(id)+"."+k,()=>{const x=c[k];return typeof x==="boolean"||typeof x==="number"||typeof x==="string"?x:undefined})}}
 return v}
// debugger tracepoints evaluate __labv([[name,()=>value],...]) inside the paused frame: one round trip, the tap's formatter
globalThis.__labv=(list)=>list.map(([k,f])=>{let v;try{v=f()}catch(x){return k+"=<"+(x?.message??x)+">"}if(v===undefined||v===null)return k+"="+v;if(typeof v==="function"||v===world||v===system||(v&&typeof v==="object"&&Object.prototype.toString.call(v)==="[object Module]"))return null;if(is(v,mc.Dimension))return k+"="+v.id;const s=typeof v==="string"?JSON.stringify(v):fv(v);return /^[A-Z]\w*\{\}$/.test(s)?null:k+"="+s}).filter(Boolean).join("\u0001");
// view: a box of the world as Mojang Creator Tools' IBlockVolume (layers bottom->top, rows north->south, chars west->east)
globalThis.__labvol=(a,b)=>{const d=dim(),lo={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),z:Math.min(a.z,b.z)},hi={x:Math.max(a.x,b.x),y:Math.max(a.y,b.y),z:Math.max(a.z,b.z)};
if((hi.x-lo.x+1)*(hi.y-lo.y+1)*(hi.z-lo.z+1)>262144)throw new Error("view: at most 64x64x64 blocks");
const C="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+-/:;<=>?@^_~",key={},rev=new Map(),L=[];let n=0,solid=0;
for(let y=lo.y;y<=hi.y;y++){const rows=[];for(let z=lo.z;z<=hi.z;z++){let r="";for(let x=lo.x;x<=hi.x;x++){const bl=d.getBlock({x,y,z});if(!bl||bl.isAir){r+=".";continue}solid++;
const st=bl.permutation.getAllStates(),k=bl.typeId+JSON.stringify(st);let c=rev.get(k);if(!c){c=n<C.length?C[n]:String.fromCharCode(0x100+n);n++;rev.set(k,c);key[c]={typeId:bl.typeId,properties:st}}r+=c}rows.push(r)}L.push(rows)}
return JSON.stringify({southWestBottom:lo,size:{x:hi.x-lo.x+1,y:hi.y-lo.y+1,z:hi.z-lo.z+1},key,blockLayersBottomToTop:L,solid,types:n})};
globalThis.__labsave=(name,text)=>new Promise(res=>{console.warn("lab:action "+JSON.stringify({op:"save",name,text:""}));let i=0,n=0;const step=()=>{for(let k=0;k<3&&i<text.length;k++,i+=1800)console.warn("lab:action "+JSON.stringify({op:"save",name,text:text.slice(i,i+1800),append:true,n:n++}));if(i<text.length)system.runTimeout(step,1);else res(text.length)};step()});
// the server's own tick, every 10 ticks: the lab's clients pace themselves by it (a sped-up server that cannot keep up would
// otherwise fall behind their clocks). The lab takes these lines out of the log
system.runInterval(()=>console.warn("LAB_T "+system.currentTick),10);
// lab:sync <n>: the lab sends it after a console command and waits for LAB_SYNC <n> (commands run in order: the one before is done)
system.afterEvents.scriptEventReceive.subscribe(e=>{if(e.id==="lab:sync")console.warn("LAB_SYNC "+e.message)},{namespaces:["lab"]});
console.warn("LAB_JS_READY");
