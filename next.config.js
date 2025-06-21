/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'streavoice.s3.us-east-2.amazonaws.com',
        pathname: '/**',
      },
    ],
  },
}

module.exports = nextConfig 