import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const SUGGESTIONS = [
  'Latest on NVIDIA',
  "Today's cricket news",
  'Explain inflation simply',
  'What is happening in AI this week?',
]

const markdown = {
  p: (props) => <p className="mb-3 last:mb-0" {...props} />,
  ul: (props) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0" {...props} />,
  ol: (props) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0" {...props} />,
  h1: (props) => <h3 className="mb-2 text-base font-semibold" {...props} />,
  h2: (props) => <h3 className="mb-2 text-base font-semibold" {...props} />,
  h3: (props) => <h3 className="mb-2 font-semibold" {...props} />,
  strong: (props) => <strong className="font-semibold" {...props} />,
  a: (props) => (
    <a className="text-indigo-600 underline underline-offset-2 dark:text-indigo-400" target="_blank" rel="noreferrer" {...props} />
  ),
  code: (props) => <code className="rounded bg-zinc-100 px-1 py-0.5 text-[0.9em] dark:bg-zinc-800" {...props} />,
  table: (props) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: (props) => <th className="border-b border-zinc-200 px-2 py-1.5 text-left font-semibold dark:border-zinc-700" {...props} />,
  td: (props) => <td className="border-b border-zinc-100 px-2 py-1.5 align-top dark:border-zinc-800" {...props} />,
}

function formatDate(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function SourceCards({ sources }) {
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {sources.map((s) => (
        <a
          key={s.url}
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className="group rounded-xl border border-zinc-200 bg-white p-3 transition hover:border-indigo-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700"
        >
          <p className="line-clamp-2 text-sm font-medium text-zinc-900 group-hover:text-indigo-600 dark:text-zinc-100 dark:group-hover:text-indigo-400">
            {s.title}
          </p>
          <p className="mt-1.5 text-xs text-zinc-500">
            {s.source}
            {s.publishedAt && ` · ${formatDate(s.publishedAt)}`}
          </p>
        </a>
      ))}
    </div>
  )
}

function Message({ message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-white">
          {message.content}
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%]">
        <div className="rounded-2xl rounded-bl-md bg-white px-4 py-3 text-zinc-800 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdown}>
            {message.content}
          </ReactMarkdown>
        </div>
        {message.sources?.length > 0 && <SourceCards sources={message.sources} />}
      </div>
    </div>
  )
}

function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, error])

  async function ask(history) {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
      setMessages([...history, { role: 'assistant', content: data.answer, sources: data.sources }])
    } catch (e) {
      setError(e instanceof TypeError ? `Could not reach the server at ${API_URL}.` : e.message)
    } finally {
      setLoading(false)
    }
  }

  function send(text) {
    const content = text.trim()
    if (!content || loading) return
    const history = [...messages, { role: 'user', content }]
    setMessages(history)
    setInput('')
    ask(history)
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="flex h-full flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <h1 className="font-semibold text-zinc-900 dark:text-zinc-100">News Chat</h1>
          {messages.length > 0 && (
            <button
              onClick={() => { setMessages([]); setError('') }}
              disabled={loading}
              className="text-sm text-zinc-500 hover:text-zinc-900 disabled:opacity-50 dark:hover:text-zinc-100"
            >
              New chat
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
          {messages.length === 0 && (
            <div className="pt-16 text-center sm:pt-24">
              <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                Ask about the news, or anything else
              </h2>
              <p className="mt-2 text-zinc-500">News answers come with sources you can check.</p>
              <div className="mt-8 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-indigo-700 dark:hover:text-indigo-400"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => <Message key={i} message={m} />)}

          {loading && (
            <div className="flex items-center gap-1.5 px-1" aria-label="Loading">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="h-2 w-2 animate-bounce rounded-full bg-zinc-400"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              <span>{error}</span>
              <button onClick={() => ask(messages)} className="shrink-0 font-medium underline">
                Retry
              </button>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </main>

      <footer className="border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <form
          onSubmit={(e) => { e.preventDefault(); send(input) }}
          className="mx-auto flex max-w-3xl items-end gap-2 px-4 py-3"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask a question…"
            className="max-h-40 flex-1 resize-none rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </footer>
    </div>
  )
}

export default App
