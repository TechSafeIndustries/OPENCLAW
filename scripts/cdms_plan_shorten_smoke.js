'use strict';

/**
 * OpenClaw — CDMS Plan Shorten Smoke Test
 * ---------------------------------------
 * Validates that the planner automatically shortens paths exceeding 240 chars.
 */

const fs = require('fs');
const path = require('path');
const { run } = require('../agents/cdms_agent_v1.js');

const ROOT = path.resolve(__dirname, '..');
const STACK_DIR = path.join(ROOT, 'stack');
const MAP_PATH = path.join(STACK_DIR, 'DocControl_Audit_MoveMap.csv');
const BATCH_DIR = path.join(STACK_DIR, 'cdms_batches');

function main() {
    console.log('=== CDMS Plan Shorten Smoke Test ===');

    // Ensure stack dir exists
    if (!fs.existsSync(STACK_DIR)) fs.mkdirSync(STACK_DIR, { recursive: true });

    // 1. Create a dummy MoveMap with an intentionally long path
    // Target length > 240
    // "G:\Shared drives\" is 17 chars
    const pTSI = "A".repeat(150);
    const pName = "B".repeat(100) + ".gdoc";
    // Total approx: 17 + 150 + 101 = 268 chars

    const headers = "BatchId,SourceDrive,CurrentPath,CurrentName,CurrentType,ProposedTSI01Path,ProposedName,RenameReason,Confidence";
    const row = `test_batch,1. Corporate,C:\\Source,ZERO TRUST POLICY.gdoc,file,${pTSI},${pName},Initial Plan,High`;

    fs.writeFileSync(MAP_PATH, headers + "\n" + row + "\n", "utf8");
    console.log("Created dummy MoveMap with a long path candidate.");

    // 2. Run the planner
    console.log("Running planner (wave=high)...");
    const result = run({ action: 'plan', wave: 'high' });

    if (!result.ok) {
        console.error("FAIL: Planner execution failed: " + result.summary);
        process.exit(1);
    }

    const batchFile = result.artifacts[0].path;
    console.log(`Planner produced batch: ${batchFile}`);

    // 3. Verify the output
    const content = fs.readFileSync(batchFile, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const dataRow = lines[1]; // headers is lines[0]

    console.log("\nOutput CSV Data Row:");
    console.log(dataRow);

    const isShortened = dataRow.includes("TSI-01 DocControl.GOOGLE\\INCOMING\\");
    const hasShortCode = dataRow.includes("TSI-ZT-RS_");
    const hasReason = dataRow.includes("AUTO_SHORT_PATHLEN");

    if (isShortened && hasShortCode && hasReason) {
        console.log("\nASSERT PASS: Row was correctly rerouted to INCOMING and shortened.");
    } else {
        console.error("\nASSERT FAIL: Requirements not met in output CSV.");
        if (!isShortened) console.error(" - Missing INCOMING reroute");
        if (!hasShortCode) console.error(" - Missing TSI-ZT-RS shortcode");
        if (!hasReason) console.error(" - Missing AUTO_SHORT_PATHLEN reason");
        process.exit(1);
    }

    // 4. Verify length < 240
    const cols = dataRow.split(',');
    // ProposedTSI01Path is index 5, ProposedName is index 6
    const finalPTSI = cols[5].replace(/^"|"$/g, '');
    const finalPName = cols[6].replace(/^"|"$/g, '');
    const driveBase = "G:\\Shared drives\\";
    const trim = (s) => String(s || "").replace(/^[\\\/]+/, "").replace(/[\\\/]+$/, "");
    const finalDstAbs = driveBase + trim(finalPTSI) + "\\" + trim(finalPName);

    console.log(`Final calculated path: ${finalDstAbs}`);
    console.log(`Final length: ${finalDstAbs.length}`);

    if (finalDstAbs.length <= 240) {
        console.log("ASSERT PASS: Final length is within the 240 limit.");
    } else {
        console.error(`ASSERT FAIL: Final length ${finalDstAbs.length} exceeds 240!`);
        process.exit(1);
    }

    // Cleanup
    fs.unlinkSync(MAP_PATH);
    // Note: we leave the MoveBatch in BATCH_DIR but we can delete it if we want
    // fs.unlinkSync(batchFile);

    console.log("\n=== SMOKE TEST COMPLETE ===");
}

main();
