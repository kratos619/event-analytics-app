type Props = { byType: { event_type: string; count: number }[]; total: number }

const TypeBars = ({ byType, total }: Props) => (
    <div className="card h-100">
        <div className="card-body">
            <h2 className="h6">Events by type</h2>
            {byType.map((t) => (
                <div key={t.event_type} className="mb-2">
                    <div className="d-flex justify-content-between small">
                        <span>{t.event_type}</span>
                        <span>{t.count.toLocaleString()}</span>
                    </div>
                    <div className="progress">
                        <div className="progress-bar" style={{ width: `${(t.count / total) * 100}%` }} />
                    </div>
                </div>
            ))}
        </div>
    </div>
)

export default TypeBars
