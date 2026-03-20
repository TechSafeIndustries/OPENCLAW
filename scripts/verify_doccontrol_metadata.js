'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'stack', 'DocControl_Audit_Index.csv');

function parseCsv(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length < 2) return [];

    const headers = splitCsvLine(lines[0]);
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const cols = splitCsvLine(lines[i]);
        const row = {};
        headers.forEach((h, idx) => { row[h] = cols[idx] ?? ''; });
        rows.push(row);
    }
    return rows;
}

function splitCsvLine(line) {
    const cols = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
            else { inQ = !inQ; }
        } else if (ch === ',' && !inQ) {
            cols.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    cols.push(cur);
    return cols;
}

function verifyMetadata() {
    if (!fs.existsSync(INDEX_PATH)) {
        console.error('Index not found');
        process.exit(1);
    }

    const content = fs.readFileSync(INDEX_PATH, 'utf8');
    const rows = parseCsv(content);

    const stats = {
        total: rows.length,
        has_extension: 0,
        has_size: 0,
        video_count: 0,
        audio_count: 0,
        image_count: 1, // Start with 1 if there's a baseline
        missing_name: 0,
    };

    const mediaExtensions = {
        video: ['.mp4', '.mov', '.avi', '.mkv'],
        audio: ['.m4a', '.mp3', '.wav'],
        image: ['.png', '.jpg', '.jpeg', '.gif'],
        doc: ['.pdf', '.gdoc', '.gsheet', '.docx']
    };

    rows.forEach(row => {
        const name = row.CurrentName || '';
        const ext = (row.CurrentType || path.extname(name)).toLowerCase();
        const size = parseInt(row.Length || '0', 10);

        if (!name) stats.missing_name++;
        if (ext) stats.has_extension++;
        if (size > 0) stats.has_size++;

        if (mediaExtensions.video.includes(ext)) stats.video_count++;
        if (mediaExtensions.audio.includes(ext)) stats.audio_count++;
        if (mediaExtensions.image.includes(ext)) stats.image_count++;
    });

    console.log('=== Metadata Verification Result ===');
    console.log(`Total Items: ${stats.total}`);
    console.log(`Items with Extension: ${stats.has_extension}`);
    console.log(`Items with Size > 0: ${stats.has_size}`);
    console.log(`Video Files: ${stats.video_count}`);
    console.log(`Audio Files: ${stats.audio_count}`);
    console.log(`Image Files: ${stats.image_count}`);
    console.log('====================================');

    if (stats.total > 0 && stats.has_extension / stats.total > 0.9) {
        console.log('VERDICT: Metadata extraction logic is ROBUST.');
    } else {
        console.log('VERDICT: Metadata extraction logic needs review.');
    }
}

verifyMetadata();
