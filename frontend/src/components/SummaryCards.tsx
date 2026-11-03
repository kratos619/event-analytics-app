type Props = {
    late: { total: number; late: number; late_after_hours: number; avg_delay_minutes: number }
    dealers: number
}

const Card = ({ title, value, note }: { title: string; value: string | number; note: string }) => (
    <div className="col-6 col-lg-3">
        <div className="card h-100">
            <div className="card-body">
                <div className="text-muted small">{title}</div>
                <div className="fs-3 fw-semibold">{value}</div>
                <div className="text-muted small">{note}</div>
            </div>
        </div>
    </div>
)

const SummaryCards = ({ late, dealers }: Props) => {
    const share = late.total ? ((late.late / late.total) * 100).toFixed(1) : '0'
    return (
        <div className="row g-3 mb-4">
            <Card title="Accepted events" value={late.total.toLocaleString()} note="valid, unique events" />
            <Card title="Late arrivals" value={late.late.toLocaleString()} note={`${share}% of events, received over ${late.late_after_hours}h after they happened`} />
            <Card title="Average delay" value={`${late.avg_delay_minutes} min`} note="received time minus event time" />
            <Card title="Dealers" value={dealers} note="with at least one event" />
        </div>
    )
}

export default SummaryCards
