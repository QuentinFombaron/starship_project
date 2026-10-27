import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter } from 'react-router'
import { Layout } from './components/Layout'
import { Loading } from './components/Loading'
import { Home } from './pages/Home'
import { Flights } from './pages/Flights'
import { FlightDetail } from './pages/FlightDetail'
import { Vehicles } from './pages/Vehicles'
import { Stats } from './pages/Stats'
import { Glossary } from './pages/Glossary'
import { NotFound } from './pages/NotFound'

const Replay = lazy(() => import('./pages/Replay'))
const StarbaseExplorer = lazy(() => import('./pages/StarbaseExplorer'))

const suspense = (node: ReactNode) => <Suspense fallback={<Loading label="Loading 3D world" />}>{node}</Suspense>

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/flights', element: <Flights /> },
      { path: '/flights/:id', element: <FlightDetail /> },
      { path: '/vehicles', element: <Vehicles /> },
      { path: '/stats', element: <Stats /> },
      { path: '/glossary', element: <Glossary /> },
      { path: '*', element: <NotFound /> },
    ],
  },
  { path: '/flights/:id/replay', element: suspense(<Replay />) },
  { path: '/starbase', element: suspense(<StarbaseExplorer />) },
])
