import { useEffect, useState } from 'react'
import { apiGet, filterQuery } from './api/client'
import SummaryCards from './components/SummaryCards'

const App = () => {
  const [filters] = useState({ dealer_id: '', event_type: '', from: '', to: '' })   // the filter controls come in a later step
  const [metrics, setMetrics] = useState<any>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadMetrics() {
      try {
        const query = filterQuery(filters)
        const late = await apiGet(`/api/metrics/late${query}`)
        const byDealer = await apiGet(`/api/metrics/by-dealer${query}`)
        setMetrics({ late, byDealer })
        setError('')
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    loadMetrics()
  }, [filters])

  return (
    <div className="container py-4">
      <h1 className="h3 mb-4">Event Analytics</h1>

      {loading && <div className="spinner-border" role="status" />}
      {error && <div className="alert alert-danger">Could not load the data: {error}</div>}
      {metrics && metrics.late.total === 0 && (
        <div className="alert alert-info">No events found. Import the file first, or loosen the filters.</div>
      )}
      {metrics && metrics.late.total > 0 && (
        <SummaryCards late={metrics.late} dealers={metrics.byDealer.by_dealer.length} />
      )}
    </div>
  )
}

export default App
