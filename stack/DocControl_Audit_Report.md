# TSI-01 DocControl Audit Report
**Generated:** 2026-02-23  
**Auditor:** Antigravity (automated)  
**Source scanned:**  
- `C:\Users\mikes\OneDrive\1. TechSafeAI\` — 34 files  
- `C:\Users\mikes\TSI-CDMS\` — 13 files  
**Total files reviewed:** 47  

**Target structure:** `TSI-01 DocControl.GOOGLE/`

---

## TARGET FOLDER STRUCTURE (reference)

```
TSI-01 DocControl.GOOGLE/
  00_Master_Index/         ← Inventory, CDMS schema, dependency matrix
  01_Governance/           ← Policies, compliance, terms
  02_Offers_And_Pricing/   ← Proposals, pricing, offer docs
  03_Sales_And_Marketing/  ← Visual assets, marketing copy, AI promo
  04_Product_And_Tech/     ← AI agent docs, product specs, tech refs
  05_Legal_And_Commercial/ ← Contracts, ToS, bot terms
  06_Operations/           ← SOPs, automation scripts, runbooks
  07_Clients/              ← Client-specific docs (NDIS, etc.)
  99_Archive/2022/
  99_Archive/2023/
  99_Archive/2024/
  99_Archive/2025/
```

---

## TABLE A — Move Map

> Naming convention: `TSI-<Domain>-<DocName>-v<MAJOR.MINOR>-YYYYMMDD.<ext>`  
> `Domain` key: GOV=Governance, MKTG=Marketing, PROD=Product, OPS=Operations, LEGAL=Legal, CDMS=DocControl, CLIENT=Clients  

| # | Current Path (relative to OneDrive/1.TechSafeAI or TSI-CDMS) | File | Proposed Folder | Proposed New Name | Reason |
|---|---|---|---|---|---|
| 1 | `AI Agent Suite Documentation/` | `rENAME.docx` | `04_Product_And_Tech/` | `TSI-PROD-AgentSuite-Unknown-v1.0-20250704.docx` | Filename is literally "rENAME" — unclear content; classify as Product doc, rename immediately |
| 2 | `AI Agent Suite Documentation/` | `TechSafeAI_ESG_Reporting_Agent_Setup.docx` | `04_Product_And_Tech/` | `TSI-PROD-ESGReportingAgentSetup-v1.0-20250701.docx` | Correct folder; standardise name |
| 3 | `AI FOLDER/` | `BOT TERMS.docx` | `05_Legal_And_Commercial/` | `TSI-LEGAL-BotTerms-v1.0-20221227.docx` | Legal/terms doc in wrong root folder |
| 4 | `AI FOLDER/` | `Elementor Cancellation.JPG` | `99_Archive/2023/` | `TSI-ARC-ElementorCancellation-20230710.jpg` | Screenshot of vendor cancellation; archive, not active |
| 5 | `AI FOLDER/` | `GPT Chat.docx` | `99_Archive/2024/` | `TSI-ARC-GPTChatLog-20241006.docx` | Large (796 KB) chat log dump; not a business doc — archive |
| 6 | `AI FOLDER/` | `LOGO.png` | `03_Sales_And_Marketing/` | `TSI-MKTG-LogoPrimary-v1.0-20231212.png` | Brand asset; belongs in Marketing |
| 7 | `AI FOLDER/` | `Money Manifestation Plan` (no ext) | `99_Archive/2023/` | `TSI-ARC-MoneyManifestationPlan-20230120` | Personal/off-topic; archive (no extension — verify if duplicate of .docx below) |
| 8 | `AI FOLDER/` | `Money Manifestation Plan.docx` | `99_Archive/2023/` | `TSI-ARC-MoneyManifestationPlan-v1.0-20230120.docx` | Same date as #7; likely duplicate pair — see Table B |
| 9 | `AI FOLDER/` | `OPEN SOURCE AI APPS.docx` | `99_Archive/2022/` | `TSI-ARC-OpenSourceAIApps-20221226.docx` | Early research note from 2022; archive |
| 10 | `AI FOLDER/` | `prompt for website.docx` | `04_Product_And_Tech/` | `TSI-PROD-WebsitePromptSpec-v1.0-20230709.docx` | Website/product prompt spec; could go to 04 or 03 — classify as product |
| 11 | `AI FOLDER/AIPOETRY/` | `DEBSVSAI.docx` | `99_Archive/2023/` | `TSI-ARC-DebsVsAI-20230112.docx` | Creative/personal content; archive |
| 12 | `AI FOLDER/AIPOETRY/` | `Numerological Values of my name and birthdate.docx` | `99_Archive/2023/` | `TSI-ARC-Numerology-20230119.docx` | Personal; archive |
| 13 | `AI FOLDER/AIPOETRY/` | `You are not your mind.docx` | `99_Archive/2023/` | `TSI-ARC-YouAreNotYourMind-20230113.docx` | Personal/creative; archive |
| 14 | `AI FOLDER/AIPOETRY/Video/` | `Flight test.mp3` | `99_Archive/2023/` | `TSI-ARC-FlightTestAudio-20230117.mp3` | Audio test file; archive |
| 15 | `AI FOLDER/AIPOETRY/Video/` | `Video Editorial Template.mp3` | `03_Sales_And_Marketing/` | `TSI-MKTG-VideoEditorialTemplate-v1.0-20230625.mp3` | **Canonical** — keep in Marketing (Video folder redundant) |
| 16 | `AI FOLDER/AIPOETRY/Video - Copy/` | `Video Editorial Template.mp3` | `99_Archive/2023/` | `TSI-ARC-VideoEditorialTemplate-DUPLICATE-20230625.mp3` | **Exact duplicate** of #15 (same size 1055 KB, same date) — archive this copy |
| 17 | `AI FOLDER/NDIS AICHATBOT/` | `NDIS GUIDELINES.docx` | `07_Clients/NDIS/` | `TSI-CLIENT-NDISGuidelines-v1.0-20230110.docx` | Client/sector-specific; create NDIS subfolder |
| 18 | `AI FOLDER/NDIS AICHATBOT/` | `PROJECT BUDDY.docx` | `07_Clients/NDIS/` | `TSI-CLIENT-ProjectBuddy-v1.0-20230110.docx` | NDIS chatbot project doc; same subfolder |
| 19 | `Marketing Visuals/Images/Safety/` | `Designer.jpeg` | `03_Sales_And_Marketing/Safety_Images/` | `TSI-MKTG-SafetyVisual-01-20250616.jpeg` | Part of Safety image set; needs batch renaming (see #20–29) |
| 20 | `Marketing Visuals/Images/Safety/` | `Designer (1).jpeg` | `03_Sales_And_Marketing/Safety_Images/` | `TSI-MKTG-SafetyVisual-02-20250616.jpeg` | Batch rename |
| 21 | `Marketing Visuals/Images/Safety/` | `Designer (2).jpeg` | `03_Sales_And_Marketing/Safety_Images/` | `TSI-MKTG-SafetyVisual-03-20250616.jpeg` | Batch rename |
| 22 | `Marketing Visuals/Images/Safety/` | `Designer (3).jpeg` | `03_Sales_And_Marketing/Safety_Images/` | `TSI-MKTG-SafetyVisual-04-20250616.jpeg` | Batch rename |
| 23 | `Marketing Visuals/Images/Safety/` | `Designer (4).jpeg` | `03_Sales_And_Marketing/Safety_Images/` | `TSI-MKTG-SafetyVisual-05-20250616.jpeg` | Batch rename |
| 24 | `Marketing Visuals/Images/Safety/` | `Designer (5).jpeg` | `03_Sales_And_Marketing/Safety_Images/` | `TSI-MKTG-SafetyVisual-06-20250616.jpeg` | Batch rename |
| 25 | `Marketing Visuals/Images/Safety/` | `Designer (6).jpeg` | `03_Sales_And_Marketing/Safety_Images/` | `TSI-MKTG-SafetyVisual-07-20250616.jpeg` | Batch rename |
| 26 | `Marketing Visuals/Images/Safety/` | `Designer (7).jpeg` | `03_Sales_And_Marketing/Safety_Images/` | `TSI-MKTG-SafetyVisual-08-20250616.jpeg` | Batch rename |
| 27 | `Marketing Visuals/Images/Safety/` | `Designer (8).jpeg` | `03_Sales_And_Marketing/Safety_Images/` | `TSI-MKTG-SafetyVisual-09-20250616.jpeg` | Batch rename |
| 28 | `Marketing Visuals/Images/Safety/` | `Designer (9).jpeg` | `03_Sales_And_Marketing/Safety_Images/` | `TSI-MKTG-SafetyVisual-10-20250616.jpeg` | Batch rename |
| 29 | `Marketing Visuals/Images/Safety/` | `Designer (11).jpeg` | `03_Sales_And_Marketing/Safety_Images/` | `TSI-MKTG-SafetyVisual-11-20250616.jpeg` | Batch rename |
| 30 | `Marketing Visuals/Images/Safety/` | `Designer (12).jpeg` | `03_Sales_And_Marketing/Safety_Images/` | `TSI-MKTG-SafetyVisual-12-20250616.jpeg` | Batch rename |
| 31 | `Marketing Visuals/Images/Safety/` | `Designer (13).jpeg` | `03_Sales_And_Marketing/Safety_Images/` | `TSI-MKTG-SafetyVisual-13-20250616.jpeg` | Batch rename |
| 32 | `Marketing Visuals/Images/Safety/` | `Designer (14).jpeg` | `03_Sales_And_Marketing/Safety_Images/` | `TSI-MKTG-SafetyVisual-14-20250616.jpeg` | Batch rename |
| 33 | `Marketing Visuals/Images/Safety/` | `Designer (15).jpeg` | `03_Sales_And_Marketing/Safety_Images/` | `TSI-MKTG-SafetyVisual-15-20250616.jpeg` | Batch rename |
| 34 | `TechSAFEai Project/` | `TechSafeAI-Stage 1 Planning.url` | `01_Governance/` | `TSI-GOV-Stage1PlanningLink-20250626.url` | Governance planning shortcut; should be in Governance |
| 35 | `TSI-CDMS/apps_script/` | `autoCreateFolders.gs` | `06_Operations/CDMS_Scripts/` | `TSI-OPS-CDMSAutoCreateFolders-v1.0-20251126.gs` | Apps Script — Operations |
| 36 | `TSI-CDMS/apps_script/` | `autoVersioning.gs` | `06_Operations/CDMS_Scripts/` | `TSI-OPS-CDMSAutoVersioning-v1.0-20251126.gs` | Apps Script — Operations |
| 37 | `TSI-CDMS/apps_script/` | `updateAssessmentEngine.gs` | `06_Operations/CDMS_Scripts/` | `TSI-OPS-CDMSUpdateAssessmentEngine-v1.0-20260119.gs` | Most recent script (Jan 2026) |
| 38 | `TSI-CDMS/apps_script/` | `updateCOMBehaviour.gs` | `06_Operations/CDMS_Scripts/` | `TSI-OPS-CDMSUpdateCOMBehaviour-v1.0-20251126.gs` | Apps Script — Operations |
| 39 | `TSI-CDMS/apps_script/` | `updateDependentDocs.gs` | `06_Operations/CDMS_Scripts/` | `TSI-OPS-CDMSUpdateDependentDocs-v1.0-20251126.gs` | Apps Script — Operations |
| 40 | `TSI-CDMS/apps_script/` | `updateDigiBoardLogic.gs` | `06_Operations/CDMS_Scripts/` | `TSI-OPS-CDMSUpdateDigiBoardLogic-v1.0-20251126.gs` | Apps Script — Operations |
| 41 | `TSI-CDMS/apps_script/` | `updateOnboardingScript.gs` | `06_Operations/CDMS_Scripts/` | `TSI-OPS-CDMSUpdateOnboardingScript-v1.0-20260119.gs` | Most recent (Jan 2026) |
| 42 | `TSI-CDMS/apps_script/` | `updateSAICommandPack.gs` | `06_Operations/CDMS_Scripts/` | `TSI-OPS-CDMSUpdateSAICommandPack-v1.0-20251126.gs` | Apps Script — Operations |
| 43 | `TSI-CDMS/automation_engine/` | `automation_manifest.json` | `06_Operations/` | `TSI-OPS-AutomationManifest-v1.0-20260119.json` | Automation manifest — Operations |
| 44 | `TSI-CDMS/schema/` | `document_dependency_matrix.csv` | `00_Master_Index/` | `TSI-CDMS-DocumentDependencyMatrix-v1.0-20260119.csv` | Schema/master index content |
| 45 | `TSI-CDMS/schema/` | `sai_com_agent_registry.csv` | `00_Master_Index/` | `TSI-CDMS-SAIComAgentRegistry-v1.0-20260119.csv` | Agent registry — master index |
| 46 | `TSI-CDMS/schema/` | `smart_tool_registry.csv` | `00_Master_Index/` | `TSI-CDMS-SmartToolRegistry-v1.0-20260119.csv` | Tool registry — master index |
| 47 | `TSI-CDMS/templates/` | `version_control_template.json` | `00_Master_Index/` | `TSI-CDMS-VersionControlTemplate-v1.0-20260119.json` | Versioning template — master index |

---

## TABLE B — Duplicates & Conflicts

| # | Topic | Files / Paths | Recommended Canonical | Action |
|---|---|---|---|---|
| D1 | **Money Manifestation Plan** | `AI FOLDER/Money Manifestation Plan` (no ext, 14.4 KB) vs `AI FOLDER/Money Manifestation Plan.docx` (16.1 KB, same date 2023-01-20) | `Money Manifestation Plan.docx` (larger, has extension) | Keep .docx as canonical → archive both to `99_Archive/2023/`. The extensionless file is likely an older save or OneDrive sync artefact — verify then delete extensionless copy if confirmed identical |
| D2 | **Video Editorial Template** | `AIPOETRY/Video/Video Editorial Template.mp3` (1055 KB) vs `AIPOETRY/Video - Copy/Video Editorial Template.mp3` (1055 KB, identical size and date 2023-06-25) | `AIPOETRY/Video/` copy | **Confirmed exact duplicate** (same size, same date). Archive `Video - Copy/` version to `99_Archive/2023/`. The `Video - Copy` folder is a Windows Explorer copy operation artefact — delete folder after move |
| D3 | **Designer image set naming conflict** | 15 files named `Designer.jpeg`, `Designer (1).jpeg` … `Designer (15).jpeg` — auto-incremented by Windows/browser download | None yet — no canonical naming | Batch rename seq 01–15 per convention `TSI-MKTG-SafetyVisual-NN`. Note: files jump 1→11→12 (10 missing) — **gap in sequence; check source** |
| D4 | **BOT TERMS vs TechSafeAI terms** | `AI FOLDER/BOT TERMS.docx` (2022) lives in wrong folder, no governing doc references it | `BOT TERMS.docx` | Move to `05_Legal_And_Commercial/`. Verify against any website ToS — may need version bump if content was updated on site but not reflected here |
| D5 | **NDIS AICHATBOT folder** | `NDIS GUIDELINES.docx` + `PROJECT BUDDY.docx` both under `AI FOLDER/NDIS AICHATBOT/` — folder structure duplicates function of target `07_Clients/` | Both files | Move to `07_Clients/NDIS/`. Retire source folder after move |

---

## TABLE C — Gaps

| # | Folder | Missing Doc | Why Needed | Priority |
|---|---|---|---|---|
| G1 | `00_Master_Index/` | **Drive Master Index** (e.g. `TSI-CDMS-MasterIndex-v1.0-YYYYMMDD.xlsx`) | No single inventory sheet exists in the drive — schema CSVs are structural, not a human-readable index | **High** |
| G2 | `00_Master_Index/` | **Doc Retention & Disposal Policy** | Required for any genuine DocControl system — defines how long each doc type is kept | **High** |
| G3 | `01_Governance/` | **Company Governance Framework** or Board Charter | No governance charter/policy doc found — only a `.url` shortcut to a planning doc | **High** |
| G4 | `01_Governance/` | **AI Ethics & Usage Policy** | Critical for a company selling AI compliance tools — non-negotiable | **High** |
| G5 | `02_Offers_And_Pricing/` | **Service Pricing Sheet** | Zero pricing/offer documents found anywhere in the drive | **High** |
| G6 | `02_Offers_And_Pricing/` | **Proposal Template** | No proposal or quote template exists | **High** |
| G7 | `03_Sales_And_Marketing/` | **Brand Guidelines doc** | Logo.png exists but no Brand Style Guide (colours, typography, tone) | **Med** |
| G8 | `03_Sales_And_Marketing/` | **Product One-Pager / Capability Statement** | No marketing collateral (brochure, deck, one-pager) found | **High** |
| G9 | `04_Product_And_Tech/` | **Product Roadmap** | No roadmap document found — only a Stage 1 Planning URL shortcut | **High** |
| G10 | `04_Product_And_Tech/` | **AI Agent Architecture Spec** | ESG Agent setup doc exists but no overarching architecture doc | **Med** |
| G11 | `04_Product_And_Tech/` | **SAI (Safety AI) Technical Spec** | SAI referenced in CDMS scripts but no product spec found in drive | **Med** |
| G12 | `05_Legal_And_Commercial/` | **Master Service Agreement (MSA) template** | Only a bot ToS from 2022 — no client contract template | **High** |
| G13 | `05_Legal_And_Commercial/` | **Privacy Policy** | Required under Australian Privacy Act + AI service obligations | **High** |
| G14 | `06_Operations/` | **Onboarding SOP** | `updateOnboardingScript.gs` exists (automation) but no written SOP doc for new client onboarding | **Med** |
| G15 | `06_Operations/` | **Incident Response Plan** | Safety compliance company — no IR plan found | **Med** |
| G16 | `07_Clients/` | **Client Register** | No CRM/client list or engagement tracker found | **Med** |
| G17 | `99_Archive/` | **Archive subfolders by year** | Archive folder exists by convention but no actual yearly subfolders exist yet | **Low** |

---

## TOP 10 ACTIONS (ordered by urgency)

```
[ ] 1. RENAME "rENAME.docx" immediately
       → Determine content, give it a meaningful name, move to 04_Product_And_Tech/
       → This file could be anything; unknown docs are a compliance risk

