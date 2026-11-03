import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const DailyChart = ({ daily }: { daily: { day: string; count: number }[] }) => (
    <div className="card mb-4">
        <div className="card-body">
            <h2 className="h6">Events per day (UTC event date)</h2>
            <ResponsiveContainer width="100%" height={260}>
                <LineChart data={daily}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#0d6efd" dot={false} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    </div>
)

export default DailyChart
