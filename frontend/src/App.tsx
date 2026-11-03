import { useEffect, useState } from 'react'
import { apiGet, emptyFilters, filterQuery, type Filters as FilterValues } from './api/client'
import SummaryCards from './components/SummaryCards'
import DailyChart from './components/DailyChart'
import TypeBars from './components/TypeBars'
import DealerTable from './components/DealerTable'
import Filters from './components/Filters'
import ImportButton from './components/ImportButton'
import EventsTable from './components/EventsTable'
import QualityPanel from './components/QualityPanel'

const App = () => {
  const [filters, setFilters] = useState(emptyFilters)
  const [refresh, setRefresh] = useState(0)                      // goes up after an import, to load the data again
  const [metrics, setMetrics] = useState<any>(null)
  const [dealers, setDealers] = useState<string[]>([])           // options for the filter dropdowns
  const [eventTypes, setEventTypes] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let stale = false                                            // becomes true if the filters change before this answer arrives
    async function loadMetrics() {
      setLoading(true)                                           // spinner on only when we really load
      try {
        const query = filterQuery(filters)
        const [late, byDealer, byType, daily] = await Promise.all([   // the 4 requests run at the same time
          apiGet(`/api/metrics/late${query}`),
          apiGet(`/api/metrics/by-dealer${query}`),
          apiGet(`/api/metrics/by-type${query}`),
          apiGet(`/api/metrics/daily${query}`),
        ])
        if (stale) return                                        // an older request: ignore its answer
        setMetrics({ late, byDealer, byType, daily })
        setError('')
      } catch (e: any) {
        if (stale) return
        setError(e.message)
        setMetrics(null)                                         // do not keep showing the old numbers under the error
      } finally {
        if (!stale) setLoading(false)
      }
    }
    loadMetrics()
    return () => { stale = true }                                // React runs this when the filters change again
  }, [filters, refresh])

  // the dropdown options come from the unfiltered numbers, so they do not shrink when a filter is applied
  useEffect(() => {
    async function loadOptions() {
      try {
        const byDealer = await apiGet('/api/metrics/by-dealer')
        const byType = await apiGet('/api/metrics/by-type')
        setDealers(byDealer.by_dealer.map((d: any) => d.dealer_id).sort())
        setEventTypes(byType.by_type.map((t: any) => t.event_type))
      } catch {
        // the page itself shows the error, the dropdowns just stay empty
      }
    }
    loadOptions()
  }, [refresh])

  const filtersOn = Object.values(filters).some(Boolean)       // is any filter set?

  const apply = (newFilters: FilterValues) => setFilters(newFilters)   // the effect above turns the spinner on
  const importDone = () => setRefresh(refresh + 1)

  return (
    <div className="container py-4">
      <h1 className="h3 mb-4">
        Event Analytics
        {loading && metrics && <span className="spinner-border spinner-border-sm ms-2 align-middle" role="status" />}
      </h1>

      <ImportButton onDone={importDone} />
      <Filters filters={filters} dealers={dealers} eventTypes={eventTypes} onApply={apply} />

      {loading && !metrics && <div className="spinner-border" role="status" />}{/* first load: big spinner */}
      {error && <div className="alert alert-danger">Could not load the data: {error}</div>}
      {metrics && metrics.late.total === 0 && (
        <div className="alert alert-info">
          {filtersOn
            ? 'No events match these filters. Try a wider date range, or press Reset.'
            : 'No events yet. Click "Import events file" to load them.'}
        </div>
      )}
      {metrics && metrics.late.total > 0 && (
        <div style={{ opacity: loading ? 0.5 : 1 }}>{/* old numbers stay, dimmed, until the new ones arrive */}
          <SummaryCards late={metrics.late} dealers={metrics.byDealer.by_dealer.length} />
          <DailyChart daily={metrics.daily.daily} />
          <div className="row g-3 mb-4">
            <div className="col-lg-6"><TypeBars byType={metrics.byType.by_type} total={metrics.byType.total} /></div>
            <div className="col-lg-6"><DealerTable byDealer={metrics.byDealer.by_dealer} /></div>
          </div>
          <EventsTable key={JSON.stringify(filters)} filters={filters} refresh={refresh} />
        </div>
      )}

      <QualityPanel refresh={refresh} />
    </div>
  )
}

export default App
