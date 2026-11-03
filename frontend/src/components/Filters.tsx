import { useState } from 'react'
import { emptyFilters, type Filters as FilterValues } from '../api/client'

type Props = {
    filters: FilterValues
    dealers: string[]
    eventTypes: string[]
    onApply: (filters: FilterValues) => void
}

const Filters = ({ filters, dealers, eventTypes, onApply }: Props) => {
    const [draft, setDraft] = useState(filters)   // what is typed in the form, sent only when Apply is clicked

    const change = (name: string, value: string) => setDraft({ ...draft, [name]: value })

    const reset = () => {
        setDraft(emptyFilters)
        onApply(emptyFilters)
    }

    return (
        <form
            className="row g-2 mb-4"
            onSubmit={(e) => {
                e.preventDefault()
                onApply(draft)
            }}
        >
            <div className="col-6 col-md-3">
                <select className="form-select" value={draft.dealer_id} onChange={(e) => change('dealer_id', e.target.value)}>
                    <option value="">All dealers</option>
                    {dealers.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
            </div>
            <div className="col-6 col-md-3">
                <select className="form-select" value={draft.event_type} onChange={(e) => change('event_type', e.target.value)}>
                    <option value="">All event types</option>
                    {eventTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
            </div>
            <div className="col-6 col-md-2">
                <input type="date" className="form-control" value={draft.from} onChange={(e) => change('from', e.target.value)} title="From (UTC event date)" />
            </div>
            <div className="col-6 col-md-2">
                <input type="date" className="form-control" value={draft.to} onChange={(e) => change('to', e.target.value)} title="To (UTC event date)" />
            </div>
            <div className="col-12 col-md-2 d-flex gap-2">
                <button type="submit" className="btn btn-primary">Apply</button>
                <button type="button" className="btn btn-outline-secondary" onClick={reset}>Reset</button>
            </div>
        </form>
    )
}

export default Filters
