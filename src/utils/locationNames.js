// ---------------------------------------------------------------------
// Centralized display-name localization for Dormify's system-defined
// housing locations: regions, dorm types (building clusters), and the
// building labels composed from them.
//
// WHY THIS FILE EXISTS
// The Region/DormType/Building models store exactly one `name` field
// each (Hebrew) - there is no `name_en` column anywhere in the schema
// (verified against backend/api/models.py). These are NOT free text:
// Region and DormType rows are a small, fixed, administrator-seeded set
// (DormType.name even carries a DB `unique=True` constraint), so their
// English names can be hand-curated once, here, and reused everywhere -
// instead of being (a) left untranslated, as previously happened on the
// Data Analysis page and several others, or (b) re-invented slightly
// differently in every component that happens to display one.
//
// HOW TO USE THIS IN A NEW COMPONENT
//   import { localizeRegionName, localizeDormTypeName, localizeBuildingLabel,
//            localizeLocationText } from '../utils/locationNames';
//
//   - Have a {id, name} region object (e.g. from regionsAPI.getAll(),
//     or a serialized Region)?            -> localizeRegionName(region, language)
//   - Have a {code, name} dorm type object (e.g. from the buildings API,
//     DormTypeSerializer, or a building's dorm_type_code/dorm_type_name
//     pair)?                              -> localizeDormTypeName(dormType, language)
//   - Have a composed building label built by the backend as
//     "<dorm type name> - בניין <N>" (e.g. analysis_data's occupancy_data
//     rows)?                              -> localizeBuildingLabel(label, language)
//   - Only have a raw Hebrew name string and nothing else (e.g. an
//     aggregated/denormalized API field, a destination-region-names
//     array, a free-standing region_name/dorm_type_name string)?
//                                          -> localizeLocationText(name, language)
//   - Have both a stable id (region id, or dorm type code) AND a raw
//     name string, and want the id preferred when known?
//                                          -> localizeById(id, rawName, language)
//
// Never hardcode a second he/en lookup table in a page or component -
// extend the dictionaries below instead, so every screen stays in sync.
//
// DISPLAY ONLY - READ THIS BEFORE USING THE RETURN VALUE
// Every function here returns a string for RENDERING ONLY. Never use the
// return value as: a lookup/map key, a filter or search-match value, a
// query parameter, a `<option value=...>`, or anything compared against
// backend data or sent back to an API. Regions and dorm types are always
// identified by their real `id`/`code` (or, failing that, the original
// Hebrew `name`, which is what the backend actually stores and returns)
// - the English strings below exist purely to be shown to an English-
// reading user, not to participate in any logic.
// ---------------------------------------------------------------------

// Region.id -> English display name. Keyed by the actual primary keys
// seeded in the system today (verified directly against the running
// database - see DATA_ANALYSIS_REDESIGN_DESIGN_HISTORY.md, the
// "System-Wide Location Name Localization" section, for how these were
// confirmed).
//
// English display names are centralized here so the UI uses one
// consistent vocabulary across screens. The public portfolio version
// omits the original institution-specific sourcing notes.
const REGION_EN_BY_ID = {
  canada: 'Canada Dormitories',
  broshim: 'Broshim Dormitories',
  mizrah: 'East Dormitory Block',
  'gush-elyon': 'Upper Dormitory Block',
  'gush-tachton': 'Lower Campus Dormitories',
  'segal-zutar': 'Junior Faculty Dormitories',
  // Institution and fallback region labels used by legacy data shapes.
  // These strings are display-only and are not authorization identifiers.
  technion: 'Technion',
  other_region: 'Other Region',
  // Additional id spellings seen in test fixtures / other environments -
  // kept so this table degrades gracefully rather than needing a code
  // change if a differently-seeded environment uses these ids. Same six
  // official names as above, just under the alternate id spelling.
  gush_elyon: 'Upper Dormitory Block',
  gush_tachton: 'Lower Campus Dormitories',
  segel_zutar: 'Junior Faculty Dormitories',
};

// DormType.code -> English display name (dorm-type/building-cluster
// level - one tier more specific than a region, and the level Building
// labels are actually composed from). Covers every code known in the
// system, including ones not currently seeded, taken from
// EXCEL_DORM_NAME_TO_OFFICIAL_CODE in backend/api/views.py (the
// authoritative canonical Hebrew dorm-type name list used by the Excel
// import), so a newly-seeded dorm type already has a correct English
// name the moment it appears rather than needing a follow-up fix.
const DORM_TYPE_EN_BY_CODE = {
  1: 'Rifkin',
  2: 'Canada',
  3: 'Kassel',
  4: 'Couples',
  5: 'Mizrah (Old)',
  6: 'Neve America',
  7: 'Senate',
  8: 'Families',
  10: 'Single Room',
  11: 'Elyon Amim',
  12: 'Mizrah (New)',
  13: 'Segel Zutar',
  14: 'Kfar Mishtalmim',
  15: 'Kfar Hasmaha',
  16: 'Ruth Cohen',
  17: 'Broshim',
  18: 'New Senate',
};

