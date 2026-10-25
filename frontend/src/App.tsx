import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { features } from './features'
import Home from './screens/Home'

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
        {features.modes.publicSpeaking && (
          <Route path="/public-speaking/*" element={<Placeholder title="Public speaking" />} />
        )}
        {features.modes.debate && <Route path="/debate/*" element={<Placeholder title="Debate" />} />}
        {features.modes.interview && (
          <Route path="/interview/*" element={<Placeholder title="Interview" />} />
        )}
        {features.history && <Route path="/history" element={<Placeholder title="History" />} />}
        <Route path="*" element={<Placeholder title="Not found" />} />
      </Routes>
    </BrowserRouter>
  )
}
