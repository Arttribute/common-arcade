'use client'
import { useEffect, useRef, useState } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { Code2, Wand2 } from 'lucide-react'

function SourceEditor({
  path,
  value,
  onChange,
}: {
  path: string
  value: string
  onChange?: (value: string) => void
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    change = useRef(onChange)
  change.current = onChange
  useEffect(() => {
    if (!host.current) return
    const extension = path.endsWith('.json')
      ? json()
      : /\.css$/.test(path)
        ? css()
        : /\.(html|svg)$/.test(path)
          ? html()
          : javascript({
              typescript: /\.tsx?$/.test(path),
              jsx: /\.[jt]sx$/.test(path),
            })
    const editor = new EditorView({
      parent: host.current,
      doc: value,
      extensions: [
        basicSetup,
        extension,
        EditorView.editable.of(Boolean(change.current)),
        EditorView.contentAttributes.of({ 'aria-label': `Source: ${path}` }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) change.current?.(update.state.doc.toString())
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '12px' },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          },
          '.cm-content': { padding: '16px 0' },
          '&.cm-focused': { outline: 'none' },
        }),
      ],
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
  }, [path])
  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
      })
  }, [value])
  return <div className="source-editor-host" ref={host} />
}
export function StudioCodeEditor({
  files,
  onChange,
}: {
  files: readonly { path: string; content: string }[]
  onChange?: (path: string, content: string) => void
}) {
  const [selected, setSelected] = useState(files[0]?.path ?? '')
  const [error, setError] = useState(''),
    [formatting, setFormatting] = useState(false)
  const latestFiles = useRef(files)
  latestFiles.current = files
  const active = files.find((f) => f.path === selected) ?? files[0]
  async function format() {
    if (!active || !onChange) return
    setError('')
    setFormatting(true)
    try {
      const [prettier, babel, estree, htmlPlugin, postcss, typescript] =
        await Promise.all([
          import('prettier/standalone'),
          import('prettier/plugins/babel'),
          import('prettier/plugins/estree'),
          import('prettier/plugins/html'),
          import('prettier/plugins/postcss'),
          import('prettier/plugins/typescript'),
        ])
      const parser = active.path.endsWith('.json')
        ? 'json'
        : /\.css$/.test(active.path)
          ? 'css'
          : /\.(html|svg)$/.test(active.path)
            ? 'html'
            : /\.tsx?$/.test(active.path)
              ? 'typescript'
              : 'babel'
      const original = active.content
      const formatted = await prettier.format(original, {
        parser,
        plugins: [babel, estree, htmlPlugin, postcss, typescript],
        tabWidth: 2,
        semi: false,
        singleQuote: true,
      })
      if (
        latestFiles.current.find((file) => file.path === active.path)
          ?.content !== original
      ) {
        setError(
          'The file changed while formatting. Format it again to include your latest edits.',
        )
        return
      }
      onChange(active.path, formatted)
    } catch {
      setError('This file has a syntax error. Fix it before formatting.')
    } finally {
      setFormatting(false)
    }
  }
  if (!active)
    return (
      <div className="source-empty">
        Your source files will appear here once you build a game.
      </div>
    )
  return (
    <div className="source-browser">
      <nav aria-label="Source files">
        {files.map((f) => (
          <button
            key={f.path}
            aria-pressed={f.path === active.path}
            onClick={() => {
              setSelected(f.path)
              setError('')
            }}
          >
            <Code2 size={13} />
            {f.path}
          </button>
        ))}
      </nav>
      <div className="source-main">
        <header>
          <span>{active.path}</span>
          {onChange && (
            <button onClick={() => void format()} disabled={formatting}>
              <Wand2 size={13} />
              {formatting ? 'Formatting…' : 'Format'}
            </button>
          )}
        </header>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <SourceEditor
          key={active.path}
          path={active.path}
          value={active.content}
          onChange={onChange && ((content) => onChange(active.path, content))}
        />
      </div>
    </div>
  )
}
