# Security Policy

## Public portfolio repository

This repository is a sanitized portfolio version of Dormify. It must not be
used with real student records, operational housing exports, or production
credentials unless the relevant organization has independently reviewed and
approved the deployment.

## Secrets

Do not commit:

- `.env` files or database connection strings;
- API tokens, passwords, private keys, or certificates;
- production hostnames or internal network configuration;
- exports containing student, resident, staff, or operational data.

Use environment variables and local secret-management mechanisms instead.

## Reporting a security issue

Please avoid posting sensitive vulnerability details, credentials, or personal
data in a public GitHub issue. Contact the repository owner privately or use
GitHub's private security-reporting features when available.

## Scope

The public repository is provided for portfolio and technical-review purposes.
It is not an official production security baseline for any institution.
