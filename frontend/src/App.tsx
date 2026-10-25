import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { features } from './features'
import { MODES } from './modes'
import Home from './screens/Home'
import Results from './screens/Results'
import Session from './screens/Session'

function Placeholder({ title }: { title: string }) {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted-foreground">Scaffold only. Screens come in the next steps.</p>
    </main>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        {MODES.filter((m) => features.modes[m.id]).map((m) => (
          <Route key={m.id} path={m.path} element={<Session mode={m.id} />} />
        ))}
        {features.history && <Route path="/history" element={<Placeholder title="History" />} />}
        <Route path="/results" element={<Results />} />
        <Route path="/results/:session_id" element={<Results />} />
        <Route path="*" element={<Placeholder title="Not found" />} />
      </Routes>
    </BrowserRouter>
  )
}
