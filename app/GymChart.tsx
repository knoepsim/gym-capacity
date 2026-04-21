'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts'

interface ChartDataPoint {
  weekday: number
  hour: number
  avg_count: number
  max_capacity: number
}

const WEEKDAY_NAMES = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
]

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6']

interface GymChartProps {
  data: ChartDataPoint[]
  gymName: string
}

export function GymChart({ data, gymName }: GymChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="glass p-8 rounded-2xl text-center">
        <p className="text-gray-500 text-lg">
          Noch keine Daten vorhanden. Der Fetcher wird diese in Kürze abrufen.
        </p>
      </div>
    )
  }

  // Gruppiere Daten nach Wochentag
  const weekdayData: Record<number, ChartDataPoint[]> = {}
  data.forEach((item) => {
    if (!weekdayData[item.weekday]) {
      weekdayData[item.weekday] = []
    }
    weekdayData[item.weekday].push(item)
  })

  // Sortiere Stunden für die X-Achse
  Object.entries(weekdayData).forEach(([, dayArray]) => {
    dayArray.sort((a, b) => a.hour - b.hour)
  })

  return (
    <div className="space-y-8">
      {Object.entries(weekdayData).map(([weekday, dayData]: [string, any]) => {
        const weekdayIndex = parseInt(weekday)
        const weekdayName = WEEKDAY_NAMES[weekdayIndex]

        return (
          <div key={weekday} className="glass p-8 rounded-2xl">
            <h3 className="text-xl font-bold text-gray-800 mb-4">
              {weekdayName}
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={dayData}
                margin={{ top: 20, right: 30, left: 0, bottom: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="hour"
                  tickFormatter={(tick) => `${String(tick).padStart(2, '0')}:00`}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis label={{ value: 'Personen', angle: -90, position: 'insideLeft' }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #ccc',
                    borderRadius: '8px',
                  }}
                  formatter={(value) => [Math.round(Number(value)), 'Durchschnitt']}
                  labelFormatter={(label) => `${String(label).padStart(2, '0')}:00 Uhr`}
                />
                <Bar dataKey="avg_count" fill="#3b82f6" radius={[8, 8, 0, 0]}>
                  {dayData.map((entry: ChartDataPoint, index: number) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={
                        entry.avg_count / entry.max_capacity > 0.8
                          ? '#ef4444'
                          : entry.avg_count / entry.max_capacity > 0.5
                            ? '#f59e0b'
                            : '#10b981'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 flex gap-6 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded"></div>
                <span>0-50% Auslastung</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-amber-500 rounded"></div>
                <span>50-80% Auslastung</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-500 rounded"></div>
                <span>&gt;80% Auslastung</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
