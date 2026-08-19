import type { LicenceAssessment, LicenceId } from './types';

/**
 * What each recognised licence permits.
 *
 * ── WHY A TABLE AND NOT A HEURISTIC ──────────────────────────────────────
 *
 * "Does this look open?" is not a question with a reliable answer, and every
 * attempt to answer it by pattern — a permissive-sounding name, the presence
 * of a LICENSE file, the word "open" — gets NC and ND clauses wrong. Those
 * two are the ones that matter commercially and they are the ones a
 * heuristic misses, because their names look exactly as permissive as the
 * licences beside them.
 *
 * ── THE CONSERVATIVE CALLS, AND WHY ──────────────────────────────────────
 *
 * CC-BY-NC is marked NOT ingestible. It permits non-commercial use, and
 * Synora is a commercial product; ingesting NC material into an index that
 * serves paying customers is the use it prohibits. That is a decision that
 * costs Synora access to real corpora, and it is the right one.
 *
 * CC-BY-ND is marked NOT ingestible for a subtler reason: ND forbids
 * derivative works, and chunking a document and embedding the pieces
 * produces derivatives. A system that ingested ND material would be relying
 * on nobody noticing.
 *
 * `UNKNOWN` is refused. It is the honest state for most material on the
 * internet, and treating unknown as permissive is precisely how a legal
 * problem is acquired silently.
 *
 * ── THE DISCLAIMER THAT BELONGS HERE ─────────────────────────────────────
 *
 * This table encodes a careful reading of the standard terms. It is not
 * legal advice, and a source whose terms are unusual — a bespoke data-use
 * agreement, a government portal with its own conditions — needs a human to
 * read them. `government-open-data` exists for exactly that case and is
 * marked as requiring per-source verification.
 */
