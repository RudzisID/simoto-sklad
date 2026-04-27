// Simple update checker for SiMOTO-sklad
const https = require('https');
const currentVersion = process.argv[2] || '0.0.0';

const options = {
    hostname: 'api.github.com',
    path: '/repos/RudzisID/simoto-sklad/releases/latest',
    headers: {'User-Agent': 'SiMOTO'}
};

https.get(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const release = JSON.parse(data);
            const latestVersion = release.tag_name ? release.tag_name.replace('v', '') : '0.0.0';
            console.log('Latest: ' + release.tag_name);
            if (currentVersion !== latestVersion) {
                console.log('New version available!');
            } else {
                console.log('You have latest version');
            }
        } catch (e) {
            console.log('Error checking updates');
        }
    });
}).on('error', () => {
    console.log('No network connection');
});