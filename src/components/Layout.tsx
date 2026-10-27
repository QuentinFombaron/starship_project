import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'

const NAV = [
  { to: '/flights', label: 'Flights' },
  { to: '/flights/flight-14/replay', label: 'Replay' },
  { to: '/vehicles', label: 'Fleet' },
  { to: '/stats', label: 'Program' },
  { to: '/starbase', label: 'Starbase' },
  { to: '/glossary', label: 'Glossary' },
]

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`heading flex items-baseline gap-2 text-white ${className}`}>
      <span className="text-[17px] tracking-[0.42em]">STARSHIP</span>
      <span className="text-[10px] tracking-[0.3em] text-dim">FLIGHT REPLAY</span>
    </span>
  )
}

export function Nav({ overlay = false }: { overlay?: boolean }) {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const loc = useLocation()
  useEffect(() => {
    setOpen(false)
  }, [loc.pathname])
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-colors duration-500 ${
        overlay && !scrolled && !open ? 'bg-gradient-to-b from-black/70 to-transparent' : 'bg-black/90 backdrop-blur'
      }`}
    >
      <nav className="mx-auto flex h-[72px] max-w-[1600px] items-center justify-between px-5 md:px-10">
        <Link to="/" aria-label="Home">
          <Wordmark />
        </Link>
        <ul className="hidden items-center gap-8 lg:flex">
          {NAV.map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to}
                end={n.to === '/flights'}
                className={({ isActive }) =>
                  `heading relative text-[12.5px] tracking-[0.14em] transition-colors after:absolute after:-bottom-1.5 after:left-0 after:h-px after:bg-white after:transition-all after:duration-300 hover:after:w-full ${
                    isActive ? 'text-white after:w-full' : 'text-white/85 after:w-0'
                  }`
                }
              >
                {n.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <button className="flex h-10 w-10 flex-col items-center justify-center gap-[5px] lg:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className={`h-px w-6 bg-white transition ${open ? 'translate-y-[6px] rotate-45' : ''}`} />
          <span className={`h-px w-6 bg-white transition ${open ? 'opacity-0' : ''}`} />
          <span className={`h-px w-6 bg-white transition ${open ? '-translate-y-[6px] -rotate-45' : ''}`} />
        </button>
      </nav>
      {open && (
        <ul className="flex flex-col border-t border-line px-5 pb-6 lg:hidden">
          {NAV.map((n) => (
            <li key={n.to} className="border-b border-line">
              <Link to={n.to} className="heading block py-4 text-sm tracking-[0.16em]">
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </header>
  )
}

export function Footer() {
  return (
    <footer className="border-t border-line bg-black">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6 px-5 py-10 md:flex-row md:items-center md:justify-between md:px-10">
        <Wordmark />
        <p className="max-w-xl text-xs leading-relaxed text-faint">
          An unofficial fan project, not affiliated with SpaceX. Telemetry is reconstructed from public webcasts and reports; images
          belong to their credited owners. Flight data is offered as-is for learning about the Starship program.
          <br />
          3D models:{' '}
          <a className="underline hover:text-white" href="https://sketchfab.com/3d-models/spacex-starship-block-3-6f6c6f88a3eb4b4d822fdca66733fbb2" target="_blank" rel="noreferrer">
            “SpaceX Starship Block 3”
          </a>{' '}
          by Clarence365,{' '}
          <a className="underline hover:text-white" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
            CC BY 4.0
          </a>
          , modified.
        </p>
        <div className="flex gap-6">
          <Link to="/glossary" className="label hover:text-white">
            Glossary
          </Link>
          <Link to="/flights" className="label hover:text-white">
            All flights
          </Link>
        </div>
      </div>
    </footer>
  )
}

export function Layout() {
  const loc = useLocation()
  const overlay = loc.pathname === '/' || /^\/flights\/[^/]+$/.test(loc.pathname)
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [loc.pathname])
  return (
    <div className="flex min-h-full flex-col">
      <Nav overlay={overlay} />
      <main className={`flex-1 ${overlay ? '' : 'pt-[72px]'}`}>
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
