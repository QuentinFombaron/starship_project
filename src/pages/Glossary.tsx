import { useState } from 'react'
import { glossary } from '../content/loader'

export function Glossary() {
  const [q, setQ] = useState('')
  const list = glossary
    .filter((g) => !q || `${g.term} ${g.short ?? ''} ${g.definition}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.term.localeCompare(b.term))
  return (
    <div className="mx-auto max-w-[1100px] px-5 py-14 md:px-10">
      <div className="label mb-3">Learn the language</div>
      <h1 className="heading text-4xl md:text-6xl">Glossary</h1>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="SEARCH TERMS"
        className="heading mt-10 w-full border-b border-line bg-transparent py-3 text-sm tracking-[0.14em] outline-none placeholder:text-faint focus:border-white"
      />
      <dl className="mt-8 divide-y divide-line">
        {list.map((g) => (
          <div key={g.term} className="grid gap-2 py-6 md:grid-cols-[260px_1fr]">
            <dt className="heading text-lg">
              {g.term}
              {g.short && <div className="label mt-1">{g.short}</div>}
            </dt>
            <dd className="leading-relaxed text-white/75">{g.definition}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
