import type { BrowserGameDocument } from '@common-arcade/protocol'
import { configurationDefaults } from './configuration.js'

/** Local Studio simulation only. Hosted presentations never include this runner.
 * The saved rules execute inside the same opaque-origin iframe as creator UI,
 * never in the Studio host. Live authority remains the sandboxed match worker.
 */
export function managedPreviewRuntime(document: BrowserGameDocument): string {
  if (document.runtime?.kind !== 'sandboxed-script') return ''
  const source = document.files.find(
    (file) => file.path === document.runtime!.entryFile,
  )!.content
  const roster = (
    document.play?.roles ?? [
      { id: 'player', count: document.play?.seats.default ?? 2 },
    ]
  )
    .flatMap((role) =>
      Array.from({ length: role.count }, () => ({
        role: role.id,
        ...('team' in role && role.team ? { team: role.team } : {}),
      })),
    )
    .map((seat, i) => ({ ...seat, seatId: `seat-${i + 1}` }))
  const configuration = configurationDefaults(document.configurationSchema)
  return `
function installManagedPreview(){
  const rules=(()=>{const globalThis={arcadePrepared:null};${source}\n;return {game:globalThis.arcadeGame,scope:globalThis}})();
  const game=rules.game;
  const api=window.arcade;
  if(typeof api?.render!=='function')throw Error('Managed presentation must define window.arcade.render.');
  const render=api.render.bind(api);
  const roster=${JSON.stringify(roster).replace(/</g, '\\u003c')};
  const clone=value=>JSON.parse(JSON.stringify(value));
  const initialization={matchId:'mat_studio_preview',seed:'arcade-preview-seed',configuration:${JSON.stringify(configuration).replace(/</g, '\\u003c')},roster};
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value};
  rules.scope.arcadePrepared=freeze(clone(game.prepare?game.prepare(clone(initialization)):null));
  let state=clone(game.initialize(clone(initialization)));
  let elapsedMs=0,stateSequence=0,eventSequence=0,tick=0,stopped=false;
  const context=seatId=>({matchId:'mat_studio_preview',seatId,stateSequence,eventSequence,elapsedMs,authoritativeTime:new Date(elapsedMs).toISOString()});
  const result=()=>game.result(clone(state));
  const observe=seatId=>game.observe(clone(state),seatId,context(seatId));
  const draw=()=>{const observation=observe(roster[0].seatId);render(observation.visibleState,{observation,inputEnabled:!stopped&&!result(),match:{id:'mat_studio_preview',status:result()?'completed':'running',seats:roster.map(s=>({id:s.seatId,role:s.role}))},preview:true})};
  let drawPending=false;const scheduleDraw=()=>{if(drawPending)return;drawPending=true;requestAnimationFrame(()=>{drawPending=false;draw()})};
  const transition=next=>{state=clone(next.state);stateSequence++;eventSequence+=(next.events??[]).length;scheduleDraw()};
  api.seats=()=>roster.map((s,i)=>({id:s.seatId,label:'Player '+(i+1)}));
  api.observe=seatId=>{const o=observe(seatId);const visible={...o.visibleState};const context=visible.arcadeDecisionContext;if(context){const ids=new Map(o.legalActions.map(a=>[a.id??a.type,registerAction(a)]));visible.arcadeDecisionContext={...context,actionScores:Object.fromEntries(Object.entries(context.actionScores??{}).map(([id,score])=>[ids.get(id)??id,score])),preferredActions:(context.preferredActions??[]).map(id=>ids.get(id)??id),avoidActions:(context.avoidActions??[]).map(id=>ids.get(id)??id)}}return{...visible,visibleState:visible,feedback:o.feedback??null,result:result(),elapsedMs}};
  const actionIds=new Map,actionValues=new Map;let nextActionId=0;
  const registerAction=action=>{
    const key=JSON.stringify(action);let id=actionIds.get(key);
    if(!id){if(actionIds.size>=4096){actionIds.clear();actionValues.clear()}id='managed-'+(++nextActionId);actionIds.set(key,id);actionValues.set(id,clone(action))}
    return id;
  };
  api.actions=seatId=>{
    if(result())return [];
    const available=observe(seatId).legalActions;
    return available.map((action,i)=>{
      const release=available.find(candidate=>(candidate?.id??candidate?.type)===action?.control?.releaseActionId);
      return{id:registerAction(action),label:action?.label??action?.type??('Action '+(i+1)),...(action?.control?{control:{...action.control,releaseActionId:release===undefined?undefined:registerAction(release)}}:{})};
    });
  };
  api.step=(input,seatId)=>{
    if(stopped||result())return false;
    const action=seatId===undefined?input:actionValues.get(input);
    seatId??=roster[0].seatId;
    if(action===undefined)return false;
    const rejected=game.validateAction(clone(state),clone(action),context(seatId));
    if(rejected!==null&&rejected!==undefined&&rejected!==true)return false;
    transition(game.applyAction(clone(state),clone(action),context(seatId)));return true;
  };
  const submit=api.step;
  api.release=seatId=>{
    const available=observe(seatId).legalActions;
    const releaseIds=new Set(available.map(action=>action?.control?.releaseActionId).filter(Boolean));
    for(const action of available)if(releaseIds.has(action?.id??action?.type))submit(registerAction(action),seatId);
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
