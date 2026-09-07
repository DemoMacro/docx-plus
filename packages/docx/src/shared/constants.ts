/**
 * Shared constants for WordprocessingML documents.
 *
 * Provides alignment, number format, and space type constants
 * used across multiple document components.
 *
 * @module
 */

// ── Alignment ──

/**
 * Horizontal alignment options for floating drawings.
 *
 * Reference: https://www.datypic.com/sc/ooxml/t-wp_ST_AlignH.html
 *
 * @publicApi
 */
export const HorizontalPositionAlign = {
  CENTER: "center",
  INSIDE: "inside",
  LEFT: "left",
  OUTSIDE: "outside",
  RIGHT: "right",
} as const;

/**
 * Vertical alignment options for floating drawings.
 *
 * Reference: https://www.datypic.com/sc/ooxml/t-wp_ST_AlignV.html
 *
 * @publicApi
 */
export const VerticalPositionAlign = {
  BOTTOM: "bottom",
  CENTER: "center",
  INSIDE: "inside",
  OUTSIDE: "outside",
  TOP: "top",
} as const;

// ── Number format ──

/**
 * Number format types for page numbers and list numbering.
 *
 * Reference: http://officeopenxml.com/WPnumbering-numFmt.php
 *
 * @publicApi
 */
export const NumberFormat = {
  AIUEO: "aiueo",
  AIUEO_FULL_WIDTH: "aiueoFullWidth",
  ARABIC_ABJAD: "arabicAbjad",
  ARABIC_ALPHA: "arabicAlpha",
  BAHT_TEXT: "bahtText",
  BULLET: "bullet",
  CARDINAL_TEXT: "cardinalText",
  CHICAGO: "chicago",
  CHINESE_COUNTING: "chineseCounting",
  CHINESE_COUNTING_TEN_THOUSAND: "chineseCountingThousand",
  CHINESE_LEGAL_SIMPLIFIED: "chineseLegalSimplified",
  CHOSUNG: "chosung",
  DECIMAL: "decimal",
  DECIMAL_ENCLOSED_CIRCLE: "decimalEnclosedCircle",
  DECIMAL_ENCLOSED_CIRCLE_CHINESE: "decimalEnclosedCircleChinese",
  DECIMAL_ENCLOSED_FULL_STOP: "decimalEnclosedFullstop",
  DECIMAL_ENCLOSED_PAREN: "decimalEnclosedParen",
  DECIMAL_FULL_WIDTH: "decimalFullWidth",
  DECIMAL_FULL_WIDTH_2: "decimalFullWidth2",
  DECIMAL_HALF_WIDTH: "decimalHalfWidth",
  DECIMAL_ZERO: "decimalZero",
  DOLLAR_TEXT: "dollarText",
  GANADA: "ganada",
  HEBREW_1: "hebrew1",
  HEBREW_2: "hebrew2",
  HEX: "hex",
  HINDI_CONSONANTS: "hindiConsonants",
  HINDI_COUNTING: "hindiCounting",
  HINDI_NUMBERS: "hindiNumbers",
  HINDI_VOWELS: "hindiVowels",
  IDEOGRAPH_DIGITAL: "ideographDigital",
  IDEOGRAPH_ENCLOSED_CIRCLE: "ideographEnclosedCircle",
  IDEOGRAPH_LEGAL_TRADITIONAL: "ideographLegalTraditional",
  IDEOGRAPH_TRADITIONAL: "ideographTraditional",
  IDEOGRAPH_ZODIAC: "ideographZodiac",
  IDEOGRAPH_ZODIAC_TRADITIONAL: "ideographZodiacTraditional",
  IROHA: "iroha",
  IROHA_FULL_WIDTH: "irohaFullWidth",
  JAPANESE_COUNTING: "japaneseCounting",
  JAPANESE_DIGITAL_TEN_THOUSAND: "japaneseDigitalTenThousand",
  JAPANESE_LEGAL: "japaneseLegal",
  KOREAN_COUNTING: "koreanCounting",
  KOREAN_DIGITAL: "koreanDigital",
  KOREAN_DIGITAL_2: "koreanDigital2",
  KOREAN_LEGAL: "koreanLegal",
  LOWER_LETTER: "lowerLetter",
  LOWER_ROMAN: "lowerRoman",
  NONE: "none",
  NUMBER_IN_DASH: "numberInDash",
  ORDINAL: "ordinal",
  ORDINAL_TEXT: "ordinalText",
  RUSSIAN_LOWER: "russianLower",
  RUSSIAN_UPPER: "russianUpper",
  TAIWANESE_COUNTING: "taiwaneseCounting",
  TAIWANESE_COUNTING_THOUSAND: "taiwaneseCountingThousand",
  TAIWANESE_DIGITAL: "taiwaneseDigital",
  THAI_COUNTING: "thaiCounting",
  THAI_LETTERS: "thaiLetters",
  THAI_NUMBERS: "thaiNumbers",
  UPPER_LETTER: "upperLetter",
  UPPER_ROMAN: "upperRoman",
  VIETNAMESE_COUNTING: "vietnameseCounting",
} as const;
