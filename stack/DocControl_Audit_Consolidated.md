# TSI DocControl Audit — Consolidated Report
**Generated:** 2026-02-24T23:35:28+07:00
**Mode:** Option 1 — Partial consolidation, real data only
**Repo:** `C:\Users\mikes\.gemini\antigravity\scratch\openclaw`

---

## 1. Overview

This report consolidates Drive inventory data from all Shared Drives accessible via DriveFS or the Drive API.
It is based **exclusively on files present in the inventory CSVs** — no assumptions or hallucinations.

The consolidation target is the `TSI-01 DocControl.GOOGLE` folder structure (Decision A locked).
The canonical security location is:
```
TSI-01 DocControl.GOOGLE/01_Governance/Policies/Security_And_Access_Control/
```

---

## 2. Sources Included

| # | CSV File | Drive / Source | Data Rows | Notes |
|---|----------|----------------|-----------|-------|
| 1 | `corporate_inventory.csv` | 1. Corporate (`G:\Shared drives\1. Corporate`) | **99** | TSI-OS governance docs, SAI-COM architecture |
| 2 | `sai_development_inventory.csv` | 6. SAI Development | **100** | SAI Command Pack, Assessment Engine, Onboarding |
| 3 | `smart_tools_hardware_inventory.csv` | 7. Smart Tools & Hardware | **90** | Devices, Digi-Boards, OEM, firmware |
| 4 | `tsi_product_services_inventory.csv` | TSI Product Services | **21** | Media assets: MP4, PDF, M4A, PNG per product line |
| 5 | `techsafe_industries_phase2_build_inventory.csv` | TechSafe_Industries_Phase2_Build | **15** | Web build artefacts (JS, HTML, CSS, JSON) |
| 6 | `techsafe_operating_system_inventory.csv` | TechSafe_Operating_System | **2** | PD spec + project tracker (DriveFS stub) |
| 7 | `ims_inventory_api.csv` | 3. IMS (Drive API) | **2** | Top-level folder + 1 shortcut only (structure only) |
| | **TOTAL** | | **329** | |

---

## 3. Sources Excluded

| CSV File | Drive | Reason |
|----------|-------|--------|
| `finance_admin_inventory.csv` | 2. Finance & Admin | EMPTY — DriveFS returned header only (0 data rows) |
| `finance_admin_inventory_api.csv` | 2. Finance & Admin | STRUCTURE ONLY — API returned 1 row (folder stub) |
| `licensing_partners_inventory.csv` | 4. Licensing & Partners | EMPTY — DriveFS returned header only |
| `licensing_partners_inventory_api.csv` | 4. Licensing & Partners | STRUCTURE ONLY — API returned 1 row (folder stub) |
| `marketing_brand_vault_inventory.csv` | 5. Marketing & Brand Vault | EMPTY — DriveFS returned header only |
| `marketing_brand_vault_inventory_api.csv` | 5. Marketing & Brand Vault | STRUCTURE ONLY — API returned 1 row (folder stub) |
| `ims_inventory.csv` | 3. IMS | BAD — DriveFS returned header + 1 partial row only |
| `strategy_empire_build_inventory.csv` | Strategy / Empire Build | EMPTY — header only (0 data rows confirmed) |
| `website_10web_inventory.csv` | 10. Website 10Web | DEPRECATED — drive retired, new website built |
| `website_10web_inventory_api.csv` | 10. Website 10Web | DEPRECATED — drive retired |

**Drives with UNKNOWN content (cannot identify gaps from these):**
- 2. Finance & Admin — UNKNOWN/EMPTY — excluded
- 4. Licensing & Partners — UNKNOWN/EMPTY — excluded
- 5. Marketing & Brand Vault — UNKNOWN/EMPTY — excluded

---

## 4. Summary Metrics

### 4.1 File Counts by Source Drive

| Drive | Files | Folders/Stubs | Media (binary) | Google Workspace |
|-------|-------|---------------|----------------|-----------------|
| 1. Corporate | 99 | 0 | 1 (.lnk) | 98 (.gdoc/.gsheet) |
| 6. SAI Development | 100 | 0 | 7 (.mp4/.m4a/.png/.pdf) | 88 (.gdoc/.gsheet) + 5 (.lnk) |
| 7. Smart Tools & Hardware | 90 | 0 | 5 (.mp4/.m4a/.png/.pptx/.xlsx) | 83 (.gdoc) + 2 (.lnk) |
| TSI Product Services | 21 | 0 | 21 (binary only) | 0 |
| Phase2 Build | 15 | 0 | 15 (dev artefacts) | 0 |
| TechSafe OS | 2 | 0 | 0 | 2 |
| 3. IMS (API) | 2 | 1 folder | 0 | 1 shortcut |
| **TOTAL** | **329** | | | |