const LICENCES: Readonly<Record<LicenceId, LicenceAssessment>> = {
  'CC0-1.0': {
    id: 'CC0-1.0',
    name: 'Creative Commons Zero 1.0 Universal',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    ingestionPermitted: true,
    attributionRequired: false,
    shareAlike: false,
    commercialUsePermitted: true,
    derivativesPermitted: true,
    requiresHumanReview: false,
    note: 'Dedicated to the public domain. The least restrictive option available.',
  },
  'CC-BY-4.0': {
    id: 'CC-BY-4.0',
    name: 'Creative Commons Attribution 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    ingestionPermitted: true,
    attributionRequired: true,
    shareAlike: false,
    commercialUsePermitted: true,
    derivativesPermitted: true,
    requiresHumanReview: false,
    note: 'Attribution must appear wherever the content is surfaced — which is why every retrieved chunk carries its citation.',
  },
  'CC-BY-SA-4.0': {
    id: 'CC-BY-SA-4.0',
    name: 'Creative Commons Attribution-ShareAlike 4.0',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    ingestionPermitted: true,
    attributionRequired: true,
    shareAlike: true,
    commercialUsePermitted: true,
    derivativesPermitted: true,
    requiresHumanReview: false,
    note: 'ShareAlike affects what may be PUBLISHED from derived works. Ingestion and retrieval are fine; deciding what a generated answer inherits is a legal question for a human, and this flag is what surfaces it.',
  },
  'CC-BY-NC-4.0': {
    id: 'CC-BY-NC-4.0',
    name: 'Creative Commons Attribution-NonCommercial 4.0',
    url: 'https://creativecommons.org/licenses/by-nc/4.0/',
    ingestionPermitted: false,
    attributionRequired: true,
    shareAlike: false,
    commercialUsePermitted: false,
    derivativesPermitted: true,
    requiresHumanReview: false,
    note: 'REFUSED: Synora is a commercial product, and indexing NC material to serve paying customers is the use this licence prohibits.',
  },
  'CC-BY-ND-4.0': {
    id: 'CC-BY-ND-4.0',
    name: 'Creative Commons Attribution-NoDerivatives 4.0',
    url: 'https://creativecommons.org/licenses/by-nd/4.0/',
    ingestionPermitted: false,
    attributionRequired: true,
    shareAlike: false,
    commercialUsePermitted: true,
    derivativesPermitted: false,
    requiresHumanReview: false,
    note: 'REFUSED: chunking and embedding produce derivative works, which ND forbids.',
  },
  MIT: {
    id: 'MIT',
    name: 'MIT License',
    url: 'https://opensource.org/license/mit',
    ingestionPermitted: true,
    attributionRequired: true,
    shareAlike: false,
    commercialUsePermitted: true,
    derivativesPermitted: true,
    requiresHumanReview: false,
    note: 'Permissive. Requires the copyright notice to travel with substantial portions.',
  },
  'Apache-2.0': {
    id: 'Apache-2.0',
    name: 'Apache License 2.0',
    url: 'https://www.apache.org/licenses/LICENSE-2.0',
    ingestionPermitted: true,
    attributionRequired: true,
    shareAlike: false,
    commercialUsePermitted: true,
    derivativesPermitted: true,
    requiresHumanReview: false,
    note: 'Permissive, with an explicit patent grant. Changes must be marked.',
  },
  'BSD-3-Clause': {
    id: 'BSD-3-Clause',
    name: 'BSD 3-Clause License',
    url: 'https://opensource.org/license/bsd-3-clause',
    ingestionPermitted: true,
    attributionRequired: true,
    shareAlike: false,
    commercialUsePermitted: true,
    derivativesPermitted: true,
    requiresHumanReview: false,
    note: 'Permissive. The third clause forbids using contributors\' names to endorse.',
  },
  'ODbL-1.0': {
    id: 'ODbL-1.0',
    name: 'Open Database License 1.0',
    url: 'https://opendatacommons.org/licenses/odbl/1-0/',
    ingestionPermitted: true,
    attributionRequired: true,
    shareAlike: true,
    commercialUsePermitted: true,
    derivativesPermitted: true,
    requiresHumanReview: false,
    note: 'Share-alike applies to the DATABASE, not to individual results. A derived index inherits it.',
  },
  'PDDL-1.0': {
    id: 'PDDL-1.0',
    name: 'Open Data Commons Public Domain Dedication and License',
    url: 'https://opendatacommons.org/licenses/pddl/1-0/',
    ingestionPermitted: true,
    attributionRequired: false,
    shareAlike: false,
    commercialUsePermitted: true,
    derivativesPermitted: true,
    requiresHumanReview: false,
    note: 'Public domain dedication for databases.',
  },
  'public-domain': {
    id: 'public-domain',
    name: 'Public domain (expired copyright or dedicated)',
    ingestionPermitted: true,
    attributionRequired: false,
    shareAlike: false,
    commercialUsePermitted: true,
    derivativesPermitted: true,
    // Jurisdictional, so a machine cannot settle it. A work in the public
    // domain in the US may still be in copyright in the EU, and the answer
    // depends on the author's death date and the country serving the request.
    requiresHumanReview: true,
    note: 'Public-domain status is JURISDICTIONAL — Project Gutenberg texts are public domain in the US and not necessarily elsewhere. Verify per source.',
  },
  'government-open-data': {
    id: 'government-open-data',
    name: 'Government open data (portal-specific terms)',
    ingestionPermitted: true,
    attributionRequired: true,
    shareAlike: false,
    commercialUsePermitted: true,
    derivativesPermitted: true,
    // The whole reason `REVIEW_REQUIRED` exists as a policy state: these
    // terms are real, usually permissive, and written per portal. A machine
    // that assumed either answer would be wrong a meaningful fraction of
    // the time, in a direction nobody would notice until it mattered.
    requiresHumanReview: true,
    note: 'PERMITTED SUBJECT TO PER-SOURCE VERIFICATION. Government portals publish under their own terms, which usually permit commercial reuse with attribution — but not always, and not uniformly across a portal.',
  },
  UNKNOWN: {
    id: 'UNKNOWN',
    name: 'No licence identified',
    ingestionPermitted: false,
    attributionRequired: true,
    shareAlike: false,
    commercialUsePermitted: false,
    derivativesPermitted: false,
    requiresHumanReview: false,
    note: 'REFUSED: absence of a stated licence means all rights reserved by default, not that the material is free.',
  },
  proprietary: {
    id: 'proprietary',
    name: 'Proprietary / all rights reserved',
    ingestionPermitted: false,
    attributionRequired: true,
    shareAlike: false,
    commercialUsePermitted: false,
    derivativesPermitted: false,
    requiresHumanReview: false,
    note: 'REFUSED.',
  },
};

export function assessLicence(id: LicenceId): LicenceAssessment {
  // An unrecognised id resolves to UNKNOWN, which is refused. There is no
  // path by which an unfamiliar licence string becomes permissive.
  return LICENCES[id] ?? LICENCES.UNKNOWN;
}

export function permittedLicences(): readonly LicenceId[] {
  return (Object.keys(LICENCES) as LicenceId[]).filter((id) => LICENCES[id].ingestionPermitted);
}
