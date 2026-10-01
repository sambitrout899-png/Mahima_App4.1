Marketing mobile discovery
=========================

Apply `backend/Mahima.Api.v3.clean/Sql/20260916_marketing_mobile_discovery.sql`
to the application PostgreSQL database before deploying the updated backend.
It adds nullable state/city fields, a schedule contact-focus field and indexes;
existing discovery schedules retain their all-contact mode. No existing contacts
are rewritten. Deploy the backend and frontend together.

In Digital Marketing > AI Discovery, choose mobile / WhatsApp contacts, enter
countries, states or cities, and run discovery. The Indian geography preset is
available. Each run requests up to 100 results, dependent on available sources;
this is not a complete census. Repeated runs deduplicate normalized numbers.
Scheduled discovery stores the same focus and keeps the existing approval gate.

Review source links, public numbers, ISD codes, geography and fit evidence in
Prospects. Number type is based on numbering-plan metadata, not a live carrier
lookup or proof that WhatsApp is active. Fixed-line-or-mobile classifications
remain explicitly ambiguous. WhatsApp numbers require explicit source evidence;
discovery never grants opt-in. Record verified WhatsApp marketing permission
using the review control only when that permission has actually been obtained.

Campaign audience filters support country, state, city and contact availability.
Select SMS or WhatsApp, preview the audience, approve and dispatch using the
existing workflow. SMS rejects invalid/known landline numbers and resolves
`{{demoLink}}` and `{{optOut}}`. WhatsApp uses the existing approved Content SID
and tracked-link variables. Repeated phone destinations within a channel in a
single batch are suppressed. Phone validation does not guarantee delivery.

Discovery needs the existing configured web-search API key. Dispatch needs the
existing Twilio sender/template setup. No real discovery, migration or outbound
messages are performed by the automated checks.

Run phone validation checks:

    dotnet run --project tools/marketing-phone-check/MarketingPhoneCheck.csproj

Phone normalization uses libphonenumber-csharp 9.0.39. E.164 format reference:
https://www.twilio.com/docs/glossary/what-e164

Browser checks (mock APIs, requires the existing frontend dependencies, DemoRenderer Playwright and Edge):

    node tools/marketing-phone-check/check-ui.cjs

Screenshots are written to `tmp/marketing-mobile-*.png`. Run from the repository root after a frontend build.