### 4.2 Top Extensions (all included sources)

| Extension | Count | Category |
|-----------|-------|----------|
| `.gdoc` | ~253 | Google Doc (governance, specs, scripts) |
| `.gsheet` | ~10 | Google Sheet (registers, matrices) |
| `.mp4` | 7 | Video |
| `.m4a` | 5 | Audio |
| `.pdf` | 5 | PDF documents |
| `.png` | 5 | Images |
| `.js` | 5 | JavaScript (Phase2 build) |
| `.lnk` | 8 | Windows shortcuts (DriveFS artefacts — noise) |
| `.html` | 2 | HTML (Phase2 build) |
| `.pptx` | 2 | PowerPoint (Digi-Boards folder) |

### 4.3 Key Structural Observations

1. **Dominant content type:** `.gdoc` — ~77% of all indexed files
2. **`.lnk` shortcuts (8 total):** DriveFS desktop.ini noise; all are zero-byte; should be excluded from DocControl
3. **Binary media in SAI Dev & Smart Tools:** MP4, M4A, PNG, PDF — currently scattered in product/hardware folders, not linked to a media library
4. **Phase2 Build drive:** Contains active web source code (`.js`, `.html`, `.css`) — not a governance document; should be quarantined separately
5. **TSI Product Services:** Entirely binary media (no `.gdoc`) — product marketing pack, not a governance drive
6. **IMS drive:** Only top-level folder visible via API — drive not materialised; content unknown

---

## 5. TSI-01 DocControl Target Structure (Reference)

```
TSI-01 DocControl.GOOGLE/
├── 01_Governance/
│   ├── Policies/
│   │   └── Security_And_Access_Control/   ← canonical security location (Decision A)
│   ├── TSI_Operating_System/              ← TSI-OS 01–08 docs
│   └── AI_Governance/                     ← TSI-OS 02 AI rules
├── 02_Legal/
│   └── Templates/                         ← MSA, DPA, T&C, Privacy Policy
├── 03_Products/
│   ├── SAI/
│   ├── SAI-COM/
│   ├── SmartTools/
│   └── DigiBoards/
├── 04_Operations/
└── 05_Media/
    └── ProductMarketing/                  ← MP4, M4A, PDF media assets
```

---

## 6. Top 10 Actions (Risk × Leverage Ranked)

| Rank | Action | Risk | Leverage | Drive(s) |
|------|--------|------|----------|----------|
| 1 | **Consolidate all TSI-OS 07 security docs (OS-07-F) → Security_And_Access_Control/** | HIGH | HIGH | Corporate |
| 2 | **Remove / resolve all 8 `.lnk` shortcut stubs** — zero-byte DriveFS noise | HIGH | HIGH | SAI Dev, Smart Tools, Corporate |
| 3 | **Create Master Document Register** in `01_Governance/` — currently missing | HIGH | HIGH | — (gap) |
| 4 | **Create Privacy Policy v1.0** in `02_Legal/Templates/` — drafts exist in SAI Dev | HIGH | HIGH | SAI Dev |
| 5 | **Quarantine Phase2 Build dev artefacts** — web source code is not a governance doc | MED | HIGH | Phase2 Build |
| 6 | **Deduplicate SAI question pack files** (3.3 Planet Pack has 2 copies in same folder) | MED | HIGH | SAI Dev |
| 7 | **Deduplicate SAI Core Identity docs** (v1.0 + v1.1 MASTER in same folder) | MED | MED | SAI Dev |
| 8 | **Move TSI Product Services binary media** → `05_Media/ProductMarketing/` | MED | MED | Product Services |
| 9 | **Resolve IMS drive access** — drive content unknown; critical for IMS gap analysis | HIGH | MED | IMS |
| 10 | **Create MSA Template + DPA** in `02_Legal/Templates/` — confirmed missing | HIGH | MED | — (gap) |
