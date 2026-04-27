// Create GitHub Release
const fs = require('fs');
const https = require('https');

const version = process.argv[2] || '1.0.0';
const tagName = 'v' + version;
const repo = 'RudzisID/simoto-sklad';

// Read token
const envContent = fs.readFileSync('.env', 'utf8') || '';
const tokenMatch = envContent.match(/GH_TOKEN=(.+)/);
if (!tokenMatch) {
    console.log('Error: No GH_TOKEN in .env');
    process.exit(1);
}
const token = tokenMatch[1];

console.log('Creating release for:', tagName);

// Get existing releases to find and delete old draft if exists
const getReq = https.request({
    hostname: 'api.github.com',
    path: '/repos/' + repo + '/releases',
    method: 'GET',
    headers: {
        'Authorization': 'token ' + token,
        'User-Agent': 'SiMOTO'
    }
}, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const releases = JSON.parse(data);
            
            // Check if release already exists
            const existing = releases.find(r => r.tag_name === tagName);
            
            if (existing) {
                console.log('Release exists, updating to latest...');
                // Update existing release to make it latest
                const patchData = JSON.stringify({
                    draft: false,
                    prerelease: false
                });
                
                const patchReq = https.request({
                    hostname: 'api.github.com',
                    path: '/repos/' + repo + '/releases/' + existing.id,
                    method: 'PATCH',
                    headers: {
                        'Authorization': 'token ' + token,
                        'Content-Type': 'application/json',
                        'User-Agent': 'SiMOTO'
                    }
                }, (res2) => {
                    let data2 = '';
                    res2.on('data', (c) => { data2 += c; });
                    res2.on('end', () => {
                        console.log('Status:', res2.statusCode);
                        if (res2.statusCode === 200) {
                            console.log('OK! ' + tagName + ' is now latest');
                        }
                    });
                });
                patchReq.on('error', e => console.log('Patch error:', e.message));
                patchReq.write(patchData);
                patchReq.end();
                return;
            }
            
            // Create new release
            const postData = JSON.stringify({
                tag_name: tagName,
                name: 'SiMOTO-Sklad ' + tagName,
                draft: false,
                prerelease: false
            });
            
            const postReq = https.request({
                hostname: 'api.github.com',
                path: '/repos/' + repo + '/releases',
                method: 'POST',
                headers: {
                    'Authorization': 'token ' + token,
                    'Content-Type': 'application/json',
                    'User-Agent': 'SiMOTO'
                }
            }, (res2) => {
                let data2 = '';
                res2.on('data', (c) => { data2 += c; });
                res2.on('end', () => {
                    console.log('Status:', res2.statusCode, data2.substring(0, 100));
                    if (res2.statusCode === 201) {
                        console.log('OK! Created ' + tagName);
                    }
                });
            });
            postReq.on('error', e => console.log('Post error:', e.message));
            postReq.write(postData);
            postReq.end();
            
        } catch (e) {
            console.log('Parse error:', e.message);
        }
    });
});
});

getReq.on('error', e => console.log('Get error:', e.message));
getReq.end();