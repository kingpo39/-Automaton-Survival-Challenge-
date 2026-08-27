/**
 * Policy Rules — Validation
 * Input format validation: package names, URLs, domains, git hashes.
 */

import type { PolicyRule, PolicyContext, PolicyDecision } from '../../types.js';

const PACKAGE_NAME_REGEX = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z][a-z0-9._-]*$/;
const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const GIT_HASH_REGEX = /^[0-9a-f]{7,40}$/;
const URL_REGEX = /^https?:\/\/.+/;

export const validationRules: PolicyRule[] = [
  {
    name: 'package_name_validation',
    category: 'validation',
    priority: 60,
    evaluate(context: PolicyContext): PolicyDecision | null {
      const { toolName, params } = context;
      const installTools = ['install_npm_package'];
      if (!installTools.includes(toolName)) return null;

      const packageName = params.package as string;
      if (!packageName || PACKAGE_NAME_REGEX.test(packageName)) return null;

      return {
        action: 'deny',
        reason: `Invalid package name format: "${packageName}"`,
        rule: 'package_name_validation',
        category: 'validation',
        priority: 60,
      };
    },
  },
  {
    name: 'domain_validation',
    category: 'validation',
    priority: 61,
    evaluate(context: PolicyContext): PolicyDecision | null {
      const { toolName, params } = context;
      const domainTools = ['register_domain'];
      if (!domainTools.includes(toolName)) return null;

      const domain = params.name as string;
      if (!domain || DOMAIN_REGEX.test(domain)) return null;

      return {
        action: 'deny',
        reason: `Invalid domain format: "${domain}"`,
        rule: 'domain_validation',
        category: 'validation',
        priority: 61,
      };
    },
  },
  {
    name: 'git_hash_validation',
    category: 'validation',
    priority: 62,
    evaluate(context: PolicyContext): PolicyDecision | null {
      const { toolName, params } = context;
      const gitTools = ['git_commit', 'git_clone'];
      if (!gitTools.includes(toolName)) return null;

      const hash = params.commit as string;
      if (!hash || !GIT_HASH_REGEX.test(hash)) return null;

      return null; // Valid hash format
    },
  },
  {
    name: 'url_validation',
    category: 'validation',
    priority: 63,
    evaluate(context: PolicyContext): PolicyDecision | null {
      const { toolName, params } = context;
      const urlTools = ['x402_fetch'];
      if (!urlTools.includes(toolName)) return null;

      const url = params.url as string;
      if (!url || URL_REGEX.test(url)) return null;

      return {
        action: 'deny',
        reason: `Invalid URL format: "${url}"`,
        rule: 'url_validation',
        category: 'validation',
        priority: 63,
      };
    },
  },
];
