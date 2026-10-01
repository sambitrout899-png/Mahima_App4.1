# Expired package deletion and tenant access

Root admins can delete expired packages and unpublished drafts. Deletion hides the package from the admin catalog and all tenant discovery/activation paths. It is a permanent logical deletion (`lifecycle_status = deleted`): publications, subscriptions and billing references remain for historical reporting. Deleted packages cannot be edited, republished or reopened. A different package needs a new code.

Expiring a package now expires all its publications, ends its tenant subscriptions and revokes licenses sourced from that package. Independent manual licenses and licenses sourced from another available package are preserved. Tenant discovery, module checks, page permissions, activation, subscription resume and version acceptance reject unavailable packages. Reopening an expired package as a draft does not restore tenant access; publishing and explicit activation are required.

Deploy the API and frontend together and apply `backend/Mahima.Api.v3.clean/Sql/20260918_expired_package_lifecycle.sql` after existing package-publishing migrations. The migration repairs already-expired packages, cancels pending upgrades/payment requests, and adds database guards against stale or concurrent activation attempts. It does not delete payment history or issue refunds. Review existing subscribers before applying: the requested policy deliberately removes access they previously retained after package expiry.

The UI labels expired packages with **Delete Package** and only offers **Activate For Selected Tenant** for enabled, published packages. Expiry confirmation states that existing subscribers lose access.

Verification: `node tools/tenant-storage-check/package-lifecycle.mjs` runs 16 isolated PostgreSQL/WASM integration checks using the previously installed PGlite test runtime. Backend and frontend builds are also checked. Production deployment/database execution is separate and has not been performed here.
