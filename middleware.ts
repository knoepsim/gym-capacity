import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthorization } from '@/lib/adminAuth'

// Browser login prompt (HTTP Basic Auth) in front of the admin area and the data exports.
export function middleware(request: NextRequest) {
  if (isAdminAuthorization(request.headers.get('authorization'))) {
    return NextResponse.next()
  }

  return new NextResponse('Anmeldung erforderlich', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Gym Admin", charset="UTF-8"', 'Cache-Control': 'no-store' },
  })
}

export const config = {
  matcher: ['/admin', '/admin/:path*', '/api/export/:path*'],
}
