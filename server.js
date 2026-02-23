const express = require('express');
const { BigQuery } = require('@google-cloud/bigquery');
const app = express();
const port = 8080;

const bq = new BigQuery({
  projectId: 'inspiring-bonus-487303-b0',
  keyFilename: '/app/openclaw-auth.json'
});

app.get('/', async (req, res) => {
  try {
    const query = 'SELECT task_id, timestamp FROM `inspiring-bonus-487303-b0.openclaw_logs.task_history` WHERE action = "scaling_test" ORDER BY timestamp DESC LIMIT 10';
    const [rows] = await bq.query({ query });
    
    let tableRows = rows.map(r => `<tr><td>${r.task_id}</td><td>${r.timestamp.value}</td></tr>`).join('');
    
    res.send(`
      <style>body { font-family: sans-serif; background: #121212; color: #00ff00; padding: 20px; }</style>
      <h1>Antigravity Dashboard: LIVE</h1>
      <table border="1" cellpadding="10" style="border-collapse: collapse; width: 100%;">
        <thead><tr><th>Task ID</th><th>Timestamp</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      <p>Total Sync Records: ${rows.length}</p>
    `);
  } catch (err) {
    res.status(500).send('Bridge Error: ' + err.message);
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log('Live Telemetry Bridge listening on port 8080');
});
