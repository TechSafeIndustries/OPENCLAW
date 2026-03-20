const fs = require('fs');
const path = require('path');

const corporateRoot = 'G:\\Shared drives\\1. Corporate';
const searchNames = [
    'SECURITY & ACCESS CONTROL',
    'ACP v3 Security Policy',
    'Security and Continuity Rules'
];

function findFiles(dir) {
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                findFiles(fullPath);
            } else {
                for (const name of searchNames) {
                    if (entry.name.toUpperCase().includes(name.toUpperCase())) {
                        console.log(`FOUND: ${fullPath}`);
                    }
                }
            }
        }
    } catch (err) {
        // skip
    }
}

console.log(`Searching in ${corporateRoot}...`);
findFiles(corporateRoot);
console.log('Done.');
