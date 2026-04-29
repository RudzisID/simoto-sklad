// Simple update checker for SiMOTO-sklad
const https = require('https')
const currentVersion = process.argv[2] || '0.0.0'

const options = {
  hostname: 'api.github.com',
  path: '/repos/RudzisID/simoto-sklad/releases/latest',
  headers: {'User-Agent': 'SiMOTO'}
}

https.get(options, (res) => {
  // Check for HTTP errors (404, 403, etc.)
  if (res.statusCode !== 200) {
    console.log('Update check failed: HTTP ' + res.statusCode)
    return
  }

  let data = ''
  res.on('data', (chunk) => { data += chunk })
  res.on('end', () => {
    try {
      const release = JSON.parse(data)
      if (!release.tag_name) {
        console.log('Update check failed: invalid response')
        return
      }
      const latestVersion = release.tag_name.replace('v', '')
      console.log('Latest: ' + release.tag_name)
      if (currentVersion !== latestVersion) {
        console.log('New version available!')
      } else {
        console.log('You have latest version')
      }
    } catch (e) {
      console.log('Error checking updates: ' + e.message)
    }
  })
}).on('error', (err) => {
  console.log('No network connection: ' + err.message)
})