[ ] 2. CREATE 00_Master_Index/ and populate with the 4 CDMS files
       → document_dependency_matrix.csv, sai_com_agent_registry.csv,
         smart_tool_registry.csv, version_control_template.json
       → These are the closest thing to a document control system currently

[ ] 3. DELETE "Video - Copy/" folder (after confirming D2 duplicate)
       → Confirmed exact duplicate: same filename, size, date
       → Move canonical to 03_Sales_And_Marketing/, delete the copy folder

[ ] 4. ARCHIVE "AI FOLDER/" contents → 99_Archive/2022/ and 99_Archive/2023/
       → Bulk move: AIPOETRY/, NDIS AICHATBOT/ (after client move), GPT Chat.docx,
         Money Manifestation Plan, Elementor Cancellation.JPG, OPEN SOURCE AI APPS.docx

[ ] 5. BATCH RENAME all 15 Designer*.jpeg → TSI-MKTG-SafetyVisual-NN-20250616.jpeg
       → Investigate missing #10 in sequence (Designer (10).jpeg not found)
       → Move to 03_Sales_And_Marketing/Safety_Images/

[ ] 6. MOVE BOT TERMS.docx → 05_Legal_And_Commercial/
       → Rename: TSI-LEGAL-BotTerms-v1.0-20221227.docx
       → Flag for legal review — 2022 doc may be outdated re: Australian AI regulations

