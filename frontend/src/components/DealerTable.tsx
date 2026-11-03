const DealerTable = ({ byDealer }: { byDealer: { dealer_id: string; count: number }[] }) => (
    <div className="card h-100">
        <div className="card-body">
            <h2 className="h6">Events by dealer</h2>
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                <table className="table table-sm mb-0">
                    <thead>
                        <tr><th>Dealer</th><th className="text-end">Events</th></tr>
                    </thead>
                    <tbody>
                        {byDealer.map((d) => (
                            <tr key={d.dealer_id}>
                                <td>{d.dealer_id}</td>
                                <td className="text-end">{d.count.toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
)

export default DealerTable
