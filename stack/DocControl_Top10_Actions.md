# TSI DocControl — Top 10 Actions
**Generated:** 2026-02-24T23:54:08+07:00
**Scope:** Based on 310 indexed files across 6 active drives. Decisions locked per prior sessions.

---

## Ranking: Risk × Leverage

| # | Action | Risk | Leverage |
|---|--------|------|----------|
| 1 | Designate canonical Security & Access Control location | HIGH | HIGH |
| 2 | Create Master Document Register | HIGH | HIGH |
| 3 | Resolve and delete all `.lnk` shortcut stubs | HIGH | HIGH |
| 4 | Finalise Privacy Policy as standalone legal document | HIGH | HIGH |
| 5 | Create MSA Template + DPA in `02_Legal/Templates/` | HIGH | HIGH |
| 6 | Resolve IMS drive access (content unknown) | HIGH | MED |
| 7 | Deduplicate SAI Dev same-folder version pairs (16 groups) | MED | HIGH |
| 8 | Classify Phase2 Build dev artefacts (not governance docs) | MED | HIGH |
| 9 | Create Media Asset Register for TSI Product Services | MED | MED |
| 10 | Create Disposal & Archive Register (rules exist, register missing) | MED | MED |

---

## Detailed Actions

**1. 🔒 [Decision A — LOCKED] Designate canonical Security & Access Control location**
- `SECURITY & ACCESS CONTROL (OS-07-F).gdoc` exists in `1. Corporate / TSI-OS 07`.
- Move (or designate shortcut) to:
  `TSI-01 DocControl.GOOGLE/01_Governance/Policies/Security_And_Access_Control/`
- All future security policy documents must reference this path as authoritative.
- **Owner:** DocControl lead. **Due:** Immediate.

**2. 📋 Create Master Document Register (MDR)**
- No MDR found in any of the 310 indexed files.
- MDR must enumerate all controlled documents with: DocID, Title, Owner, Version, Location, Review Date.
- Target: `TSI-01 DocControl.GOOGLE/01_Governance/Master_Document_Register.gsheet`
- **Owner:** DocControl lead. **Due:** Before any further document moves.

**3. 🗑️ Remove all `.lnk` shortcut stubs (8 files)**
- 8 zero-byte `.lnk` files identified across SAI Dev and Smart Tools drives (DriveFS artefacts).
- These are noise — they reference documents that exist elsewhere under correct names.
- Files to delete: all `.lnk` entries in `DocControl_Audit_Index.csv`.
- **Owner:** Drive admins. **Due:** This sprint.

**4. ⚖️ Finalise Privacy Policy as standalone legal document**
- `TSI — DATA PRIVACY RULES v1.0 MASTER` + `Vision Privacy Anonymisation Rules` exist in SAI Dev.
- These are *architecture documents*, not client-facing Privacy Policy.
- Create `Privacy_Policy_v1.0.gdoc` at `TSI-01 DocControl.GOOGLE/02_Legal/Templates/`.
- Requires legal review before publishing.
- **Owner:** Legal / MD. **Due:** Before any SaaS client onboarding.

**5. ⚖️ Create MSA Template + DPA**
- Neither found in any indexed inventory.
- `TSI-OS 03-06 Legal Documents Standard` defines the requirement but templates are absent.
- Create: `MSA_Template_v1.0.gdoc` + `DPA_Template_v1.0.gdoc` at `TSI-01 DocControl.GOOGLE/02_Legal/Templates/`.
- **Owner:** Legal / MD. **Due:** Before first enterprise client contract.

**6. 🔍 Resolve IMS drive access**
- `3. INTERGRATED MANAGMENT SYSTEMS (IMS)` returned only 1 folder + 1 shortcut via API.
- Drive content is entirely unknown — no gap analysis possible.
- Action: Grant service account full Viewer access; re-run `npm run drive:export-api-blocked`; re-assess gaps.
- **Owner:** IT / Drive admin. **Due:** Next sprint.

**7. 🔄 Deduplicate SAI Dev same-folder version pairs**
- 16 same-folder/same-extension groups found (e.g. `Agent Logic Blueprints v1.0` + `v1.1` in same folder).
- 2 exact-match `Untitled document.gdoc` duplicates — delete immediately.
- For versioned pairs: confirm which is MASTER, archive or delete the prior version.
- Reference: `stack/DocControl_Audit_Duplicates.csv` for full list.
- **Owner:** SAI Dev content owner. **Due:** This sprint.

**8. 💻 Classify Phase2 Build dev artefacts**
- `TechSafe_Industries_Phase2_Build` drive contains `.js`, `.html`, `.css`, `.zip`, `.json` source files.
- These are web build artefacts — not governance documents.
- Action: Add classification tag `DEV_ARTEFACT`; create brief retention policy; exclude from DocControl scope.
- **Owner:** Dev lead. **Due:** This sprint.

**9. 🎬 Create Media Asset Register for TSI Product Services**
- 21 binary files (MP4, M4A, PDF, PNG) in `TSI Product Services` drive — no naming convention, no register.
- Create `Media_Asset_Register.gsheet` at `TSI-01 DocControl.GOOGLE/05_Media/ProductMarketing/`.
- Apply TSI-03 naming convention retrospectively.
- **Owner:** Marketing. **Due:** Next sprint.

**10. 📁 Create Disposal & Archive Register**
- `TSI-OS 03-08 Disposal & Archive Rules` exists (Corporate drive) — the rules are defined.
- No active register documenting disposed/archived documents exists.
- Create `Disposal_Archive_Register.gsheet` at `TSI-01 DocControl.GOOGLE/01_Governance/`.
- **Owner:** DocControl lead. **Due:** On MDR completion.

---

## Drives Excluded from Gap Analysis (content unknown)

| Drive | Status | Implication |
|-------|--------|-------------|
| 2. Finance & Admin | UNKNOWN/EMPTY | Financial policy / contract gaps cannot be assessed |
| 4. Licensing & Partners | UNKNOWN/EMPTY | Licensing agreement gaps cannot be assessed |
| 5. Marketing & Brand Vault | UNKNOWN/EMPTY | Brand/marketing document gaps cannot be assessed |
| 3. IMS | STRUCTURE ONLY | IMS document set status unknown |