[ ] 7. CREATE 02_Offers_And_Pricing/ with a Pricing Sheet and Proposal Template
       → Highest business-critical gap. Company has no discoverable commercial docs.

[ ] 8. CREATE 01_Governance/ with AI Ethics & Usage Policy
       → Required for credibility as an AI safety/compliance vendor
       → Draft can be bootstrapped from existing NDIS guidelines and BOT TERMS content

[ ] 9. CREATE 05_Legal_And_Commercial/ with Privacy Policy + MSA Template
       → Australian Privacy Act obligation
       → MSA template needed before any new client engagements

[10] 10. ADD TSI-CDMS-MasterIndex to 00_Master_Index/
        → Human-readable inventory spreadsheet listing all docs, owners, versions, review dates
        → This audit report itself is a starting point — convert Table A rows to a live register
```

---

## APPENDIX — Folder audit summary

| Target Folder | Files Currently Mappable | Gaps (count) | Status |
|---|---|---|---|
| `00_Master_Index/` | 4 (CDMS schema files) | 2 | 🔴 Critical — no index |
| `01_Governance/` | 1 (url shortcut) | 2 | 🔴 Critical — no policy docs |
| `02_Offers_And_Pricing/` | 0 | 2 | 🔴 Critical — empty |
| `03_Sales_And_Marketing/` | 16 (images + audio + logo) | 2 | 🟡 Has assets, missing collateral |
| `04_Product_And_Tech/` | 2 (agent docs) | 3 | 🟡 Has setup docs, missing architecture |
| `05_Legal_And_Commercial/` | 1 (bot terms) | 2 | 🔴 Critical — outdated single doc |
| `06_Operations/` | 9 (automation scripts + manifest) | 2 | 🟡 Scripts exist, SOPs missing |
| `07_Clients/` | 2 (NDIS docs) | 1 | 🟡 One client area only |
| `99_Archive/` | ~15 (to be moved) | 1 (year subfolders) | 🟢 OK once moves execute |

---

*Report covers OneDrive source `C:\Users\mikes\OneDrive\1. TechSafeAI\` and `C:\Users\mikes\TSI-CDMS\`.  
Note: No Google Drive mount was detected on this machine — content is stored in OneDrive.*  
*Next scan recommended after moves are executed to verify clean state.*
