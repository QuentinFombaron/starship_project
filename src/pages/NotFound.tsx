import { Link } from 'react-router'

export function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 px-5 text-center">
      <div className="label">Loss of signal</div>
      <h1 className="heading text-5xl">Page not found</h1>
      <Link to="/" className="btn">
        Return to base
      </Link>
    </div>
  )
}
