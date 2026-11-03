import { useEffect, useState } from 'react'
import { apiGet, filterQuery, type Filters } from '../api/client'

const LIMIT = 10
const time = (iso: string) => iso.replace('T', ' ').slice(0, 19)   // 2026-09-01 00:04:23

const EventsTable = ({ filters, refresh }: { filters: Filters; refresh: number }) => {
    const [data, setData] = useState<any>(null)
    const [page, setPage] = useState(1)
    const [error, setError] = useState('')

    useEffect(() => {
        async function loadEvents() {
            try {
                setData(await apiGet(`/api/events${filterQuery(filters)}&page=${page}&limit=${LIMIT}`))
                setError('')
            } catch (e: any) {
                setError(e.message)
            }
        }
        loadEvents()
    }, [filters, page, refresh])

    if (error) return <div className="alert alert-danger">Could not load the events: {error}</div>
    if (!data) return <div className="spinner-border" role="status" />

    const pages = Math.max(1, Math.ceil(data.total / LIMIT))

    return (
        <div className="card mb-4">
            <div className="card-body">
                <h2 className="h6">Events ({data.total.toLocaleString()}, newest first)</h2>
                <div className="table-responsive">
                    <table className="table table-sm mb-2">
                        <thead>
                            <tr><th>Event time (UTC)</th><th>Received (UTC)</th><th>Type</th><th>Dealer</th><th>Customer</th><th>Event id</th></tr>
                        </thead>
                        <tbody>
                            {data.events.map((e: any) => (
                                <tr key={e.event_id}>
                                    <td>{time(e.event_timestamp)}</td>
                                    <td>{time(e.received_at)}</td>
                                    <td>{e.event_type}</td>
                                    <td>{e.dealer_id}</td>
                                    <td>{e.customer_id}</td>
                                    <td className="text-muted small">{e.event_id}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="d-flex align-items-center gap-3">
                    <button className="btn btn-sm btn-outline-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                    <span className="small">Page {page} of {pages}</span>
                    <button className="btn btn-sm btn-outline-secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
                </div>
            </div>
        </div>
    )
}

export default EventsTable
