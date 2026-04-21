'use client'

import Link from 'next/link'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

interface GymCardProps {
  id: string
  name: string
  currentCount: number
  maxCount: number
  lastUpdate: Date
  trendData: { hour: number; avg_count: number }[]
}

export function GymCard({ id, name, currentCount, maxCount, lastUpdate, trendData }: GymCardProps) {
  const percentage = maxCount > 0 ? Math.round((currentCount / maxCount) * 100) : 0
  const available = Math.max(0, maxCount - currentCount)

  // Berechne Minuten seit letztem Update
  const now = new Date()
  const minutesAgo = Math.floor((now.getTime() - new Date(lastUpdate).getTime()) / 60000)

  // Trenddaten
  const currentHour = now.getHours()
  const nextTwoHours = trendData.filter(d => d.hour === currentHour || d.hour === currentHour + 1)
  const hasTrendData = nextTwoHours.length > 0
  const avgTrendCount = hasTrendData
    ? Math.round(nextTwoHours.reduce((sum, d) => sum + d.avg_count, 0) / nextTwoHours.length)
    : currentCount
  const trendDirection = avgTrendCount > currentCount ? '📈' : avgTrendCount < currentCount ? '📉' : '➡️'
  const trendChange = Math.abs(avgTrendCount - currentCount)

  const getStatusColor = (percent: number) => {
    if (percent >= 80) return 'from-red-500 to-red-600'
    if (percent >= 50) return 'from-amber-500 to-amber-600'
    return 'from-green-500 to-green-600'
  }

  const getStatusText = (percent: number) => {
    if (percent >= 80) return 'Sehr voll'
    if (percent >= 50) return 'Moderat'
    return 'Leer'
  }

  return (
    <Link href={`/${id}`}>
      <div className="bg-white rounded-xl shadow-lg overflow-hidden hover:shadow-xl transition-shadow cursor-pointer h-full flex flex-col">
        {/* Status Bar */}
        <div className={`h-2 bg-gradient-to-r ${getStatusColor(percentage)}`} />

        {/* Content */}
        <div className="p-6 flex-1 flex flex-col">
          {/* Header */}
          <h3 className="text-xl font-bold text-gray-800 mb-4">{name}</h3>

          {/* Current Status */}
          <div className="mb-6 flex-1">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-4xl font-bold text-gray-900">{currentCount}</span>
              <span className="text-gray-500">/ {maxCount}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r ${getStatusColor(percentage)} transition-all`}
                style={{ width: `${percentage}%` }}
              />
            </div>
            <div className="flex justify-between items-center mt-2">
              <span className="text-sm font-semibold text-gray-600">{percentage}% - {getStatusText(percentage)}</span>
              <span className="text-xs text-gray-500">{available} verfügbar</span>
            </div>
          </div>

          {/* Trend - nur wenn Daten vorhanden */}
          {hasTrendData ? (
            <div className="bg-gray-50 p-4 rounded-lg mb-4">
              <p className="text-xs text-gray-600 mb-2 font-semibold">TREND NÄCHSTE 2h</p>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-2xl font-bold text-gray-800">{trendDirection}</p>
                  <p className="text-sm text-gray-600 mt-1">
                    {trendChange > 0 ? '+' : ''}{trendChange} Personen
                  </p>
                </div>
                <ResponsiveContainer width={120} height={40}>
                  <BarChart data={nextTwoHours}>
                    <Bar dataKey="avg_count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : null}

          {/* Timestamp */}
          <p className="text-xs text-gray-500 text-center">
            Aktualisiert vor {minutesAgo} {minutesAgo === 1 ? 'Min' : 'Min'}
          </p>

          {/* Click to Details */}
          <p className="text-xs text-gray-400 mt-3 text-center">Details →</p>
        </div>
      </div>
    </Link>
  )
}
