import { ArrowLeft } from '@phosphor-icons/react'

type PlaceholderPageProps = {
  title: string
  body: string
}

export function PlaceholderPage({ title, body }: PlaceholderPageProps) {
  return (
    <main className="placeholder-page">
      <a className="brand" href="/" aria-label="Volver a Inquilink">
        <span className="brand-mark" aria-hidden="true">i</span>
        Inquilink
      </a>
      <div className="placeholder-card">
        <p className="section-kicker">Inquilink</p>
        <h1>{title}</h1>
        <p>{body}</p>
        <a className="text-link" href="/">
          <ArrowLeft aria-hidden="true" /> Volver al inicio
        </a>
      </div>
    </main>
  )
}
