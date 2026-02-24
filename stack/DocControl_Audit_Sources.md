# DocControl Audit â€” Source Manifest
**Generated:** 2026-02-24T23:49:39+07:00

---

## Included Inventories

| # | CSV File | Source Drive | Rows in Index |
|---|----------|--------------|---------------|
| 1 | `corporate_inventory.csv` | 1. Corporate | **98** |
| 2 | `sai_development_inventory.csv` | 6. SAI Development | **99** |
| 3 | `smart_tools_hardware_inventory.csv` | 7. Smart Tools & Hardware | **89** |
| 4 | `strategy_empire_build_inventory.csv` | Strategy / Empire Build | **0** _(empty â€” included per request, 0 rows)_ |
| 5 | `techsafe_operating_system_inventory.csv` | TechSafe Operating System | **2** |
| 6 | `tsi_product_services_inventory.csv` | TSI Product Services | **20** |
| 7 | `ims_inventory_api.csv` | 3. INTERGRATED MANAGMENT SYSTEMS (IMS) | **2** |
| | **TOTAL** | | **310** |

---

## Excluded Inventories

| CSV File | Reason |
|----------|--------|
| `finance_admin_inventory.csv` | EMPTY â€” DriveFS returned header only |
| `finance_admin_inventory_api.csv` | STRUCTURE ONLY â€” 1 folder stub via API |
| `ims_inventory.csv` | BAD â€” DriveFS partial row only |
| `licensing_partners_inventory.csv` | EMPTY â€” DriveFS returned header only |
| `licensing_partners_inventory_api.csv` | STRUCTURE ONLY â€” 1 folder stub via API |
| `marketing_brand_vault_inventory.csv` | EMPTY â€” DriveFS returned header only |
| `marketing_brand_vault_inventory_api.csv` | STRUCTURE ONLY â€” 1 folder stub via API |
| `website_10web_inventory.csv` | DEPRECATED â€” drive retired 2026-02-24 |
| `website_10web_inventory_api.csv` | DEPRECATED â€” drive retired 2026-02-24 |

---

## Notes

- **.lnk files** (Windows shortcuts / DriveFS stubs) are included in index but flagged by extension for cleanup.
- **strategy_empire_build_inventory.csv** contains 0 data rows (header-only); included per request, contributes 0 rows.
- **IMS API** shows 2 rows: 1 folder + 1 shortcut â€” drive content inaccessible; treat as UNKNOWN.
- Drives 2, 4, 5 (Finance, Licensing, Marketing) excluded â€” UNKNOWN/EMPTY; no gaps can be inferred from them.
