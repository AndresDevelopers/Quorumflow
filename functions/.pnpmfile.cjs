/**
 * .pnpmfile.cjs - pnpm hook for Cloud Functions dependencies.
 *
 * uuid must stay on a dual CJS/ESM release (11.x). uuid@12+ is pure ESM and
 * breaks gaxios@6 / google-gax via require('uuid') → ERR_REQUIRE_ESM.
 * 11.1.1+ also patches GHSA-w5hq-g745-h8pq (buffer bounds in v3/v5/v6).
 */

const UUID_CJS_SAFE = '11.1.1';

function pinUuid(pkg, context) {
  if (pkg.dependencies && pkg.dependencies['uuid']) {
    const prev = pkg.dependencies['uuid'];
    pkg.dependencies['uuid'] = UUID_CJS_SAFE;
    if (prev !== UUID_CJS_SAFE) {
      context.log(`[pnpmfile] ${pkg.name}: uuid ${prev} → ${UUID_CJS_SAFE}`);
    }
  }
}

function readPackage(pkg, context) {
  if (
    pkg.name === 'cloudevents' ||
    pkg.name === 'gaxios' ||
    pkg.name === 'teeny-request' ||
    pkg.name === 'google-gax'
  ) {
    pinUuid(pkg, context);
  }

  // fast-uri host confusion (GHSA-v2hh-gcrm-f6hx) — fixed in 3.1.4+
  if (pkg.dependencies && pkg.dependencies['fast-uri']) {
    const prev = pkg.dependencies['fast-uri'];
    if (prev !== '^3.1.4' && prev !== '3.1.4') {
      pkg.dependencies['fast-uri'] = '^3.1.4';
      context.log(`[pnpmfile] ${pkg.name}: fast-uri ${prev} → ^3.1.4`);
    }
  }

  // fast-xml-parser DOCTYPE entity expansion (GHSA-8r6m-32jq-jx6q) — fixed in 5.10.1+
  if (pkg.dependencies && pkg.dependencies['fast-xml-parser']) {
    const prev = pkg.dependencies['fast-xml-parser'];
    if (prev !== '^5.10.1' && prev !== '5.10.1') {
      pkg.dependencies['fast-xml-parser'] = '^5.10.1';
      context.log(
        `[pnpmfile] ${pkg.name}: fast-xml-parser ${prev} → ^5.10.1`
      );
    }
  }

  return pkg;
}

module.exports = {
  hooks: {
    readPackage,
  },
};
