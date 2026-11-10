/** Word lists for generated demo data. Names and companies are fictional. */

export const AGENT_NAMES = [
  'Anna Lindqvist',
  'Ben Okafor',
  'Carla Mendes',
  'Dmitri Volkov',
  'Elena Rossi',
  'Farid Haddad',
  'Grace Kim',
  'Hiro Tanaka',
] as const

export const FIRST_NAMES = [
  'Anna', 'Ben', 'Carla', 'Dmitri', 'Elena', 'Farid', 'Grace', 'Hiro', 'Iris', 'Jonas',
  'Kira', 'Liam', 'Maya', 'Noah', 'Olga', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tomas',
  'Uma', 'Victor', 'Wen', 'Yara', 'Zoe',
] as const

export const LAST_NAMES = [
  'Adams', 'Baker', 'Chen', 'Diaz', 'Evans', 'Fischer', 'Garcia', 'Haddad', 'Ivanova', 'Jensen',
  'Kumar', 'Lopez', 'Mori', 'Novak', 'Okafor', 'Petrov', 'Quintero', 'Rossi', 'Silva', 'Tanaka',
  'Usman', 'Varga', 'Weber', 'Yilmaz', 'Zhou',
] as const

export const COMPANIES = [
  'Northwind Labs', 'Blue Harbor Ltd', 'Acme Retail', 'Riverside Clinic', 'Summit Logistics',
  'Lumen Studio', 'Orchid Foods', 'Atlas Civil', 'Juniper Partners', 'Nimbus Analytics',
] as const

export const TAG_NAMES = [
  'billing', 'login', 'bug', 'feature-request', 'integration', 'performance', 'security',
  'onboarding', 'refund', 'api', 'mobile', 'email', 'data-export', 'permissions', 'sso',
  'invoice', 'outage', 'documentation', 'upgrade', 'password-reset', 'webhook', 'import',
  'dashboard', 'notifications', 'attachments', 'account-locked', 'pricing', 'escalation',
  'vip', 'followup',
] as const

export const SUBJECTS = [
  'Cannot log in after password reset',
  'Invoice total does not match the order',
  'CSV export times out for large reports',
  'SSO login loops back to the sign-in page',
  'Webhook deliveries failing with HTTP 500',
  'Missing permissions for a new team member',
  'Dashboard shows stale data',
  'Refund not received after ten days',
  'Mobile app crashes on attachment upload',
  'API rate limit hit unexpectedly',
  'Email notifications arrive twice',
  'Need help with the data import template',
  'Feature request: bulk tagging',
  'Account locked after failed attempts',
  'Attachment preview is blank',
  'Two-factor code is rejected',
  'Charged twice for the same subscription',
  'Search returns no results for exact names',
] as const

export const DESCRIPTIONS = [
  'The customer reports the issue started after the latest update. They can reproduce it on two browsers.',
  'Happens for every account on the Business plan. No error message is shown to the user.',
  'The customer attached a screenshot and asked for an estimate of when this will be fixed.',
  'Only affects users in the EU region. The workaround from the knowledge base does not help.',
  'The issue blocks their month-end process, so they asked for priority handling.',
] as const

export const COMMENT_BODIES = [
  'Thanks for the details. I can reproduce this on my side and am checking the logs now.',
  'Asked the customer for a HAR file and the exact time of the failure.',
  'Escalated to the platform team. They confirmed a known issue with the cache layer.',
  'Shared a temporary workaround with the customer. Waiting for their confirmation.',
  'Customer confirmed the workaround works. Keeping the ticket open until the fix ships.',
  'Internal note: this is the third report this week from the same region.',
  'Follow-up sent. No reply yet, so I will check again tomorrow.',
  'The refund was issued to the original payment method. It may take 5 to 10 business days.',
  'Updated the account permissions as requested and asked the customer to verify.',
  'Could not reproduce with the latest build. Requested the browser version.',
  'Closing the loop with the customer after the fix was deployed to production.',
  'Attached the relevant documentation link for the import template.',
] as const

export const TAG_COLORS = [
  '#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#4b5563',
] as const
