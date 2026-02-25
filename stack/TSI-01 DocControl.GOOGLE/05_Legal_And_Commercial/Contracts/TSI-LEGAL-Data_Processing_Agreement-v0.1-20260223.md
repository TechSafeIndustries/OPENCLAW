# DRAFT — NOT LEGAL ADVICE — REVIEW REQUIRED BEFORE USE

---

# Data Processing Agreement (DPA)
**Document ID:** TSI-LEGAL-Data_Processing_Agreement-v0.1-20260223  
**Version:** 0.1 (DRAFT)  
**Owner:** [LEGAL OWNER — TO BE ASSIGNED]  
**Status:** Draft — Pending Legal Review  
**Jurisdiction:** Australia  
**Last Updated:** 23 February 2026

> ⚠️ This DPA is a draft template intended to align with the *Privacy Act 1988* (Cth), the Australian Privacy Principles (APPs), and the Notifiable Data Breaches (NDB) scheme. It does not constitute legal advice. Review by a qualified legal practitioner is required before use with any client.

---

## PARTIES

**Data Controller (Client):**  
[CLIENT FULL LEGAL NAME] (ABN: [ABN])  
of [CLIENT ADDRESS]  
("Controller")

**Data Processor (Provider):**  
[TECHSAFE INDUSTRIES FULL LEGAL NAME] (ABN: [ABN])  
of [PROVIDER ADDRESS]  
("Processor")

**Effective Date:** [DATE — usually same as MSA Effective Date]

This DPA forms part of and is incorporated into the Master Services Agreement (**TSI-LEGAL-MSA_Template**) between the Parties.

---

## 1. DEFINITIONS

| Term | Meaning |
|---|---|
| **Personal Information** | Information or opinion about an identified or reasonably identifiable individual (as defined in *Privacy Act 1988* Cth) |
| **Sensitive Information** | Personal information as defined in APP 3.3 (health, workplace safety records, union membership, etc.) |
| **Processing** | Any operation performed on Personal Information, including collection, storage, use, disclosure, transmission, or deletion |
| **Data Breach** | Unauthorised access, disclosure, or loss of Personal Information |
| **Sub-Processor** | A third party engaged by the Processor to assist in processing Personal Information |
| **Platform** | The Provider's AI-assisted products and services (SAI, SAI-COM, Digi Boards) |

---

## 2. SCOPE AND PURPOSE

2.1 This DPA governs the processing of Personal Information by the Processor on behalf of the Controller in connection with delivery of the Services under the MSA.

2.2 The types of Personal Information processed may include:

| Category | Examples | Sensitivity |
|---|---|---|
| Identity/Contact | Name, email, phone | Standard |
| Employment | Job title, site, employer | Standard |
| WHS Records | Incident reports, hazard logs, near-miss data | ⚠️ May be sensitive under APPs |
| Platform Usage | Login times, session data, AI interaction logs | Standard |
| Safety Compliance | Checklist completions, permit records, training records | Standard |

2.3 The purposes for which Personal Information is processed:
- Delivery and operation of the Platform
- Safety data aggregation and reporting for the Controller's sites
- Technical support and maintenance
- Platform analytics (aggregated and de-identified wherever possible)

---

## 3. PROCESSOR OBLIGATIONS

The Processor will:

3.1 **Lawful Processing.** Process Personal Information only on documented instructions of the Controller, unless required by law.

3.2 **Confidentiality.** Ensure all persons authorised to process Personal Information are bound by appropriate confidentiality obligations.

3.3 **Security.** Implement and maintain appropriate technical and organisational security measures to protect Personal Information, including:
- Encryption at rest and in transit
- Role-based access controls
- Multi-factor authentication
- Audit logging of access to Personal Information
- Regular security assessments (see TSI-LEGAL-SecurityPolicy)

3.4 **Sub-Processors.** Not engage Sub-Processors without prior written consent of the Controller. Where consent is given, ensure Sub-Processors are bound by equivalent DPA obligations. Current approved Sub-Processors are listed in **Schedule 1**.

3.5 **Overseas Transfers.** Not transfer Personal Information outside Australia without: (a) the Controller's prior written consent; and (b) ensuring appropriate cross-border safeguards are in place per APP 8.

