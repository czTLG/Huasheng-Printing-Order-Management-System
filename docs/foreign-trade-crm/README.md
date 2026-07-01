# Foreign Trade CRM Docs

Start here for the CRM project.

## Index

1. `CRM_CONTEXT.md` - current system facts and safety rules
2. `CRM_IMPLEMENTATION_STATUS.md` - feature completion and roadmap
3. `CRM_ORDER_SYSTEM_BOUNDARY.md` - CRM vs order-system boundary rules
4. `CRM_CHANGELOG.md` - compact milestone log
5. `archive/CRM_CHANGELOG_FULL.md` - full historical changelog archive

## Reading Order

* New task: read `CRM_CONTEXT.md` first
* Anything touching orders or production: read `CRM_ORDER_SYSTEM_BOUNDARY.md`
* Need to know what is done: read `CRM_IMPLEMENTATION_STATUS.md`
* Use `CRM_CHANGELOG.md` for milestone history only
* Use the archive only when you need the full history

## Rules

* Keep this docs set as the long-term source of truth for CRM work.
* Do not store passwords, tokens, or full customer email bodies here.
* Update `CRM_CONTEXT.md` when facts, boundaries, or priorities change.
* Update `CRM_IMPLEMENTATION_STATUS.md` when completion status changes.
* Keep `CRM_CHANGELOG.md` short; move lengthy history into the archive.
