// DGrep KQL subset vocabulary — single source of truth
// NOTE: This is NOT standard Kusto. DGrep renames some functions and has a unique `categorize` operator.

export const TABULAR_OPERATORS = [
  'where', 'extend', 'project', 'summarize', 'sort', 'order',
  'limit', 'take', 'join', 'parse', 'mvexpand', 'project-away',
  'project-rename', 'columnifexists', 'categorize', 'print',
] as const;

export const STRING_OPERATORS = [
  'contains', '!contains', 'contains_cs', '!contains_cs',
  'startswith', '!startswith', 'startswith_cs', '!startswith_cs',
  'endswith', '!endswith', 'endswith_cs', '!endswith_cs',
  'matches regex', 'in', '!in',
] as const;

export const SCALAR_FUNCTIONS = [
  // Conversion
  'ago', 'now', 'tostring', 'toint', 'tolong', 'todouble', 'toreal',
  'tobool', 'todatetime', 'totimespan', 'toguid',
  // String
  'split', 'strcat', 'strcat_delim', 'strlen', 'substring',
  'tolower', 'toupper', 'extract', 'extractall', 'indexof', 'countof',
  'isempty', 'isnotempty',
  // Parse
  'parse_json', 'parse_xml',
  // Conditional
  'iif', 'case',
  // Math
  'abs', 'bin', 'floor', 'ceiling', 'round', 'pow', 'sign',
  'exp', 'exp2', 'exp10', 'log', 'log2', 'log10',
  'isfinite', 'isinf', 'isnan',
  // Encoding
  'base64_encodestring', 'base64_decodestring', 'hash_sha256',
  // Type inspection
  'gettype', 'isnotnull', 'isnull',
  // Min/Max
  'max_of', 'min_of',
  // Array / dynamic
  'array_concat', 'array_length', 'pack', 'pack_array', 'zip',
  // Bitwise
  'binary_and', 'binary_or', 'binary_not', 'binary_xor',
  'binary_shift_left', 'binary_shift_right',
  // Datetime
  'datetime_add', 'datetime_diff', 'datetime_part',
  'dayofmonth', 'dayofweek', 'dayofyear',
  'endofday', 'endofmonth', 'endofweek', 'endofyear',
  'startofday', 'startofmonth', 'startofweek', 'startofyear',
  'getmonth', 'getyear', 'hourofday',
  'make_datetime', 'make_timespan', 'weekofyear',
] as const;

export const AGGREGATION_FUNCTIONS = [
  'avg', 'count', 'countif', 'dcount', 'dcountif',
  'makeset', 'max', 'min', 'percentile', 'sum', 'any',
] as const;

export const KEYWORDS = [
  'by', 'on', 'asc', 'desc', 'and', 'or', 'not', 'between',
  'true', 'false', 'kind', 'inner', 'nulls', 'first', 'last',
  'let', 'source',
] as const;

export const TYPES = [
  'datetime', 'timespan', 'dynamic', 'int', 'long', 'real',
  'bool', 'string',
] as const;

// Pre-built Sets for fast tokenizer lookups (lowercase)
export const TABULAR_OPERATOR_SET = new Set(TABULAR_OPERATORS.map(s => s.toLowerCase()));
export const KEYWORD_SET = new Set(KEYWORDS.map(s => s.toLowerCase()));
export const FUNCTION_SET = new Set([
  ...SCALAR_FUNCTIONS,
  ...AGGREGATION_FUNCTIONS,
].map(s => s.toLowerCase()));
export const TYPE_SET = new Set(TYPES.map(s => s.toLowerCase()));

// Negated word operators (handled specially by the tokenizer)
export const NEGATED_OPERATORS = new Set([
  'contains', 'contains_cs', 'startswith', 'startswith_cs',
  'endswith', 'endswith_cs', 'in',
]);
