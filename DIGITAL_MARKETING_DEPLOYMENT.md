# Digital Marketing & Revenue Center

## Capability

The Root tenant receives an approval-gated workflow:

`public prospect -> Root review -> campaign draft -> Root approval -> dispatch -> response -> qualified lead -> quote -> customer acceptance -> order -> 30-day all-feature demo -> SaaS billing`

The API enforces Root-tenant status in addition to the `admin` role. Tenant admins and members cannot access these endpoints.

## Production deployment

From PostgreSQL (`mahima_db_3_0`):

```sql
\i /root/Mahima_App_V4.1/backend/Mahima.Api.v3.clean/Sql/20260731_digital_marketing_crm.sql
\i /root/Mahima_App_V4.1/backend/Mahima.Api.v3.clean/Sql/20260731_digital_marketing_page.sql
```

Publish and restart the API:

```bash
cd /root/Mahima_App_V4.1/backend/Mahima.Api.v3.clean
dotnet publish -c Release -o /opt/mahima-api
sudo systemctl restart mahima-api
sudo systemctl status mahima-api --no-pager
```

Build and deploy the frontend to the Caddy document root:

```bash
cd /root/Mahima_App_V4.1/frontend
pnpm install --frozen-lockfile
pnpm build
sudo mkdir -p /var/www/beta-mahima
sudo cp -a dist/. /var/www/beta-mahima/
sudo chown -R caddy:caddy /var/www/beta-mahima
sudo systemctl reload caddy
```

Open `/#/home/admin/digital-marketing` as `SambitR`.

## Channel configuration

- Email uses the existing `Email` SMTP configuration and sends only after Root approval.
- WhatsApp, LinkedIn, Facebook, Instagram and X are recorded as `awaiting_connector`. Configure the corresponding official business APIs before enabling their workers. The application never attempts browser automation or credential sharing for these networks.
- Prospect records require a public source URL. AI drafts campaigns but is explicitly instructed not to invent organizations, contacts, consent or commercial claims.
- `Do not contact` sets a persistent suppression state used by every campaign.

## Operational state rules

- Only `draft`/`pending_approval` campaigns can be approved.
- Only `approved`/`active` campaigns can dispatch.
- Only approved, non-suppressed prospects enter dispatch.
- A lead must be `qualified`, `proposal` or `negotiation` before quoting.
- A quote must be accepted by the customer before the Root Admin can activate a demo.
- Demo licenses cover every enabled module for exactly one month and are marked with source `marketing_demo`.
- Paid conversion continues in the existing Subscriptions and SAAS Billing screens, preserving one billing ledger.

## Verification

```bash
curl -i https://beta.mahimaministries.in/api/admin/marketing/dashboard
journalctl -u mahima-api --since "10 minutes ago" --no-pager
```

The unauthenticated curl must return `401`. A Root Admin token must return the dashboard; a non-root admin must return `403`.
