import { transform } from '@babel/standalone'
import { managedPreviewRuntime } from './managed-preview.js'
import type { BrowserGameDocument } from '@common-arcade/protocol'
import { createBrowserPolicy } from './browser-policy.js'
import { createPreviewAgentRuntime } from './preview-agent-runtime.js'

const attribute = (attrs: string, name: string) => {
  const match = attrs.match(
    new RegExp(
      `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      'i',
    ),
  )
  return match?.[1] ?? match?.[2] ?? match?.[3]
}
const scriptSafe = (s: string) => s.replace(/<\/script/gi, '<\\/script')
const sandboxStoragePlugin = ({ types }: { types: any }) => ({
  visitor: {
    ReferencedIdentifier(path: any) {
      const name = path.node.name
      if (
        (name === 'localStorage' || name === 'sessionStorage') &&
        !path.scope.hasBinding(name)
      )
        path.replaceWith(
          types.identifier(
            name === 'localStorage'
              ? '__arcadeLocalStorage'
              : '__arcadeSessionStorage',
          ),
        )
    },
    MemberExpression(path: any) {
      const object = path.node.object
      const property = path.node.property
      const global =
        types.isIdentifier(object, { name: 'window' }) ||
        types.isIdentifier(object, { name: 'globalThis' })
      const name = path.node.computed
        ? types.isStringLiteral(property)
          ? property.value
          : undefined
        : types.isIdentifier(property)
          ? property.name
          : undefined
      if (!global || (name !== 'localStorage' && name !== 'sessionStorage'))
        return
      path.replaceWith(
        types.identifier(
          name === 'localStorage'
            ? '__arcadeLocalStorage'
            : '__arcadeSessionStorage',
        ),
      )
    },
  },
})
const browserCompatibilityRuntime = `
function createStorage(){let values=new Map;return{get length(){return values.size},clear(){values.clear()},getItem(key){key=String(key);return values.has(key)?values.get(key):null},key(index){return [...values.keys()][Number(index)]??null},removeItem(key){values.delete(String(key))},setItem(key,value){values.set(String(key),String(value))}}}
function safeStorage(name){if(location.origin==='null')return createStorage();try{const storage=window[name],probe='__arcade_storage_probe__';storage.setItem(probe,'1');storage.removeItem(probe);return storage}catch{return createStorage()}}
const __arcadeLocalStorage=safeStorage('localStorage'),__arcadeSessionStorage=safeStorage('sessionStorage');
for(const [name,storage] of [['localStorage',__arcadeLocalStorage],['sessionStorage',__arcadeSessionStorage]]){try{Object.defineProperty(window,name,{configurable:true,value:storage})}catch{}}
const projectFiles=__ARCADE_FILES__,entryFile=__ARCADE_ENTRY__,nativeFetch=window.fetch.bind(window);window.fetch=(input,init)=>{const value=typeof input==='string'?input:input instanceof URL?input.href:input?.url;if(typeof value==='string'&&!/^[a-z]+:/i.test(value)&&!value.startsWith('//')){const base='https://arcade.invalid/'+entryFile,path=new URL(value,base).pathname.slice(1);if(Object.hasOwn(projectFiles,path)){const extension=path.split('.').pop()?.toLowerCase(),type=extension==='json'?'application/json':extension==='css'?'text/css':extension==='svg'?'image/svg+xml':'text/plain';return Promise.resolve(new Response(projectFiles[path],{status:200,headers:{'Content-Type':type}}))}}return nativeFetch(input,init)};
function installArcadeSeats(){
  let api=window.arcade;
  const configured=__ARCADE_PLAY__;
  let bridge='semantic';
  if(api?.__multiSeatBridge)return;
  if(!api){
    bridge='dom-fallback';
    const elements=()=>Array.from(document.querySelectorAll('button,[role="button"],input[type="button"]')).filter(element=>!element.hasAttribute('disabled'));
    const controlsFor=(seatId)=>{
      const all=elements(),playable=all.filter(element=>!/restart|reset|new game/i.test((element.getAttribute('aria-label')||element.textContent||'').trim()));
      const count=configured?.seats?.default??2,index=Math.max(0,Number(String(seatId).match(/(\\d+)$/)?.[1]??1)-1);
      return count>1&&playable.length>=count*2&&playable.length%count===0?playable.slice(index*(playable.length/count),(index+1)*(playable.length/count)):playable;
    };
    api={
      observe:()=>({text:document.body.innerText.slice(0,8000)}),
      actions:(seatId)=>controlsFor(seatId).slice(0,80).map(element=>({id:'click:'+elements().indexOf(element),label:(element.getAttribute('aria-label')||element.textContent||'Button').trim().slice(0,200)})),
      step:async(id,seatId)=>{const element=elements()[Number(String(id).slice(6))];if(!element||!controlsFor(seatId).includes(element))return false;const pointer=type=>element.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,pointerType:'mouse',isPrimary:true,button:0,buttons:type.endsWith('down')?1:0})),mouse=type=>element.dispatchEvent(new MouseEvent(type,{bubbles:true,button:0,buttons:type.endsWith('down')?1:0}));pointer('pointerdown');mouse('mousedown');await new Promise(resolve=>setTimeout(resolve,120));pointer('pointerup');mouse('mouseup');element.click();return true;},
    };
    window.arcade=api;
  }
  let declared;try{declared=typeof api.seats==='function'?api.seats():api.seats}catch{declared=[]}
  const count=configured?.seats?.default??2;
  const rawSeats=Array.isArray(declared)&&declared.length?declared.slice(0,16):Array.from({length:count},(_,index)=>({id:'seat-'+(index+1),label:'Player '+(index+1)}));
  const seats=rawSeats.map((seat,index)=>{
    const sourceId=String(typeof seat==='string'?seat:(seat.id??('seat-'+(index+1))));
    const safe=(sourceId.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,40)||'seat')+'-'+(index+1);
    return{id:safe,label:String(typeof seat==='string'?('Player '+(index+1)):(seat.label??('Player '+(index+1)))),sourceId};
  });
  const publicSeats=seats.map(({id,label,sourceId},index)=>({id,label,sourceId,index}));
  const observe=typeof api.observe==='function'?api.observe.bind(api):()=>({text:document.body.innerText.slice(0,8000)});
  const actions=typeof api.actions==='function'?api.actions.bind(api):()=>[];
  const step=typeof api.step==='function'?api.step.bind(api):undefined;
  const release=typeof api.release==='function'?api.release.bind(api):undefined;
  const render=typeof api.render==='function'?api.render.bind(api):undefined;
  const actionLookup=new Map;
  api.seats=()=>publicSeats;
  api.observe=()=>{
    const observations=Object.fromEntries(seats.map(seat=>[seat.id,observe(seat.sourceId)]));
    return{game:observations[seats[0]?.id],arcade:{seats:publicSeats,mode:configured?.mode??'turn-based',bridge,observations,runtime:window.__arcadeRuntime}};
  };
  api.actions=()=>{
    actionLookup.clear();
    return seats.flatMap(seat=>{
      const available=actions(seat.sourceId);
      return Array.isArray(available)?available.map((action,index)=>{
        const full='seat:'+encodeURIComponent(seat.id)+':'+encodeURIComponent(String(action.id));
        const id=full.length<=100?full:'seat:'+encodeURIComponent(seat.id)+':action-'+index;
        actionLookup.set(id,{actionId:String(action.id),seatId:seat.sourceId});
        const control=action.control?{...action.control,releaseActionId:action.control.releaseActionId?'seat:'+encodeURIComponent(seat.id)+':'+encodeURIComponent(action.control.releaseActionId):undefined}:undefined;
        return{id,label:seat.label+' · '+String(action.label??action.id),...(control?{control}:{})};
      }):[];
    });
  };
  if(step)api.step=(encoded)=>{
    const selected=actionLookup.get(String(encoded));
    if(selected)return step(selected.actionId,selected.seatId);
    const match=/^seat:([^:]+):(.*)$/.exec(String(encoded));
    return match?step(decodeURIComponent(match[2]),decodeURIComponent(match[1])):step(encoded);
  };
  if(release)api.release=(id)=>release(seats.find(seat=>seat.id===id)?.sourceId??id);
  let authoritative=false,inputEnabled=false,inputFocused=true;
  const heldKeys=new Map;
  window.addEventListener('keydown',event=>heldKeys.set(event.code,event.key));
  window.addEventListener('keyup',event=>heldKeys.delete(event.code));
  window.addEventListener('focus',()=>{inputFocused=true});
  window.addEventListener('blur',()=>{inputFocused=false;if(authoritative){window.parent.postMessage({type:'arcade.release-input'},'*');for(const [code,key] of [...heldKeys])window.dispatchEvent(new KeyboardEvent('keyup',{code,key,bubbles:true}));heldKeys.clear()}});
  const agents=step&&bridge==='semantic'&&['realtime','hybrid'].includes(configured?.mode)
    ? (__ARCADE_AGENT_RUNTIME__)({
        api,policy:(__ARCADE_AGENT_POLICY__)(),
        now:()=>performance.now(),
        requestFrame:callback=>requestAnimationFrame(callback),
        cancelFrame:id=>cancelAnimationFrame(id),
        emit:message=>window.parent.postMessage(message,'*'),
      }):undefined;
  window.addEventListener('message',event=>{
    if(event.source!==window.parent)return;
    const data=event.data;
    if(data?.type==='arcade.preview-policy.start'){
      if(authoritative||!agents){window.parent.postMessage({type:'arcade.preview-policy.stopped',runId:data.runId,epoch:data.epoch,reason:'This preview has no local realtime semantic controller'},'*');return}
      agents.start(data);
    }
    if(data?.type==='arcade.preview-policy.stop')agents?.stop();
    if(data?.type==='arcade.preview-policy.heartbeat')agents?.heartbeat(data.epoch);
    if(data?.command==='mode'&&data?.payload?.editing===true)agents?.stop('Preview inspection paused controls');
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)agents?.stop('Preview hidden')});
  window.addEventListener('pagehide',()=>agents?.stop('Preview closed'));
  window.addEventListener('message',event=>{
    if(event.source!==window.parent||event.data?.type!=='arcade.authoritative-state')return;
    authoritative=true;
    agents?.stop('Authoritative runtime owns these controls');
    inputEnabled=event.data.inputEnabled !== false && Boolean(event.data.observation?.seatId) && event.data.match?.status === 'running';
    if(render)render(event.data.state,{observation:event.data.observation,match:event.data.match,mode:event.data.mode,controllerKind:event.data.controllerKind,inputEnabled});
    window.dispatchEvent(new CustomEvent('arcade:authoritative-state',{detail:event.data}));
  });
  api.submit=(action)=>{
    if(authoritative){if(!inputEnabled||!inputFocused)return false;window.parent.postMessage({type:'arcade.action',action},'*');return true}
    return step?step(action):false;
  };
  api.__multiSeatBridge=true;
}
`
/** Compilation only: user source never executes in the host process. */
export function compileBrowserPresentation(
  document: BrowserGameDocument,
  managedPreview = false,
): string {
  const files = new Map(document.files.map((f) => [f.path, f.content]))
  const externals = new Map<string, string>()
  const resolve = (from: string, specifier: string) => {
    if (
      !specifier.startsWith('.') &&
      !files.has(specifier) &&
      !/^(https?:|data:|\/)/i.test(specifier)
    ) {
      const parts = specifier.split('/')
      const root = specifier.startsWith('@')
        ? parts.slice(0, 2).join('/')
        : parts[0]!
      const version = document.dependencies?.[root]
      if (version) {
        const suffix = specifier.slice(root.length)
        const id = `external:${specifier}`
        externals.set(id, `https://esm.sh/${root}@${version}${suffix}`)
        return id
      }
    }
    if (/^(https?:|data:|\/\/)/i.test(specifier))
      throw new Error(
        'Remote executable dependencies are not supported. Include the source in your project.',
      )
    const parts = from.split('/').slice(0, -1)
    for (const part of specifier.split('/')) {
      if (part === '..') parts.pop()
      else if (part && part !== '.') parts.push(part)
    }
    const base = parts.join('/')
    const path = [
      base,
      `${base}.js`,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.jsx`,
      `${base}/index.js`,
      `${base}/index.ts`,
    ].find((p) => files.has(p))
    if (!path)
      throw new Error(`Source file not found: ${specifier} (from ${from})`)
    return path
  }
  const modules: Record<string, string> = {}
  const imports: Record<string, Record<string, string>> = {}
  const compile = (path: string): void => {
    if (path in modules || path.startsWith('external:')) return
    modules[path] = ''
    imports[path] = {}
    if (path.endsWith('.css')) {
      modules[path] =
        `const style=document.createElement('style');style.textContent=${JSON.stringify(files.get(path))};document.head.append(style);module.exports={};`
      return
    }
    if (path.endsWith('.json')) {
      modules[path] =
        `module.exports=${JSON.stringify(JSON.parse(files.get(path)!))}`
      return
    }
    const code =
      transform(files.get(path)!, {
        filename: path,
        presets: [
          /\.tsx?$/.test(path) ? 'typescript' : null,
          /\.[jt]sx$/.test(path) ? ['react', { runtime: 'automatic' }] : null,
        ].filter(Boolean) as any,
        plugins: [sandboxStoragePlugin, 'transform-modules-commonjs'],
        sourceType: 'unambiguous',
      }).code ?? ''
    // Babel has already normalized static imports to require calls.
    for (const match of code.matchAll(/\brequire\(["']([^"']+)["']\)/g)) {
      const dependency = resolve(path, match[1]!)
      imports[path]![match[1]!] = dependency
      compile(dependency)
    }
    modules[path] = code
  }
  const entries: string[] = []
  let html = files.get(document.entryFile)!
  html = html.replace(/<link\b([^>]*?)>/gi, (tag, attrs: string) => {
    const href = attribute(attrs, 'href')
    if (!href || attribute(attrs, 'rel')?.toLowerCase() !== 'stylesheet')
      return tag
    const css = files.get(resolve(document.entryFile, href))!
    return `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`
  })
  let inline = 0
  html = html.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
    (tag, attrs: string, content: string) => {
      if (
        ['application/json', 'importmap'].includes(
          attribute(attrs, 'type')?.toLowerCase() ?? '',
        )
      )
        return tag
      const src = attribute(attrs, 'src')
      const path = src
        ? resolve(document.entryFile, src)
        : `${document.entryFile.slice(0, document.entryFile.lastIndexOf('/') + 1)}__inline_${inline++}.js`
      if (!src) files.set(path, content)
      compile(path)
      entries.push(path)
      return ''
    },
  )
  const factories = Object.entries(modules)
    .map(
      ([path, code]) =>
        `${JSON.stringify(path)}:async function(module,exports,require,__arcadeLocalStorage,__arcadeSessionStorage){\n${code}\n}`,
    )
    .join(',\n')
  const compatibility = browserCompatibilityRuntime
    .replace('__ARCADE_AGENT_RUNTIME__', () =>
      createPreviewAgentRuntime.toString(),
    )
    .replace('__ARCADE_AGENT_POLICY__', () => createBrowserPolicy.toString())
    .replace('__ARCADE_ENTRY__', () =>
      JSON.stringify(document.entryFile).replace(/</g, '\\u003c'),
    )
    .replace('__ARCADE_PLAY__', () =>
      JSON.stringify(document.play ?? null).replace(/</g, '\\u003c'),
    )
    .replace('__ARCADE_FILES__', () =>
      JSON.stringify(Object.fromEntries(files)).replace(/</g, '\\u003c'),
    )
  const preview = managedPreview ? managedPreviewRuntime(document) : ''
  const runtime = `<script>(async()=>{window.__arcadeRuntime={status:'loading'};${compatibility}try{const external=Object.fromEntries(await Promise.all(${JSON.stringify([...externals])}.map(async([id,url])=>[id,await import(url)])));const modules={${scriptSafe(factories)}},imports=${JSON.stringify(imports).replace(/</g, '\\u003c')},cache={},started=new Set;function load(id){if(external[id])return external[id];if(cache[id])return cache[id].exports;throw Error('Source module was not initialized: '+id)}async function start(id){if(external[id])return external[id];if(started.has(id))return cache[id].exports;if(!modules[id])throw Error('Unknown source module: '+id);started.add(id);const m=cache[id]={exports:{}};for(const dependency of Object.values(imports[id]))await start(dependency);await modules[id](m,m.exports,name=>load(imports[id][name]),__arcadeLocalStorage,__arcadeSessionStorage);return m.exports}${entries.map((p) => `await start(${JSON.stringify(p)});`).join('')}${scriptSafe(preview)}window.__arcadeRuntime={status:'ready'}}catch(e){const message=String(e?.message??e);window.__arcadeRuntime={status:'error',message};const pre=document.createElement('pre');pre.style.cssText='position:fixed;inset:16px;z-index:2147483647;overflow:auto;padding:16px;border-radius:12px;background:#fff7ed;color:#9a3412;font:13px/1.5 ui-monospace,monospace';pre.textContent='Preview error: '+message;pre.setAttribute('role','alert');document.body.append(pre);console.error(e)}finally{try{installArcadeSeats()}catch(e){window.__arcadeRuntime={status:'error',message:'Agent play bridge: '+String(e?.message??e)};console.error(e)}}})();</script>`
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://esm.sh; connect-src https://esm.sh; style-src 'unsafe-inline'; img-src data: blob: https:; media-src data: blob: https:; font-src data:; worker-src blob:; form-action 'none'; base-uri 'none'">`
  html = /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b[^>]*>/i, (m) => m + policy)
    : policy + html
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, () => runtime + '</body>')
    : html + runtime
}