3.6 **Data Breach.** Notify the Controller within **72 hours** of becoming aware of a Data Breach. Notification will include: nature of the breach; categories of Personal Information affected; likely consequences; and remediation steps taken.

3.7 **Individual Rights.** Assist the Controller in meeting obligations to individuals exercising rights under the APPs (access, correction, complaints).

3.8 **Audit.** Allow the Controller (or their authorised auditor) to conduct reasonable audits of the Processor's data processing practices, on **[14] days' written notice**, no more than once per year.

3.9 **Deletion / Return.** On termination of the MSA, delete or return all Personal Information to the Controller within **[30] days**, as directed by the Controller.

---

## 4. CONTROLLER OBLIGATIONS

The Controller will:

4.1 Ensure Personal Information is collected and provided to the Processor lawfully and with appropriate consent or authority.

4.2 Ensure all instructions to the Processor comply with applicable law.

4.3 Provide timely responses to Processor queries where required for lawful processing.

---

## 5. NOTIFIABLE DATA BREACHES

5.1 This DPA incorporates the requirements of the **Notifiable Data Breaches (NDB) scheme** under Part IIIC of the *Privacy Act 1988* (Cth).

5.2 Where a breach meets the threshold of "likely serious harm", the Parties will cooperate on notification to:
- Affected individuals; and
- The **Office of the Australian Information Commissioner (OAIC)** — www.oaic.gov.au

5.3 The Controller is the Responsible Party for NDB notifications. The Processor will provide all reasonable assistance.

---

## 6. SENSITIVE INFORMATION — SPECIAL HANDLING

6.1 Where the Processor handles Sensitive Information (including workplace health and safety data that may reveal health information), the following additional measures apply:
- Minimise collection to what is strictly necessary
- Apply heightened access controls — restrict to named roles only
- Do not use for any purpose other than those stated in Section 2.3
- Do not disclose to third parties without explicit authorisation

6.2 ⚠️ **AI and WHS Data:** AI tools (SAI, SAI-COM) may process information about workplace incidents. This data must not be used to train external AI models or shared with AI providers beyond what is necessary for service delivery without explicit Controller consent.

---

## 7. DATA RETENTION AND DELETION

| Data Category | Retention Period | Action on Expiry |
|---|---|---|
| WHS Records | [SPECIFY — e.g. 7 years per WHS legislation] | Securely delete / return to Controller |
| Platform usage logs | [SPECIFY — e.g. 2 years] | Anonymise or delete |
| Account/identity data | Duration of MSA + [SPECIFY] | Delete on termination |
| Incident reports | [SPECIFY per applicable WHS Act] | Delete / return |

Retention periods must comply with applicable Australian WHS legislation in the relevant State/Territory.

---

## 8. TERM AND TERMINATION

8.1 This DPA commences on the Effective Date and terminates on termination of the MSA.

8.2 Obligations regarding Data Breach notification, data deletion, and confidentiality survive termination.

---

## 9. GOVERNING LAW

This DPA is governed by the laws of **[STATE — e.g. Queensland]**, Australia.

---

## SCHEDULE 1 — APPROVED SUB-PROCESSORS

| Sub-Processor | Location | Purpose | Data Categories |
|---|---|---|---|
| Google LLC (Google Workspace) | USA (data stored in [REGION]) | Document storage, collaboration platform | All categories |
| [OTHER CLOUD PROVIDER] | [LOCATION] | [PURPOSE] | [CATEGORIES] |
| [ADD AS APPLICABLE] | | | |

> ⚠️ Sub-processor list must be reviewed and confirmed by legal and IT before execution.

---

## Document Control

| Field | Detail |
|---|---|
| Created | 23 February 2026 |
| Author | [AUTHOR] |
| Reviewed By | [REVIEWER — LEGAL] |
| Approved By | [APPROVER] |
| Related Docs | TSI-LEGAL-MSA_Template, TSI-LEGAL-Privacy_Policy, TSI-LEGAL-SecurityPolicy |

*END OF DOCUMENT — DRAFT v0.1*
