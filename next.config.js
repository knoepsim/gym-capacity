const gyms = require('./config/gyms.json')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Ask Chromium to send the device model with later requests (only honoured on HTTPS)
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'Accept-CH', value: 'Sec-CH-UA-Model' }] }]
  },
  // Keep bookmarks of renamed gyms working.
  async redirects() {
    return gyms.flatMap((gym) =>
      (gym.previousIds ?? []).map((previousId) => ({
        source: `/${previousId}`,
        destination: `/${gym.id}`,
        permanent: true,
      }))
    )
  },
}

module.exports = nextConfig
