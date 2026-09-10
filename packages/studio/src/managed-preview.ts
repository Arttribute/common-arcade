import type { BrowserGameDocument } from '@common-arcade/protocol'

/** Local Studio simulation only. Hosted presentations never include this runner.
 * The saved rules execute inside the same opaque-origin iframe as creator UI,
 * never in the Studio host. Live authority remains the sandboxed match worker.
 */
export function managedPreviewRuntime(document: BrowserGameDocument): string {
  if (document.runtime?.kind !== 'sandboxed-script') return ''
  const source = document.files.find(
    (file) => file.path === document.runtime!.entryFile,
  )!.content
  return `
function installManagedPreview(){
  const game=(()=>{const globalThis={};${source}\n;return globalThis.arcadeGame})();
  const api=window.arcade;
  if(typeof api?.render!=='function')throw Error('Managed presentation must define window.arcade.render.');
  const render=api.render.bind(api);
  const roster=Array.from({length:${document.play?.seats.default ?? 2}},(_,i)=>({seatId:'seat-'+(i+1),role:'player'}));
  const clone=value=>JSON.parse(JSON.stringify(value));
  let state=clone(game.initialize({matchId:'mat_studio_preview',seed:'arcade-preview-seed',configuration:{},roster}));
  let elapsedMs=0,stateSequence=0,eventSequence=0,tick=0,stopped=false;
  const context=seatId=>({matchId:'mat_studio_preview',seatId,stateSequence,eventSequence,elapsedMs,authoritativeTime:new Date(elapsedMs).toISOString()});
  const result=()=>game.result(clone(state));
  const observe=seatId=>game.observe(clone(state),seatId,context(seatId));
  const draw=()=>{const observation=observe(roster[0].seatId);render(observation.visibleState,{observation,match:{id:'mat_studio_preview',status:result()?'completed':'running',seats:roster.map(s=>({id:s.seatId,role:s.role}))},preview:true})};
  const transition=next=>{state=clone(next.state);stateSequence++;eventSequence+=(next.events??[]).length;draw()};
  api.seats=()=>roster.map((s,i)=>({id:s.seatId,label:'Player '+(i+1)}));
  api.observe=seatId=>{const o=observe(seatId);return{...o.visibleState,visibleState:o.visibleState,feedback:o.feedback??null,result:result(),elapsedMs}};
  const actionIds=new Map,actionValues=new Map;let nextActionId=0;
  api.actions=seatId=>result()?[]:observe(seatId).legalActions.map((action,i)=>{
    const key=JSON.stringify(action);let id=actionIds.get(key);
    if(!id){if(actionIds.size>=4096){actionIds.clear();actionValues.clear()}id='managed-'+(++nextActionId);actionIds.set(key,id);actionValues.set(id,clone(action))}
    return{id,label:action?.label??action?.type??('Action '+(i+1))};
  });
  api.step=(input,seatId)=>{
    if(stopped||result())return false;
    const action=seatId===undefined?input:actionValues.get(input);
    seatId??=roster[0].seatId;
    if(action===undefined)return false;
    const rejected=game.validateAction(clone(state),clone(action),context(seatId));
    if(rejected!==null&&rejected!==undefined&&rejected!==true)return false;
    transition(game.applyAction(clone(state),clone(action),context(seatId)));return true;
  };
  draw();
  const deltaMs=1000/${document.runtime.tickRate};
  const timer=${document.play?.mode === 'realtime' || document.play?.mode === 'hybrid'}?setInterval(()=>{
    if(stopped||result()){clearInterval(timer);return}
    try{const next=game.tick(clone(state),{matchId:'mat_studio_preview',tick:++tick,stateSequence,eventSequence,elapsedMs,deltaMs});elapsedMs+=deltaMs;transition(next)}
    catch(error){clearInterval(timer);window.__arcadeRuntime={status:'error',message:String(error?.message??error)}}
  },deltaMs):undefined;
  window.addEventListener('message',event=>{if(event.source===window.parent&&event.data?.type==='arcade.authoritative-state'){stopped=true;clearInterval(timer)}});
}
installManagedPreview();
`
}
