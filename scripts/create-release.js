const fs = require('fs');
const https = require('https');

const version = process.argv[2];
const tag = 'v' + version;
const token = fs.readFileSync('.env', 'utf8').match(/GH_TOKEN=(.+)/)[1];

console.log('Release:', tag);

const data = JSON.stringify({tag_name: tag, name: 'SiMOTO ' + tag, draft: false});
const req = https.request({
    hostname: 'api.github.com',
    path: '/repos/RudzisID/simoto-sklad/releases',
    method: 'POST',
    headers: {'Authorization': 'token '+token, 'Content-Type': 'application/json', 'User-Agent': 'SiMOTO'}
}, res => { 
    let d = ''; 
    res.on('data', c => d += c); 
    res.on('end', () => {
        console.log('Status:', res.statusCode);
        if (res.statusCode === 201) {
            console.log('OK! ' + tag + ' created');
        }
    });
});
req.on('error', e => console.log('Error:', e.message));
req.write(data);
req.end();