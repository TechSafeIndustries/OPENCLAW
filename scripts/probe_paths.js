const fs = require('fs');
const path = require('path');

const paths = [
    "G:\\Shared drives\\1. Corporate\\TSi — Corporate\\01. Corporate Governance\\TSI Operating System\\TSI-OS 07 - OS Change Log (Master)\\9. SECURITY & ACCESS CONTROL (OS-07-F)\\SECURITY & ACCESS CONTROL (OS-07-F).gdoc",
    "G:\\Shared drives\\1. Corporate\\TSi — Corporate\\01. Corporate Governance\\TSI Operating System\\TSI-OS 05 - Foundational Strategy Stack\\TSI-OS 05-06 — SAI-COM (SaaS Framework) Architecture (v1.0 MASTER)\\Folder 8 — SECURITY & AUTHENTICATION\\8.4 Device Authentication Keys\\TSI — DEVICE AUTHENTICATION KEYS.gdoc"
];

paths.forEach(p => {
    console.log(`\nPath: ${p}`);
    console.log(`Length: ${p.length}`);
    const exists = fs.existsSync(p);
    console.log(`fs.existsSync: ${exists}`);

    // Try with long path prefix
    const longP = "\\\\?\\" + p;
    const existsLong = fs.existsSync(longP);
    console.log(`fs.existsSync (\\\\?\\): ${existsLong}`);

    // Break down path to see where it fails
    let current = "G:\\";
    const parts = p.replace("G:\\", "").split("\\");
    console.log("Traversal:");
    for (const part of parts) {
        current = path.join(current, part);
        const ex = fs.existsSync(current);
        const longEx = fs.existsSync("\\\\?\\" + current);
        console.log(`  ${ex ? "OK" : "MISSING"} (long=${longEx ? "OK" : "MISSING"}) ${current}`);
        if (!ex && !longEx) break;
    }
});
