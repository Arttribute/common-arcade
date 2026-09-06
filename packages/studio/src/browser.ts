import { transform } from '@babel/standalone'
import type { BrowserGameDocument } from '@common-arcade/protocol'

const scriptSafe = (s: string) => s.replace(/<\/script/gi, '<\\/script')
/** Compilation only: user source never executes in the host process. */
export function compileBrowserPresentation(
  document: BrowserGameDocument,
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
        plugins: ['transform-modules-commonjs'],
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
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]
    if (!href || !/\brel\s*=\s*["']stylesheet["']/i.test(attrs)) return tag
    const css = files.get(resolve(document.entryFile, href))!
    return `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`
  })
  let inline = 0
  html = html.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
    (tag, attrs: string, content: string) => {
      if (/\btype\s*=\s*["'](?:application\/json|importmap)["']/i.test(attrs))
        return tag
      const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]
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
        `${JSON.stringify(path)}:function(module,exports,require){\n${code}\n}`,
    )
    .join(',\n')
  const runtime = `<script>(async()=>{const external=Object.fromEntries(await Promise.all(${JSON.stringify([...externals])}.map(async([id,url])=>[id,await import(url)])));const modules={${scriptSafe(factories)}},imports=${JSON.stringify(imports).replace(/</g, '\\u003c')},cache={};function load(id){if(external[id])return external[id];if(cache[id])return cache[id].exports;if(!modules[id])throw Error('Unknown source module: '+id);const m=cache[id]={exports:{}};modules[id](m,m.exports,name=>load(imports[id][name]));return m.exports}try{${entries.map((p) => `load(${JSON.stringify(p)});`).join('')}}catch(e){const pre=document.createElement('pre');pre.textContent='Preview error: '+e.message;pre.setAttribute('role','alert');document.body.append(pre);console.error(e)}})();</script>`
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://esm.sh; connect-src https://esm.sh; style-src 'unsafe-inline'; img-src data: blob: https:; media-src data: blob: https:; font-src data:; worker-src blob:; form-action 'none'; base-uri 'none'">`
  html = /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b[^>]*>/i, (m) => m + policy)
    : policy + html
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, runtime + '</body>')
    : html + runtime
}
