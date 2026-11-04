const gyms = require('./config/gyms.json')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