// Raw Hebrew name/text -> English. The text-based fallback, used
// whenever only a name string is available and not a stable id/code
// (e.g. an aggregated API field, a denormalized array of destination
// region names, or a composed label before it's been split apart).
// Deliberately includes every spelling variant seen anywhere in the
// codebase (region names with the "מעונות" prefix, bare dorm-type
// names, and the alternate spellings already catalogued in MapPage's
// dorm-area alias list) so the same entity translates the same way
// everywhere regardless of which raw string a given API happens to
// return it as.
const NAME_EN_BY_HEBREW_TEXT = {
  // Regions (with the "מעונות" prefix, as Region.name actually stores it).
  // These display labels are kept centralized for consistency. See
  // REGION_EN_BY_ID above.
  'מעונות קנדה': 'Canada Dormitories',
  'מעונות ברושים': 'Broshim Dormitories',
  'מעונות מזרח': 'East Dormitory Block',
  'מעונות גוש עליון': 'Upper Dormitory Block',
  'מעונות גוש תחתון': 'Lower Campus Dormitories',
  'מעונות סגל זוטר': 'Junior Faculty Dormitories',
  'הטכניון': 'Technion',
  'אזור אחר': 'Other Region',
  'גוש עליון': 'Upper Dormitory Block',
  'גוש תחתון': 'Lower Campus Dormitories',

  // Dorm types / building clusters (bare name, as DormType.name stores
  // it - one tier more specific than a region, e.g. "סגל זוטר" without
  // the "מעונות" prefix). These are NOT part of the user-supplied
  // six-region list above; they were not found published anywhere in
  // English, so consistent English names were hand-picked and documented
  // per DATA_ANALYSIS_REDESIGN_DESIGN_HISTORY.md's "any names for
  // which no reliable translation could be found" note - reusing
  // MapPage.js's pre-existing terminology where it already covered one
  // (Rifkin, Canada, Neve America, Senate, Broshim, Kfar Hasmaha,
  // Kfar Mishtalmim), and inventing a documented, literal-or-
  // transliterated name only for the remainder (Kassel, Couples,
  // Families, Single Room, Elyon Amim, Ruth Cohen, New Senate,
  // Mizrah (Old)/(New), Segel Zutar).
  'ריפקין': 'Rifkin',
  'קנדה': 'Canada',
  'קסל': 'Kassel',
  'זוגות': 'Couples',
  'מזרח ישן': 'Mizrah (Old)',
  'נווה אמריקה': 'Neve America',
  'נוה אמריקה': 'Neve America',
  'סנט': 'Senate',
  'סנאט': 'Senate',
  'משפחות': 'Families',
  'יחיד בחדר': 'Single Room',
  'עליון עמים': 'Elyon Amim',
  'מזרח חדש': 'Mizrah (New)',
  'סגל זוטר': 'Segel Zutar',
  'כפר משתלמים': 'Kfar Mishtalmim',
  'כפר הסמכה': 'Kfar Hasmaha',
  'רות הכהן': 'Ruth Cohen',
  'ברושים': 'Broshim',
  'סנט חדש': 'New Senate',
  'הסנט': 'Senate',
  'מזרח': 'Mizrah',
};

function normalize(value) {
  return (value == null ? '' : String(value)).trim().replace(/\s+/g, ' ');
}

// Raw Hebrew name/text -> localized display text. Returns the original
// string untouched in Hebrew, and in English returns the curated
// translation when this text is a known canonical name - otherwise
// returns the original Hebrew string unchanged (never blank, never
// throws), so an unmapped future name still displays something
// meaningful instead of disappearing.
export function localizeLocationText(name, language) {
  const clean = normalize(name);
  if (!clean) return name || '';
  if (language !== 'en') return name;
  return NAME_EN_BY_HEBREW_TEXT[clean] || name;
}

// Prefer a stable id/code when known (most robust - immune to spelling
// variants), falling back to the raw-text dictionary, and finally to
// the original string.
export function localizeById(id, rawName, language) {
  if (language !== 'en') return rawName;
  if (id != null && REGION_EN_BY_ID[id]) return REGION_EN_BY_ID[id];
  if (id != null && DORM_TYPE_EN_BY_CODE[id]) return DORM_TYPE_EN_BY_CODE[id];
  return localizeLocationText(rawName, language);
}

// region: a {id, name} object (RegionSerializer shape, or the region
// field already returned by regionsAPI.getAll()).
export function localizeRegionName(region, language) {
  if (!region) return '';
  if (language !== 'en') return region.name || '';
  const byId = region.id != null && REGION_EN_BY_ID[region.id];
  return byId || localizeLocationText(region.name, language);
}

// dormType: a {code, name} object (DormTypeSerializer shape, or the
// dorm_type_code/dorm_type_name pair a Building is serialized with).
export function localizeDormTypeName(dormType, language) {
  if (!dormType) return '';
  if (language !== 'en') return dormType.name || '';
  const byCode = dormType.code != null && DORM_TYPE_EN_BY_CODE[dormType.code];
  return byCode || localizeLocationText(dormType.name, language);
}

// Building labels are composed server-side (see analysis_data in
// backend/api/views.py) as "<dorm type name> - בניין <number>". Splits
// that apart, localizes the dorm-type portion, and swaps the Hebrew
// "בניין" for "Building" - rather than leaving the whole composed
// string untranslated because it isn't an exact dictionary match.
const BUILDING_LABEL_PATTERN = /^(.*?)\s*-\s*בניין\s*(\S+)\s*$/;

export function localizeBuildingLabel(label, language) {
  if (language !== 'en') return label;
  const clean = normalize(label);
  const match = BUILDING_LABEL_PATTERN.exec(clean);
  if (!match) return localizeLocationText(label, language);
  const [, dormTypePart, number] = match;
  return `${localizeLocationText(dormTypePart, 'en')} - Building ${number}`;
}
